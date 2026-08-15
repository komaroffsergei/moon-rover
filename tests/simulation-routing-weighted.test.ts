import { describe, expect, it } from 'vitest';

import type { GridCell, RoutingMap } from '../src/simulation';
import { findWeightedRoute } from '../src/simulation';

const origin: GridCell = { column: 0, row: 1 };
const destination: GridCell = { column: 4, row: 1 };
const riskWeighted = { movementCost: 1, incidentRisk: 10 } as const;

function riskChoiceMap(blocked: readonly GridCell[] = []): RoutingMap {
  return {
    width: 5,
    height: 3,
    cells: Array.from({ length: 15 }, (_, index) => {
      const cell = { column: index % 5, row: Math.floor(index / 5) };
      const hazardous = cell.row === 1 && cell.column >= 1 && cell.column <= 3;
      return {
        walkable: !blocked.some(
          ({ column, row }) => column === cell.column && row === cell.row,
        ),
        movementCost: 1,
        effectiveCellChance: hazardous ? 0.16 : 0.0075,
        incidentProfileId: hazardous ? 'hazard-high' : 'normal',
      };
    }),
  };
}

describe('risk-weighted route search', () => {
  it('chooses the longer safe detour when cumulative weighted cost is lower', () => {
    const result = findWeightedRoute(
      origin,
      destination,
      riskChoiceMap(),
      riskWeighted,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.steps).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
      { column: 3, row: 0 },
      { column: 4, row: 0 },
      { column: 4, row: 1 },
    ]);
    expect(result.totalWeight).toBeCloseTo(6.45);
    expect(Object.isFrozen(result.steps)).toBe(true);
    expect(Object.isFrozen(result.steps[0])).toBe(true);
  });

  it('uses movement-only weights when incident risk has zero weight', () => {
    const result = findWeightedRoute(origin, destination, riskChoiceMap(), {
      movementCost: 1,
      incidentRisk: 0,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.steps).toEqual([
      { column: 1, row: 1 },
      { column: 2, row: 1 },
      { column: 3, row: 1 },
      { column: 4, row: 1 },
    ]);
    expect(result.totalWeight).toBe(4);
  });

  it('returns an empty immutable route when origin already is the destination', () => {
    expect(
      findWeightedRoute(origin, origin, riskChoiceMap(), riskWeighted),
    ).toEqual({
      ok: true,
      steps: [],
      totalWeight: 0,
    });
    const result = findWeightedRoute(
      origin,
      origin,
      riskChoiceMap(),
      riskWeighted,
    );
    if (!result.ok) return;
    expect(Object.isFrozen(result.steps)).toBe(true);
  });

  it('rejects invalid endpoints and reports an unreachable destination', () => {
    expect(
      findWeightedRoute(
        { column: -1, row: 1 },
        destination,
        riskChoiceMap(),
        riskWeighted,
      ),
    ).toEqual({ ok: false, code: 'CELL_OUT_OF_BOUNDS' });
    expect(
      findWeightedRoute(
        origin,
        destination,
        riskChoiceMap([destination]),
        riskWeighted,
      ),
    ).toEqual({ ok: false, code: 'CELL_NOT_WALKABLE' });

    const wall = Array.from({ length: 3 }, (_, row) => ({ column: 2, row }));
    expect(
      findWeightedRoute(origin, destination, riskChoiceMap(wall), riskWeighted),
    ).toEqual({
      ok: false,
      code: 'ROUTE_UNREACHABLE',
    });
  });

  it('validates caller-provided weights', () => {
    expect(() =>
      findWeightedRoute(origin, destination, riskChoiceMap(), {
        movementCost: 1,
        incidentRisk: Number.NaN,
      }),
    ).toThrow(RangeError);
    expect(() =>
      findWeightedRoute(origin, destination, riskChoiceMap(), {
        movementCost: 0,
        incidentRisk: 0,
      }),
    ).toThrow(RangeError);
  });
});
