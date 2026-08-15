import { describe, expect, it } from 'vitest';

import type { GridCell, RoutingMap } from '../src/simulation';
import {
  appendRouteStep,
  candidateRouteCells,
  createRouteDraft,
} from '../src/simulation';

function routingMap(blocked: readonly GridCell[] = []): RoutingMap {
  return {
    width: 3,
    height: 3,
    cells: Array.from({ length: 9 }, (_, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      return {
        walkable: !blocked.some(
          (cell) => cell.column === column && cell.row === row,
        ),
        movementCost: 1,
        effectiveCellChance: 0.01,
        incidentProfileId: 'normal',
      };
    }),
  };
}

describe('candidateRouteCells', () => {
  it('returns appendable cells in deterministic cardinal order', () => {
    const draft = createRouteDraft({ column: 1, row: 1 });

    expect(candidateRouteCells(draft, routingMap())).toEqual([
      { column: 1, row: 0 },
      { column: 2, row: 1 },
      { column: 1, row: 2 },
      { column: 0, row: 1 },
    ]);
    expect(draft.steps).toEqual([]);
  });

  it('excludes bounds, blocked cells and an immediate reverse', () => {
    const map = routingMap([{ column: 2, row: 0 }]);
    const appended = appendRouteStep(
      createRouteDraft({ column: 0, row: 0 }),
      { column: 1, row: 0 },
      map,
    );
    if (!appended.ok) throw new Error(appended.code);

    expect(candidateRouteCells(appended.draft, map)).toEqual([
      { column: 1, row: 1 },
    ]);
  });

  it('returns a deeply immutable array and rejects invalid drafts', () => {
    const candidates = candidateRouteCells(
      createRouteDraft({ column: 0, row: 0 }),
      routingMap(),
    );

    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates[0])).toBe(true);
    expect(() =>
      candidateRouteCells(
        {
          origin: { column: 0, row: 0 },
          steps: [{ column: 2, row: 0 }],
        },
        routingMap(),
      ),
    ).toThrow(RangeError);
  });
});
