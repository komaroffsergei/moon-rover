import { describe, expect, it } from 'vitest';

import { parseJsonText, tiledMapSchema } from '../src/content';
import { runtimeLevelSources } from '../src/content/levels/catalog';
import type { GridCell } from '../src/domain';
import {
  createOrganicZoneContours,
  createPolygonHatchSegments,
  createRoundedRoutePoints,
  createRoverGroupOffset,
  createRoverHudPresentation,
} from '../src/game/renderers/mapPresentationGeometry';

const TILE_SIZE = 64;

function rectangleCells(
  column: number,
  row: number,
  width: number,
  height: number,
): GridCell[] {
  return Array.from({ length: width * height }, (_value, index) => ({
    column: column + (index % width),
    row: row + Math.floor(index / width),
  }));
}

function hazardCells(source: (typeof runtimeLevelSources)[number]): GridCell[] {
  const map = tiledMapSchema.parse(
    parseJsonText(source.mapText, source.mapFileName),
  );
  const layer = map.layers.find(
    (candidate) =>
      candidate.type === 'tilelayer' && candidate.name === 'hazards',
  );
  if (layer?.type !== 'tilelayer') throw new Error('Hazards layer is missing');
  return layer.data.flatMap((gid, index) =>
    gid === 0
      ? []
      : [
          {
            column: index % map.width,
            row: Math.floor(index / map.width),
          },
        ],
  );
}

describe('map presentation geometry', () => {
  it('turns a rectangular hazard mask into a deterministic visibly irregular contour', () => {
    const cells = rectangleCells(2, 2, 3, 3);
    const first = createOrganicZoneContours(
      cells,
      { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE },
      'rectangular-zone',
    );
    const repeated = createOrganicZoneContours(
      cells,
      { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE },
      'rectangular-zone',
    );
    const variant = createOrganicZoneContours(
      cells,
      { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE },
      'rectangular-zone-variant',
    );

    expect(first).toEqual(repeated);
    expect(first).not.toEqual(variant);
    expect(first).toHaveLength(1);
    const contour = first[0]!;
    expect(contour.length).toBeGreaterThan(24);
    expect(
      contour.every(({ x, y }) =>
        [x, y].every(
          (coordinate) =>
            Number.isFinite(coordinate) &&
            coordinate >= 2 * TILE_SIZE - TILE_SIZE * 0.7 &&
            coordinate <= 5 * TILE_SIZE + TILE_SIZE * 0.7,
        ),
      ),
    ).toBe(true);

    const topSide = contour.filter(
      ({ x, y }) =>
        x > 2.6 * TILE_SIZE && x < 4.4 * TILE_SIZE && y < 2.25 * TILE_SIZE,
    );
    expect(topSide.length).toBeGreaterThan(2);
    expect(
      Math.max(...topSide.map(({ y }) => y)) -
        Math.min(...topSide.map(({ y }) => y)),
    ).toBeGreaterThan(TILE_SIZE * 0.2);
  });

  it.each(runtimeLevelSources)(
    'creates bounded deterministic organic contours for $id',
    (source) => {
      const cells = hazardCells(source);
      const first = createOrganicZoneContours(
        cells,
        { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE },
        source.id,
      );
      const repeated = createOrganicZoneContours(
        cells,
        { tileWidth: TILE_SIZE, tileHeight: TILE_SIZE },
        source.id,
      );

      expect(first).toEqual(repeated);
      expect(first.length).toBeGreaterThan(0);
      expect(first.flat().length).toBeGreaterThan(cells.length);
      expect(
        first
          .flat()
          .every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)),
      ).toBe(true);
    },
  );

  it('rounds a route corner without moving exact endpoints', () => {
    const route = [
      { column: 1, row: 1 },
      { column: 2, row: 1 },
      { column: 2, row: 2 },
    ];
    const points = createRoundedRoutePoints(route, {
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });

    expect(points[0]).toEqual({ x: 96, y: 96 });
    expect(points.at(-1)).toEqual({ x: 160, y: 160 });
    expect(points.length).toBeGreaterThan(route.length);
    expect(points.slice(1, -1).some(({ x, y }) => x !== 160 && y !== 96)).toBe(
      true,
    );
    expect(
      points.every(({ x, y }) => x >= 96 && x <= 160 && y >= 96 && y <= 160),
    ).toBe(true);
  });

  it('clips diagonal hatching into every concave contour span', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
      { x: 35, y: 30 },
      { x: 35, y: 70 },
      { x: 80, y: 70 },
      { x: 80, y: 100 },
      { x: 0, y: 100 },
    ];
    const segments = createPolygonHatchSegments(polygon, 10);

    expect(segments.length).toBeGreaterThan(10);
    expect(
      segments.every(
        ({ from, to }) =>
          Math.abs(from.x + from.y - (to.x + to.y)) < 1e-8 &&
          from.x >= 0 &&
          from.x <= 80 &&
          to.x >= 0 &&
          to.x <= 80 &&
          from.y >= 0 &&
          from.y <= 100 &&
          to.y >= 0 &&
          to.y <= 100,
      ),
    ).toBe(true);
  });

  it('projects courier cargo as consecutive segments of one capacity scale', () => {
    const presentation = createRoverHudPresentation({
      kind: 'courier',
      battery: 68,
      batteryCapacity: 100,
      cargo: { oxygen: 12, food: 18, equipment: 0 },
      cargoCapacity: 60,
    });

    expect(presentation).toEqual({
      batteryRatio: 0.68,
      cargoRatios: [0.2, 0.3, 0],
    });
    expect(
      presentation.cargoRatios?.reduce((total, ratio) => total + ratio, 0),
    ).toBeCloseTo(0.5);
  });

  it('clamps rover HUD ratios and never projects cargo beyond one capacity', () => {
    const overloaded = createRoverHudPresentation({
      kind: 'courier',
      battery: 120.5,
      batteryCapacity: 100,
      cargo: { oxygen: 48.5, food: 18.25, equipment: 13.25 },
      cargoCapacity: 60,
    });

    expect(overloaded.batteryRatio).toBe(1);
    expect(overloaded.cargoRatios).not.toBeNull();
    expect(
      overloaded.cargoRatios?.every((ratio) => ratio >= 0 && ratio <= 1),
    ).toBe(true);
    expect(
      overloaded.cargoRatios?.reduce((total, ratio) => total + ratio, 0),
    ).toBeLessThanOrEqual(1);

    expect(
      createRoverHudPresentation({
        kind: 'repair',
        battery: -1,
        batteryCapacity: 100,
        cargo: { oxygen: 0, food: 0, equipment: 0 },
        cargoCapacity: 0,
      }),
    ).toEqual({ batteryRatio: 0, cargoRatios: null });
  });

  it('separates all six level-five rover HUD rings', () => {
    const offsets = Array.from({ length: 6 }, (_value, index) =>
      createRoverGroupOffset(index, 6),
    );

    expect(new Set(offsets.map(({ x, y }) => `${x}:${y}`)).size).toBe(6);
    for (let left = 0; left < offsets.length; left += 1) {
      for (let right = left + 1; right < offsets.length; right += 1) {
        expect(
          Math.hypot(
            offsets[left]!.x - offsets[right]!.x,
            offsets[left]!.y - offsets[right]!.y,
          ),
        ).toBeGreaterThanOrEqual(79.9);
      }
    }

    const upperRight = offsets[1]!;
    const lowerRight = offsets[2]!;
    const upperRingBottom = upperRight.y + 29.5;
    const lowerCargoTop = lowerRight.y - 47;
    expect(lowerCargoTop).toBeGreaterThan(upperRingBottom);
  });
});
