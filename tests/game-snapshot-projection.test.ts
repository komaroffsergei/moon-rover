import { describe, expect, it } from 'vitest';

import { roverWorldPosition } from '../src/game/renderers/snapshotProjection';

const tiles = { tileWidth: 64, tileHeight: 32 };

describe('snapshot projection', () => {
  it('projects an authoritative fractional navigation position', () => {
    expect(
      roverWorldPosition(
        {
          cell: { column: 0, row: 0 },
          position: { column: 0.25, row: 0.5 },
          movement: null,
        },
        tiles,
      ),
    ).toEqual({ x: 48, y: 32 });
  });

  it('places a stationary rover at the center of its snapshot cell', () => {
    expect(
      roverWorldPosition(
        { cell: { column: 2, row: 3 }, movement: null },
        tiles,
      ),
    ).toEqual({ x: 160, y: 112 });
  });

  it.each([
    [0, { x: 32, y: 16 }],
    [0.25, { x: 64, y: 24 }],
    [0.5, { x: 96, y: 32 }],
    [1, { x: 160, y: 48 }],
  ])('interpolates movement progress %s', (progress, expected) => {
    expect(
      roverWorldPosition(
        {
          cell: { column: 0, row: 0 },
          movement: {
            from: { column: 0, row: 0 },
            to: { column: 2, row: 1 },
            progress,
          },
        },
        tiles,
      ),
    ).toEqual(expected);
  });

  it.each([
    [-1, { x: 32, y: 16 }],
    [2, { x: 160, y: 48 }],
    [Number.NaN, { x: 32, y: 16 }],
  ])('safely normalizes movement progress %s', (progress, expected) => {
    expect(
      roverWorldPosition(
        {
          cell: { column: 0, row: 0 },
          movement: {
            from: { column: 0, row: 0 },
            to: { column: 2, row: 1 },
            progress,
          },
        },
        tiles,
      ),
    ).toEqual(expected);
  });

  it('does not mutate movement data while projecting it', () => {
    const rover = {
      cell: { column: 0, row: 0 },
      movement: {
        from: { column: 0, row: 0 },
        to: { column: 2, row: 1 },
        progress: 0.5,
      },
    };
    const before = structuredClone(rover);

    roverWorldPosition(rover, tiles);

    expect(rover).toEqual(before);
  });
});
