import { describe, expect, it } from 'vitest';

import type { RouteGoalContext, RoutingMap } from '../src/simulation';
import {
  appendRouteStep,
  calculateCellBatteryCost,
  calculateCellTravelGameMinutes,
  confirmRouteDraft,
  createRouteDraft,
  forecastRoute,
} from '../src/simulation';

const map: RoutingMap = {
  width: 3,
  height: 2,
  cells: [
    {
      walkable: true,
      movementCost: 99,
      effectiveCellChance: 0.9,
      incidentProfileId: 'normal',
    },
    {
      walkable: true,
      movementCost: 2,
      effectiveCellChance: 0.1,
      incidentProfileId: 'normal',
    },
    {
      walkable: true,
      movementCost: 1.5,
      effectiveCellChance: 0.2,
      incidentProfileId: 'normal',
    },
    {
      walkable: true,
      movementCost: 1,
      effectiveCellChance: 0,
      incidentProfileId: 'normal',
    },
    {
      walkable: true,
      movementCost: 1,
      effectiveCellChance: 0,
      incidentProfileId: 'normal',
    },
    {
      walkable: true,
      movementCost: 1,
      effectiveCellChance: 1,
      incidentProfileId: 'normal',
    },
  ],
};

const profile = {
  gameMinutesPerNormalCell: 2,
  batteryCostMultiplier: 1.1,
  currentBattery: 10,
};

const goalContext: RouteGoalContext = {
  baseCell: { column: 0, row: 0 },
  centers: [{ id: 'center', cell: { column: 2, row: 0 } }],
  rovers: [{ id: 'target', cell: { column: 2, row: 1 } }],
};

function routeToCenter() {
  const first = appendRouteStep(
    createRouteDraft({ column: 0, row: 0 }),
    { column: 1, row: 0 },
    map,
  );
  if (!first.ok) throw new Error(first.code);
  const second = appendRouteStep(first.draft, { column: 2, row: 0 }, map);
  if (!second.ok) throw new Error(second.code);
  return second.draft;
}

describe('route forecast and confirmation', () => {
  it('uses shared entry-cost functions and excludes the origin', () => {
    const draft = routeToCenter();
    const forecast = forecastRoute(draft, map, profile);

    expect(calculateCellTravelGameMinutes(2, 2)).toBe(4);
    expect(calculateCellBatteryCost(2, 1.1)).toBeCloseTo(2.2);
    expect(forecast.lengthCells).toBe(2);
    expect(forecast.gameMinutes).toBe(7);
    expect(forecast.batteryCost).toBeCloseTo(3.85);
    expect(forecast.batteryRemaining).toBeCloseTo(6.15);
    expect(forecast.risk).toBeCloseTo(0.28);
  });

  it('subtracts the completed part of a preserved first edge from ETA only', () => {
    const forecast = forecastRoute(routeToCenter(), map, {
      ...profile,
      firstStepProgress: 0.5,
    });

    expect(forecast).toMatchObject({ lengthCells: 2, gameMinutes: 5 });
    expect(forecast.batteryCost).toBeCloseTo(3.85);
    expect(forecast.batteryRemaining).toBeCloseTo(6.15);
    expect(forecast.risk).toBeCloseTo(0.28);
  });

  it('handles empty and certain-risk paths without leaking invalid ranges', () => {
    expect(
      forecastRoute(createRouteDraft({ column: 0, row: 0 }), map, profile),
    ).toEqual({
      lengthCells: 0,
      gameMinutes: 0,
      batteryCost: 0,
      batteryRemaining: 10,
      risk: 0,
    });

    const first = appendRouteStep(
      createRouteDraft({ column: 2, row: 0 }),
      { column: 2, row: 1 },
      map,
    );
    if (!first.ok) throw new Error(first.code);
    expect(forecastRoute(first.draft, map, profile).risk).toBe(1);
  });

  it('rejects reconstructed invalid drafts without row-index aliasing', () => {
    expect(() =>
      forecastRoute(
        {
          origin: { column: 0, row: 0 },
          steps: [{ column: map.width, row: 0 }],
        },
        map,
        profile,
      ),
    ).toThrow('допустимый ручной маршрут');
    expect(() =>
      forecastRoute(
        {
          origin: { column: 0, row: 0 },
          steps: [{ column: 1, row: 1 }],
        },
        map,
        profile,
      ),
    ).toThrow('допустимый ручной маршрут');
  });

  it('counts repeated entries and clamps exhausted battery at zero', () => {
    const first = appendRouteStep(
      createRouteDraft({ column: 0, row: 0 }),
      { column: 1, row: 0 },
      map,
    );
    if (!first.ok) throw new Error(first.code);
    const second = appendRouteStep(first.draft, { column: 1, row: 1 }, map);
    if (!second.ok) throw new Error(second.code);
    const third = appendRouteStep(second.draft, { column: 2, row: 1 }, map);
    if (!third.ok) throw new Error(third.code);
    const fourth = appendRouteStep(third.draft, { column: 2, row: 0 }, map);
    if (!fourth.ok) throw new Error(fourth.code);
    const fifth = appendRouteStep(fourth.draft, { column: 1, row: 0 }, map);
    if (!fifth.ok) throw new Error(fifth.code);

    const forecast = forecastRoute(fifth.draft, map, {
      ...profile,
      currentBattery: 1,
    });
    expect(forecast).toMatchObject({
      lengthCells: 5,
      gameMinutes: 15,
      batteryRemaining: 0,
    });
    expect(forecast.batteryCost).toBeCloseTo(8.25);
    expect(forecast.risk).toBe(1);
  });

  it('creates a deeply immutable confirmed route for a live valid goal', () => {
    const sourceOrigin = { column: 0, row: 0 };
    const sourceFirst = { column: 1, row: 0 };
    const sourceSecond = { column: 2, row: 0 };
    const first = appendRouteStep(
      createRouteDraft(sourceOrigin),
      sourceFirst,
      map,
    );
    if (!first.ok) throw new Error(first.code);
    const second = appendRouteStep(first.draft, sourceSecond, map);
    if (!second.ok) throw new Error(second.code);
    const result = confirmRouteDraft(
      second.draft,
      map,
      profile,
      {
        kind: 'CENTER',
        centerId: 'center',
      },
      goalContext,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    sourceOrigin.column = 99;
    sourceFirst.column = 99;
    sourceSecond.column = 99;
    expect(result.route.steps).toEqual([
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ]);
    expect(Object.isFrozen(result.route)).toBe(true);
    expect(Object.isFrozen(result.route.origin)).toBe(true);
    expect(Object.isFrozen(result.route.steps)).toBe(true);
    expect(Object.isFrozen(result.route.steps[0])).toBe(true);
    expect(Object.isFrozen(result.route.goal)).toBe(true);
    expect(Object.isFrozen(result.route.forecast)).toBe(true);
    expect(() =>
      (result.route.steps as Array<{ column: number; row: number }>).push({
        column: 9,
        row: 9,
      }),
    ).toThrow();
  });

  it('accepts an arbitrary CELL goal only at its exact endpoint', () => {
    const goalCell = { column: 2, row: 0 };
    const result = confirmRouteDraft(
      routeToCenter(),
      map,
      profile,
      { kind: 'CELL', cell: goalCell },
      goalContext,
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    goalCell.column = 0;
    expect(result.route.goal).toEqual({
      kind: 'CELL',
      cell: { column: 2, row: 0 },
    });
    expect(Object.isFrozen(result.route.goal)).toBe(true);
    if (result.route.goal.kind === 'CELL') {
      expect(Object.isFrozen(result.route.goal.cell)).toBe(true);
    }

    expect(
      confirmRouteDraft(
        routeToCenter(),
        map,
        profile,
        { kind: 'CELL', cell: { column: 1, row: 0 } },
        goalContext,
      ),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });
  });

  it('rejects empty routes, unknown goals and arbitrary endpoints', () => {
    expect(
      confirmRouteDraft(
        createRouteDraft({ column: 0, row: 0 }),
        map,
        profile,
        { kind: 'BASE' },
        goalContext,
      ),
    ).toEqual({ ok: false, code: 'ROUTE_EMPTY' });
    expect(
      confirmRouteDraft(
        routeToCenter(),
        map,
        profile,
        {
          kind: 'CENTER',
          centerId: 'missing',
        },
        goalContext,
      ),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });

    const oneStep = appendRouteStep(
      createRouteDraft({ column: 0, row: 0 }),
      { column: 1, row: 0 },
      map,
    );
    if (!oneStep.ok) throw new Error(oneStep.code);
    expect(
      confirmRouteDraft(
        oneStep.draft,
        map,
        profile,
        {
          kind: 'CENTER',
          centerId: 'center',
        },
        goalContext,
      ),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });
  });

  it('requires an orthogonally adjacent endpoint for a rescue goal', () => {
    const diagonal = appendRouteStep(
      createRouteDraft({ column: 0, row: 0 }),
      { column: 1, row: 0 },
      map,
    );
    if (!diagonal.ok) throw new Error(diagonal.code);
    expect(
      confirmRouteDraft(
        diagonal.draft,
        map,
        profile,
        { kind: 'RESCUE_ADJACENT', roverId: 'target' },
        goalContext,
      ),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });

    const first = appendRouteStep(
      createRouteDraft({ column: 0, row: 0 }),
      { column: 0, row: 1 },
      map,
    );
    if (!first.ok) throw new Error(first.code);
    const adjacent = appendRouteStep(first.draft, { column: 1, row: 1 }, map);
    if (!adjacent.ok) throw new Error(adjacent.code);
    expect(
      confirmRouteDraft(
        adjacent.draft,
        map,
        profile,
        { kind: 'RESCUE_ADJACENT', roverId: 'target' },
        goalContext,
      ).ok,
    ).toBe(true);
  });
});
