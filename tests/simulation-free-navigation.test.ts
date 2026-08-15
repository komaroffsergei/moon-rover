import { describe, expect, it } from 'vitest';

import type { GridCell, RoutingMap, SimulationConfig } from '../src/simulation';
import { createSimulationEngine, findNavigationRoute } from '../src/simulation';
import { navigationDistancesFrom } from '../src/content/validation/grid';
import { traceGridSegment } from '../src/shared/navigation/traceGridSegment';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

function createRoutingMap(
  width: number,
  height: number,
  blocked: readonly GridCell[] = [],
  incidentChance = 0,
): RoutingMap {
  return {
    width,
    height,
    cells: Array.from({ length: width * height }, (_, index) => {
      const cell = { column: index % width, row: Math.floor(index / width) };
      return {
        walkable: !blocked.some(
          (candidate) =>
            candidate.column === cell.column && candidate.row === cell.row,
        ),
        movementCost: 1,
        effectiveCellChance: incidentChance,
        incidentProfileId: 'safe',
      };
    }),
  };
}

function freeNavigationConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return makeSimulationConfig({
    routingMap: createRoutingMap(4, 3),
    centers: [structuredClone(standardCenter)],
    rovers: [structuredClone(standardRover)],
    incidentRules: {
      eventCooldownCells: 3,
      dustStormGameMinutes: 10,
      selfRepairGameMinutes: 10,
      profiles: [
        {
          id: 'safe',
          cellChance: 0,
          weights: { dustStorm: 1, meteorite: 0, crater: 0 },
        },
      ],
    },
    ...overrides,
  });
}

describe('free-navigation routing kernel', () => {
  it('uses one arbitrary-angle LOS leg on an open map', () => {
    const map = createRoutingMap(4, 3);
    const result = findNavigationRoute(
      { column: 0, row: 0 },
      { column: 0, row: 0 },
      { column: 3, row: 2 },
      map,
      { movementCost: 1, incidentRisk: 10 },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.steps).toEqual([{ column: 3, row: 2 }]);
    expect(result.legs).toHaveLength(1);
    expect(result.legs[0]).toMatchObject({
      from: { column: 0, row: 0 },
      to: { column: 3, row: 2 },
    });
    expect(result.legs[0]!.distance).toBeCloseTo(Math.sqrt(13));
  });

  it('provides deterministic supercover intersections and forbids corner cutting', () => {
    const intersections = traceGridSegment(
      { column: 0, row: 0 },
      { column: 1, row: 1 },
      { width: 2, height: 2 },
    );
    expect(intersections.map(({ cell }) => cell)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ]);

    const result = findNavigationRoute(
      { column: 0, row: 0 },
      { column: 0, row: 0 },
      { column: 1, row: 1 },
      createRoutingMap(2, 2, [
        { column: 1, row: 0 },
        { column: 0, row: 1 },
      ]),
      { movementCost: 1, incidentRisk: 0 },
    );
    expect(result).toEqual({ ok: false, code: 'ROUTE_UNREACHABLE' });

    const openResult = findNavigationRoute(
      { column: 0, row: 0 },
      { column: 0, row: 0 },
      { column: 1, row: 1 },
      createRoutingMap(2, 2),
      { movementCost: 1, incidentRisk: 10 },
    );
    expect(openResult).toMatchObject({ ok: true });
    if (!openResult.ok) return;
    expect(openResult.legs[0]!.traversals.map(({ cell }) => cell)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 1 },
    ]);
  });

  it('detours around blocked terrain with stable tie-breaking', () => {
    const map = createRoutingMap(3, 3, [{ column: 1, row: 1 }]);
    const first = findNavigationRoute(
      { column: 0, row: 1 },
      { column: 0, row: 1 },
      { column: 2, row: 1 },
      map,
      { movementCost: 1, incidentRisk: 0 },
    );
    const second = findNavigationRoute(
      { column: 0, row: 1 },
      { column: 0, row: 1 },
      { column: 2, row: 1 },
      map,
      { movementCost: 1, incidentRisk: 0 },
    );

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    if (!first.ok) return;
    expect(first.steps.at(-1)).toEqual({ column: 2, row: 1 });
    expect(first.legs.length).toBeGreaterThan(1);
    expect(
      first.legs.flatMap(({ traversals }) =>
        traversals.map(({ cell }) => cell),
      ),
    ).not.toContainEqual({ column: 1, row: 1 });
  });

  it('matches content navigation distance on a uniform visibility graph', () => {
    const blocked = [{ column: 1, row: 1 }];
    const map = createRoutingMap(3, 3, blocked);
    const result = findNavigationRoute(
      { column: 0, row: 1 },
      { column: 0, row: 1 },
      { column: 2, row: 1 },
      map,
      { movementCost: 1, incidentRisk: 0 },
    );
    const contentDistance = navigationDistancesFrom(
      {
        width: map.width,
        height: map.height,
        blocked: map.cells.map(({ walkable }) => !walkable),
        hazardous: Array<boolean>(map.cells.length).fill(false),
      },
      { column: 0, row: 1 },
    )[5];

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(contentDistance).toBeDefined();
    expect(result.totalWeight).toBeCloseTo(contentDistance!);
  });

  it('uses existing incident weight alongside Euclidean movement distance', () => {
    const baseMap = createRoutingMap(5, 3);
    const map: RoutingMap = {
      ...baseMap,
      cells: baseMap.cells.map((cell, index) => {
        const column = index % baseMap.width;
        const row = Math.floor(index / baseMap.width);
        return {
          ...cell,
          effectiveCellChance: row === 1 && column >= 1 && column <= 3 ? 1 : 0,
        };
      }),
    };
    const result = findNavigationRoute(
      { column: 0, row: 1 },
      { column: 0, row: 1 },
      { column: 4, row: 1 },
      map,
      { movementCost: 1, incidentRisk: 10 },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const enteredHazards = result.legs.flatMap(({ traversals }) =>
      traversals.filter(
        ({ cell, entersCell }) =>
          entersCell && cell.row === 1 && cell.column >= 1 && cell.column <= 3,
      ),
    );
    expect(enteredHazards).toEqual([]);
    expect(result.steps.at(-1)).toEqual({ column: 4, row: 1 });
  });
});

describe('free-navigation simulation command', () => {
  it('moves diagonally with distance-aware time and battery', () => {
    const engine = createSimulationEngine(freeNavigationConfig());
    engine.dispatch({ type: 'START_SHIFT' });

    expect(
      engine.dispatch({
        type: 'ROUTE_ROVER_TO',
        roverId: standardRover.id,
        destination: { column: 2, row: 1 },
      }),
    ).toEqual({ ok: true, events: [] });

    const assigned = engine.getSnapshot().rovers[0]!;
    expect(assigned.route).toMatchObject({
      mode: 'FREE_NAVIGATION',
      steps: [{ column: 2, row: 1 }],
    });
    expect(assigned.movement).toMatchObject({
      from: { column: 0, row: 0 },
      to: { column: 2, row: 1 },
      progress: 0,
    });

    engine.advance(500);
    const moving = engine.getSnapshot().rovers[0]!;
    expect(moving.position.column).toBeGreaterThan(0);
    expect(moving.position.row).toBeGreaterThan(0);
    expect(moving.battery).toBeCloseTo(99.75);
  });

  it('reroutes from the exact live position and reverses immediately', () => {
    const engine = createSimulationEngine(freeNavigationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: standardRover.id,
      destination: { column: 3, row: 0 },
    });
    engine.advance(500);

    const before = engine.getSnapshot().rovers[0]!;
    const oldDirection = {
      column: before.movement!.to.column - before.movement!.from.column,
      row: before.movement!.to.row - before.movement!.from.row,
    };
    const position = structuredClone(before.position);
    const battery = before.battery;

    expect(
      engine.dispatch({
        type: 'ROUTE_ROVER_TO',
        roverId: standardRover.id,
        destination: { column: 0, row: 0 },
      }),
    ).toEqual({ ok: true, events: [] });

    const after = engine.getSnapshot().rovers[0]!;
    expect(after.position).toEqual(position);
    expect(after.battery).toBe(battery);
    expect(after.movement?.from).toEqual(position);
    const newDirection = {
      column: after.movement!.to.column - after.movement!.from.column,
      row: after.movement!.to.row - after.movement!.from.row,
    };
    expect(
      oldDirection.column * newDirection.column +
        oldDirection.row * newDirection.row,
    ).toBeLessThan(0);
  });

  it('rejects a legacy route assignment without moving a free-navigation rover', () => {
    const engine = createSimulationEngine(freeNavigationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: standardRover.id,
      destination: { column: 3, row: 0 },
    });
    engine.advance(500);

    const before = engine.getSnapshot();
    expect(before.rovers[0]).toMatchObject({
      status: 'MOVING',
      route: { mode: 'FREE_NAVIGATION' },
    });
    expect(before.rovers[0]!.position.column).toBeGreaterThan(0);
    expect(before.rovers[0]!.position.column).toBeLessThan(1);

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CELL', cell: { column: 1, row: 0 } },
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('preserves the current assignment when a new target is invalid', () => {
    const engine = createSimulationEngine(freeNavigationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: standardRover.id,
      destination: { column: 3, row: 0 },
    });
    engine.advance(500);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'ROUTE_ROVER_TO',
        roverId: standardRover.id,
        destination: { column: 99, row: 0 },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_INVALID' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('checks an incident once at a crossed-cell entry', () => {
    const routingMap = createRoutingMap(3, 1, [], 1);
    const engine = createSimulationEngine(
      freeNavigationConfig({
        routingMap,
        incidentRules: {
          eventCooldownCells: 3,
          dustStormGameMinutes: 10,
          selfRepairGameMinutes: 10,
          profiles: [
            {
              id: 'safe',
              cellChance: 1,
              weights: { dustStorm: 1, meteorite: 0, crater: 0 },
            },
          ],
        },
      }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: standardRover.id,
      destination: { column: 2, row: 0 },
    });

    const firstEvents = engine.advance(1_000);
    expect(
      firstEvents.filter(({ type }) => type === 'INCIDENT_STARTED'),
    ).toHaveLength(1);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 1, row: 0 },
      position: { column: 0.5, row: 0 },
      status: 'DELAYED',
    });

    const resumeEvents = engine.advance(10_000);
    expect(
      resumeEvents.filter(({ type }) => type === 'INCIDENT_STARTED'),
    ).toHaveLength(0);
  });
});
