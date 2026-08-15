import { describe, expect, it } from 'vitest';

import {
  cellCenter,
  worldToGridCell,
  type MapGridMetrics,
} from '../src/game/input/mapGeometry';

const grid: MapGridMetrics = {
  columns: 3,
  rows: 2,
  tileWidth: 64,
  tileHeight: 32,
};

describe('map geometry', () => {
  it.each([
    [
      { x: 0, y: 0 },
      { column: 0, row: 0 },
    ],
    [
      { x: 63.999, y: 31.999 },
      { column: 0, row: 0 },
    ],
    [
      { x: 64, y: 32 },
      { column: 1, row: 1 },
    ],
    [
      { x: 191.999, y: 63.999 },
      { column: 2, row: 1 },
    ],
  ])('maps the half-open world point %o to %o', (point, expected) => {
    expect(worldToGridCell(point, grid)).toEqual(expected);
  });

  it.each([
    { x: -0.001, y: 0 },
    { x: 0, y: -0.001 },
    { x: 192, y: 0 },
    { x: 0, y: 64 },
    { x: Number.NaN, y: 0 },
    { x: 0, y: Number.POSITIVE_INFINITY },
  ])('rejects a point outside the finite half-open map: %o', (point) => {
    expect(worldToGridCell(point, grid)).toBeNull();
  });

  it.each([
    { ...grid, columns: 0 },
    { ...grid, columns: 1.5 },
    { ...grid, rows: Number.POSITIVE_INFINITY },
    { ...grid, tileWidth: 0 },
    { ...grid, tileHeight: Number.NaN },
    { ...grid, columns: Number.MAX_SAFE_INTEGER, tileWidth: Number.MAX_VALUE },
  ])('rejects invalid grid metrics: %o', (metrics) => {
    expect(worldToGridCell({ x: 0, y: 0 }, metrics)).toBeNull();
  });

  it('returns a cell center for rectangular tiles', () => {
    expect(cellCenter({ column: 0, row: 0 }, grid)).toEqual({ x: 32, y: 16 });
    expect(cellCenter({ column: 2, row: 3 }, grid)).toEqual({
      x: 160,
      y: 112,
    });
  });

  it('rejects invalid cell coordinates and tile sizes', () => {
    expect(() => cellCenter({ column: -1, row: 0 }, grid)).toThrow(RangeError);
    expect(() => cellCenter({ column: 0.5, row: 0 }, grid)).toThrow(RangeError);
    expect(() =>
      cellCenter({ column: 0, row: 0 }, { tileWidth: 64, tileHeight: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      cellCenter(
        { column: Number.MAX_SAFE_INTEGER, row: 0 },
        { tileWidth: Number.MAX_VALUE, tileHeight: 64 },
      ),
    ).toThrow(RangeError);
  });
});
