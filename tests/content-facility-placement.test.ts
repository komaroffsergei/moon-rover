import { describe, expect, it } from 'vitest';

import { E2E_AUTHORING_LAYOUT_IDS } from '../src/app/testing/e2eFacilityPlacement';
import {
  ContentValidationError,
  createSimulationConfigFromContent,
  loadContentBundle,
  parseJsonText,
  selectFacilityPlacement,
  type ContentBundle,
} from '../src/content';
import { createRoutingMapFromContent } from '../src/content/createRoutingMap';
import {
  commonContentSources,
  getRuntimeLevelSource,
  runtimeLevelSources,
} from '../src/content/levels/catalog';
import type { GridCell, RoutingMap } from '../src/domain';
import { makeBundleFixture } from './fixtures/content';

function loadProductionBundle(
  levelId: (typeof runtimeLevelSources)[number]['id'],
) {
  const source = getRuntimeLevelSource(levelId);
  return loadContentBundle({
    ...commonContentSources,
    levelMeta: source.levelMeta,
    map: parseJsonText(source.mapText, source.mapFileName),
    theme: source.theme,
  });
}

function createRoutingMap(bundle: ContentBundle): RoutingMap {
  return createRoutingMapFromContent({
    map: bundle.map,
    incidents: bundle.incidents,
    normalCellChance: bundle.balance.incidents.normalCellChance,
  });
}

function cellIndex(map: RoutingMap, cell: GridCell): number {
  return cell.row * map.width + cell.column;
}

function isReachable(
  map: RoutingMap,
  start: GridCell,
  target: GridCell,
): boolean {
  const visited = new Set([cellIndex(map, start)]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const cell = queue[cursor];
    if (cell === undefined) break;
    if (cell.column === target.column && cell.row === target.row) return true;
    for (const next of [
      { column: cell.column + 1, row: cell.row },
      { column: cell.column - 1, row: cell.row },
      { column: cell.column, row: cell.row + 1 },
      { column: cell.column, row: cell.row - 1 },
    ]) {
      if (
        next.column < 0 ||
        next.column >= map.width ||
        next.row < 0 ||
        next.row >= map.height
      ) {
        continue;
      }
      const index = cellIndex(map, next);
      if (visited.has(index) || map.cells[index]?.walkable !== true) continue;
      visited.add(index);
      queue.push(next);
    }
  }
  return false;
}

function expectContentIssue(action: () => unknown, code: string): void {
  try {
    action();
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues).toContainEqual(
      expect.objectContaining({ code }),
    );
  }
}

describe('facility placement content', () => {
  it.each(runtimeLevelSources)(
    'uses an explicit authoring layout override for coordinate E2E on $id',
    ({ id }) => {
      const bundle = loadProductionBundle(id);
      const layout = bundle.levelMeta.facilityLayouts.find(
        ({ id: layoutId }) => layoutId === E2E_AUTHORING_LAYOUT_IDS[id],
      );
      expect(layout).toBeDefined();

      expect(
        selectFacilityPlacement(bundle, 'ignored-by-authoring-override', {
          authoringLayoutId: E2E_AUTHORING_LAYOUT_IDS[id],
        }),
      ).toEqual({
        mode: 'authoring',
        layoutId: layout?.id,
        baseCell: layout?.baseCell,
        centers: layout?.centers,
      });
    },
  );

  it.each(runtimeLevelSources)(
    'procedurally places distinct reachable interior centers for $id',
    ({ id }) => {
      const bundle = loadProductionBundle(id);
      const routingMap = createRoutingMap(bundle);
      const authoredBaseKeys = new Set(
        bundle.levelMeta.facilityLayouts.map(
          ({ baseCell }) => `${baseCell.column}:${baseCell.row}`,
        ),
      );
      const fingerprints = new Set<string>();
      let sawHazardCenter = false;

      for (let index = 0; index < 128; index += 1) {
        const seed = `variant-${index}`;
        const placement = selectFacilityPlacement(bundle, seed);
        expect(selectFacilityPlacement(bundle, seed)).toEqual(placement);
        expect(placement.mode).toBe('procedural');
        expect(authoredBaseKeys).toContain(
          `${placement.baseCell.column}:${placement.baseCell.row}`,
        );

        const centerCells = Object.values(placement.centers);
        expect(centerCells).toHaveLength(bundle.levelMeta.centers.length);
        expect(
          new Set(centerCells.map(({ column, row }) => `${column}:${row}`))
            .size,
        ).toBe(centerCells.length);

        for (const center of centerCells) {
          expect(center.column).toBeGreaterThan(0);
          expect(center.column).toBeLessThan(routingMap.width - 1);
          expect(center.row).toBeGreaterThan(0);
          expect(center.row).toBeLessThan(routingMap.height - 1);
          expect(
            routingMap.cells[cellIndex(routingMap, center)]?.walkable,
          ).toBe(true);
          expect(center).not.toEqual(placement.baseCell);
          expect(isReachable(routingMap, placement.baseCell, center)).toBe(
            true,
          );
          sawHazardCenter ||=
            routingMap.cells[cellIndex(routingMap, center)]
              ?.incidentProfileId !== 'normal';
        }

        fingerprints.add(
          JSON.stringify([
            placement.baseCell,
            ...bundle.levelMeta.centers.map(
              ({ id: centerId }) => placement.centers[centerId],
            ),
          ]),
        );
      }

      expect(fingerprints.size).toBeGreaterThan(8);
      expect(sawHazardCenter).toBe(true);
    },
  );

  it('projects one procedural placement into the simulation without changing its seed', () => {
    const bundle = loadProductionBundle('shackleton-rift');
    const placement = selectFacilityPlacement(bundle, 'repeatable');
    const config = createSimulationConfigFromContent(bundle, placement);

    expect(config.seed).toBe(bundle.levelMeta.seed);
    expect(config.baseCell).toEqual(placement.baseCell);
    expect(config.centers).toEqual(
      bundle.levelMeta.centers.map((center) =>
        expect.objectContaining({
          id: center.id,
          cell: placement.centers[center.id],
        }),
      ),
    );
    expect(
      config.rovers.every(
        ({ initialCell }) =>
          initialCell.column === placement.baseCell.column &&
          initialCell.row === placement.baseCell.row,
      ),
    ).toBe(true);
  });

  it('rejects invalid placement requests', () => {
    const bundle = loadProductionBundle('tycho-crater');
    expect(() => selectFacilityPlacement(bundle, '')).toThrow(RangeError);
    expect(() =>
      selectFacilityPlacement(bundle, 'seed', {
        authoringLayoutId: 'missing-layout',
      }),
    ).toThrow(RangeError);
  });

  it('keeps D007 safety and risk checks on authoring geometry', () => {
    const hazardous = makeBundleFixture();
    hazardous.levelMeta.facilityLayouts[0]!.centers['center-risk'] = {
      column: 1,
      row: 1,
    };
    expectContentIssue(
      () => loadContentBundle(hazardous),
      'map.facility-hazard',
    );

    const wrongRisk = makeBundleFixture();
    wrongRisk.levelMeta.facilityLayouts[0]!.centers['center-risk'] = {
      column: 3,
      row: 0,
    };
    expectContentIssue(() => loadContentBundle(wrongRisk), 'map.risk-shortcut');
  });

  it('rejects content without enough reachable interior center cells', () => {
    const input = makeBundleFixture();
    const obstacles = input.map.layers.find(
      (layer) => layer.type === 'tilelayer' && layer.name === 'obstacles',
    );
    if (obstacles?.type !== 'tilelayer') {
      throw new Error('Missing obstacles fixture layer');
    }
    for (const index of [6, 7, 8]) obstacles.data[index] = 3;

    expectContentIssue(
      () => loadContentBundle(input),
      'map.procedural-center-capacity',
    );
  });
});
