import { describe, expect, it } from 'vitest';

import type { GridCell, RoutingMap } from '../src/simulation';
import { appendRouteStep, createRouteDraft } from '../src/simulation';

function routingMap(blocked: readonly GridCell[] = []): RoutingMap {
  return {
    width: 3,
    height: 3,
    cells: Array.from({ length: 9 }, (_, index) => {
      const cell = { column: index % 3, row: Math.floor(index / 3) };
      return {
        walkable: !blocked.some(
          ({ column, row }) => column === cell.column && row === cell.row,
        ),
        movementCost: 1,
        effectiveCellChance: 0.01,
        incidentProfileId: 'normal',
      };
    }),
  };
}

function appendOrThrow(
  draft: ReturnType<typeof createRouteDraft>,
  cell: GridCell,
  map = routingMap(),
) {
  const result = appendRouteStep(draft, cell, map);
  if (!result.ok) throw new Error(result.code);
  return result.draft;
}

describe('manual route draft', () => {
  it.each([
    { column: 1, row: 0 },
    { column: 2, row: 1 },
    { column: 1, row: 2 },
    { column: 0, row: 1 },
  ])(
    'accepts cardinal neighbor $column,$row without mutating input',
    (cell) => {
      const draft = createRouteDraft({ column: 1, row: 1 });
      const result = appendRouteStep(draft, cell, routingMap());

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.draft.steps).toEqual([cell]);
      expect(draft.steps).toEqual([]);
      expect(result.draft).not.toBe(draft);
    },
  );

  it.each([
    [{ column: 2, row: 2 }, 'CELL_NOT_ADJACENT'],
    [{ column: 1, row: 1 }, 'CELL_NOT_ADJACENT'],
    [{ column: -1, row: 1 }, 'CELL_OUT_OF_BOUNDS'],
    [{ column: 3, row: 1 }, 'CELL_OUT_OF_BOUNDS'],
  ] as const)('rejects invalid click %o atomically', (cell, code) => {
    const draft = createRouteDraft({ column: 1, row: 1 });

    expect(appendRouteStep(draft, cell, routingMap())).toEqual({
      ok: false,
      code,
    });
    expect(draft.steps).toEqual([]);
  });

  it('rejects a blocked neighbor and never fills an alternate path', () => {
    const draft = createRouteDraft({ column: 1, row: 1 });
    const blocked = { column: 2, row: 1 };

    expect(appendRouteStep(draft, blocked, routingMap([blocked]))).toEqual({
      ok: false,
      code: 'CELL_NOT_WALKABLE',
    });
    expect(draft.steps).toEqual([]);
  });

  it('rejects immediate reversal in an explicit route sequence', () => {
    const origin = { column: 1, row: 1 };
    const oneStep = appendOrThrow(createRouteDraft(origin), {
      column: 2,
      row: 1,
    });

    expect(appendRouteStep(oneStep, origin, routingMap())).toEqual({
      ok: false,
      code: 'UNDO_REQUIRED',
    });
    expect(oneStep.steps).toEqual([{ column: 2, row: 1 }]);
  });

  it('rejects repeating the current tail without changing the draft', () => {
    const oneStep = appendOrThrow(createRouteDraft({ column: 0, row: 0 }), {
      column: 1,
      row: 0,
    });

    expect(
      appendRouteStep(oneStep, { column: 1, row: 0 }, routingMap()),
    ).toEqual({ ok: false, code: 'CELL_NOT_ADJACENT' });
    expect(oneStep.steps).toEqual([{ column: 1, row: 0 }]);
  });
});
