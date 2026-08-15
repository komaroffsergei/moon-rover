import { describe, expect, it } from 'vitest';

import {
  createRuntimeMap,
  listRuntimeLevels,
  type RuntimeLevelId,
} from '../src/app/createRuntimeMap';
import { E2E_AUTHORING_LAYOUT_IDS } from '../src/app/testing/e2eFacilityPlacement';

const EXPECTED_LEVELS = [
  {
    id: 'tycho-crater',
    ordinal: 1,
    riskLevel: 'low',
    size: [12, 8],
    centerCount: 2,
    roverCount: 3,
    courierCount: 2,
    background: '/assets/maps/tycho/background.webp',
  },
  {
    id: 'shackleton-rift',
    ordinal: 2,
    riskLevel: 'medium',
    size: [16, 10],
    centerCount: 3,
    roverCount: 3,
    courierCount: 2,
    background: '/assets/maps/shackleton/background.webp',
  },
  {
    id: 'tranquility-sea',
    ordinal: 3,
    riskLevel: 'high',
    size: [18, 13],
    centerCount: 4,
    roverCount: 4,
    courierCount: 3,
    background: '/assets/maps/tranquility/background.webp',
  },
  {
    id: 'south-pole',
    ordinal: 4,
    riskLevel: 'extreme',
    size: [20, 14],
    centerCount: 5,
    roverCount: 5,
    courierCount: 4,
    background: '/assets/maps/south-pole/background.webp',
  },
  {
    id: 'aitken-labyrinth',
    ordinal: 5,
    riskLevel: 'maximum',
    size: [20, 14],
    centerCount: 6,
    roverCount: 6,
    courierCount: 5,
    background: '/assets/maps/aitken/background.webp',
  },
] as const;

describe('runtime level catalog composition', () => {
  it('publishes exactly five validated selector presentations', () => {
    expect(
      listRuntimeLevels().map((level) => ({
        id: level.id,
        ordinal: level.ordinal,
        riskLevel: level.riskLevel,
        centerCount: level.centerCount,
        roverCount: level.roverCount,
        courierCount: level.courierCount,
        background: level.previewAsset,
      })),
    ).toEqual(
      EXPECTED_LEVELS.map((level) => ({
        id: level.id,
        ordinal: level.ordinal,
        riskLevel: level.riskLevel,
        centerCount: level.centerCount,
        roverCount: level.roverCount,
        courierCount: level.courierCount,
        background: level.background,
      })),
    );
  });

  it.each(EXPECTED_LEVELS)(
    'builds isolated $id runtime with its selected static map',
    (expected) => {
      const runtime = createRuntimeMap(
        expected.id as RuntimeLevelId,
        'runtime-catalog',
      );
      const view = runtime.controller.getView();

      expect(runtime.level).toMatchObject({
        id: expected.id,
        ordinal: expected.ordinal,
        riskLevel: expected.riskLevel,
        riskChoiceCenterCount: expected.ordinal >= 4 ? 3 : expected.ordinal,
        centerCount: expected.centerCount,
        roverCount: expected.roverCount,
        courierCount: expected.courierCount,
        previewAsset: expected.background,
      });
      expect(runtime.map).toMatchObject({
        id: expected.id,
        width: expected.size[0],
        height: expected.size[1],
        tileWidth: 64,
        tileHeight: 64,
        baseCell: view.baseCell,
        backgroundLayer: {
          x: 0,
          y: 0,
          opacity: 1,
          visible: true,
        },
      });
      expect(runtime.map.layers.map(({ name }) => name)).toEqual([
        'hazards',
        'obstacles',
      ]);
      expect(
        runtime.map.layers.find(({ name }) => name === 'hazards')?.data,
      ).toEqual(expect.arrayContaining([2]));
      expect(runtime.map.assets).toMatchObject({
        background: expected.background,
      });
      expect(view.snapshot.rovers).toHaveLength(expected.roverCount);
      expect(view.snapshot.centers).toHaveLength(expected.centerCount);
      expect(view.snapshot.phase).toBe('BRIEFING');
      expect(view.centerMetrics).toHaveLength(expected.centerCount);
      expect(runtime.map.baseCell).toEqual(view.baseCell);
      expect(
        view.snapshot.rovers.every(
          ({ cell }) =>
            cell.column === view.baseCell.column &&
            cell.row === view.baseCell.row,
        ),
      ).toBe(true);
    },
  );

  it('creates fresh simulation state for repeated selections', () => {
    const first = createRuntimeMap('tycho-crater', 'same-session-seed');
    const second = createRuntimeMap('tycho-crater', 'same-session-seed');

    expect(first.controller.start()).toMatchObject({ ok: true });
    expect(first.controller.getView().snapshot.phase).toBe('RUNNING');
    expect(second.controller.getView().snapshot.phase).toBe('BRIEFING');
    expect(second.controller.getView().baseCell).toEqual(
      first.controller.getView().baseCell,
    );
  });

  it('keeps the explicit E2E authoring override coordinate-stable', () => {
    const runtime = createRuntimeMap('shackleton-rift', 'ignored', {
      authoringLayoutId: E2E_AUTHORING_LAYOUT_IDS['shackleton-rift'],
    });
    const view = runtime.controller.getView();

    expect(view.baseCell).toEqual({ column: 1, row: 5 });
    expect(
      Object.fromEntries(
        view.snapshot.centers.map(({ id, cell }) => [id, cell]),
      ),
    ).toEqual({
      helios: { column: 13, row: 5 },
      aristarchus: { column: 13, row: 4 },
      kepler: { column: 3, row: 1 },
    });
    expect(
      view.snapshot.rovers.every(
        ({ cell }) =>
          cell.column === view.baseCell.column &&
          cell.row === view.baseCell.row,
      ),
    ).toBe(true);
  });

  it('allows separate session seeds to select varied procedural placements', () => {
    const basesAndCenters = new Set(
      Array.from({ length: 24 }, (_, index) => {
        const view = createRuntimeMap(
          'tycho-crater',
          `session-${index}`,
        ).controller.getView();
        return JSON.stringify([
          view.baseCell,
          ...view.snapshot.centers.map(({ cell }) => cell),
        ]);
      }),
    );

    expect(basesAndCenters.size).toBeGreaterThan(1);
  });

  it('projects the hazard mask and procedural center from one runtime bundle', () => {
    const runtime = Array.from({ length: 64 }, (_, index) =>
      createRuntimeMap('tycho-crater', `runtime-hazard-${index}`),
    ).find((candidate) => {
      const hazards = candidate.map.layers.find(
        ({ name }) => name === 'hazards',
      );
      return candidate.controller
        .getView()
        .snapshot.centers.some(
          ({ cell }) =>
            hazards?.data[cell.row * candidate.map.width + cell.column] !== 0,
        );
    });
    expect(runtime).toBeDefined();

    const view = runtime!.controller.getView();
    const hazards = runtime!.map.layers.find(({ name }) => name === 'hazards');
    const hazardousCenter = view.snapshot.centers.find(
      ({ cell }) =>
        hazards?.data[cell.row * runtime!.map.width + cell.column] !== 0,
    );
    expect(hazardousCenter).toBeDefined();
    const cell = hazardousCenter!.cell;
    expect(hazards?.data[cell.row * runtime!.map.width + cell.column]).not.toBe(
      0,
    );
  });
});
