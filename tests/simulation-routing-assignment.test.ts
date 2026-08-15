import { describe, expect, it } from 'vitest';

import type { RoverDefinition } from '../src/simulation';
import { createSimulationEngine } from '../src/simulation';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

const center = {
  ...structuredClone(standardCenter),
  cell: { column: 2, row: 0 },
};

const targetRover: RoverDefinition = {
  ...structuredClone(standardRover),
  id: 'target-rover',
  name: 'Целевой ровер',
  initialCell: { column: 2, row: 2 },
};

function runningEngine(rovers: readonly RoverDefinition[] = [standardRover]) {
  const engine = createSimulationEngine(
    makeSimulationConfig({
      centers: [center],
      rovers: structuredClone(rovers),
    }),
  );
  expect(engine.dispatch({ type: 'START_SHIFT' })).toEqual({
    ok: true,
    events: [],
  });
  return engine;
}

describe('route assignment and redirect', () => {
  it('rejects malformed runtime routing data before creating state', () => {
    const mutations: Array<
      (config: ReturnType<typeof makeSimulationConfig>) => void
    > = [
      (config) => {
        config.routingMap = { ...config.routingMap, width: 0 };
      },
      (config) => {
        config.routeWeights = { ...config.routeWeights, movementCost: 0 };
      },
      (config) => {
        config.routeWeights = { ...config.routeWeights, incidentRisk: -1 };
      },
      (config) => {
        config.routingMap = {
          ...config.routingMap,
          cells: config.routingMap.cells.map((cell, index) =>
            index === 0 ? { ...cell, movementCost: 0 } : cell,
          ),
        };
      },
      (config) => {
        config.routingMap = {
          ...config.routingMap,
          cells: config.routingMap.cells.map((cell, index) =>
            index === 0 ? { ...cell, effectiveCellChance: 1.01 } : cell,
          ),
        };
      },
      (config) => {
        config.routingMap = {
          ...config.routingMap,
          cells: config.routingMap.cells.map((cell, index) =>
            index === 0 ? { ...cell, walkable: false } : cell,
          ),
        };
      },
    ];

    for (const mutate of mutations) {
      const config = makeSimulationConfig();
      mutate(config);
      expect(() => createSimulationEngine(config)).toThrow(RangeError);
    }
  });

  it('keeps the logical cell and battery unchanged before the first entry', () => {
    const engine = runningEngine();
    const result = engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: standardRover.id,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    expect(result).toEqual({ ok: true, events: [] });
    const assigned = engine.getSnapshot().rovers[0]!;
    expect(assigned.status).toBe('MOVING');
    expect(assigned.route).toMatchObject({
      origin: { column: 0, row: 0 },
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: center.id },
      forecast: { lengthCells: 2 },
    });

    const battery = assigned.battery;
    engine.advance(100);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 0, row: 0 },
      battery,
      route: { steps: assigned.route?.steps },
    });
  });

  it('redirects a moving rover by replacing, not appending, its old route', () => {
    const engine = runningEngine([standardRover, targetRover]);
    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
        goal: { kind: 'CENTER', centerId: center.id },
      }).ok,
    ).toBe(true);

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 0, row: 1 },
          { column: 0, row: 2 },
          { column: 1, row: 2 },
          { column: 2, row: 2 },
        ],
        goal: { kind: 'ROVER', roverId: targetRover.id },
      }),
    ).toEqual({ ok: true, events: [] });

    expect(engine.getSnapshot().rovers[0]!.route).toMatchObject({
      origin: { column: 0, row: 0 },
      steps: [
        { column: 0, row: 1 },
        { column: 0, row: 2 },
        { column: 1, row: 2 },
        { column: 2, row: 2 },
      ],
      goal: { kind: 'ROVER', roverId: targetRover.id },
    });
  });

  it('accepts base, occupied rover and cardinal rescue goals', () => {
    const offBase = {
      ...structuredClone(standardRover),
      initialCell: { column: 1, row: 0 },
    };
    const baseEngine = runningEngine([offBase]);
    expect(
      baseEngine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: offBase.id,
        steps: [{ column: 0, row: 0 }],
        goal: { kind: 'BASE' },
      }).ok,
    ).toBe(true);

    const rescueEngine = runningEngine([standardRover, targetRover]);
    expect(
      rescueEngine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 1, row: 1 },
          { column: 2, row: 1 },
        ],
        goal: { kind: 'RESCUE_ADJACENT', roverId: targetRover.id },
      }).ok,
    ).toBe(true);

    const occupiedIntermediateEngine = runningEngine([
      standardRover,
      {
        ...structuredClone(targetRover),
        initialCell: { column: 1, row: 0 },
      },
    ]);
    expect(
      occupiedIntermediateEngine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
        goal: { kind: 'CENTER', centerId: center.id },
      }).ok,
    ).toBe(true);
  });

  it('rejects invalid path or live goal atomically', () => {
    const engine = runningEngine([standardRover, targetRover]);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [{ column: 2, row: 0 }],
        goal: { kind: 'CENTER', centerId: center.id },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_INVALID' });
    expect(engine.getSnapshot()).toEqual(before);

    const config = makeSimulationConfig({
      centers: [center],
      rovers: [structuredClone(standardRover)],
    });
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell, index) =>
        index === 1 ? { ...cell, walkable: false } : cell,
      ),
    };
    const blockedEngine = createSimulationEngine(config);
    blockedEngine.dispatch({ type: 'START_SHIFT' });
    const blockedBefore = blockedEngine.getSnapshot();
    expect(
      blockedEngine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
        goal: { kind: 'CENTER', centerId: center.id },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_INVALID' });
    expect(blockedEngine.getSnapshot()).toEqual(blockedBefore);

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CENTER', centerId: center.id },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });
    expect(engine.getSnapshot()).toEqual(before);

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 2, row: 0 },
        ],
        goal: { kind: 'CENTER', centerId: 'missing' },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_GOAL_INVALID' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('is unavailable outside an active shift and allows paused planning', () => {
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    const command = {
      type: 'ASSIGN_ROVER_ROUTE' as const,
      roverId: standardRover.id,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER' as const, centerId: center.id },
    };

    expect(engine.dispatch(command)).toEqual({
      ok: false,
      code: 'SHIFT_NOT_ACTIVE',
    });
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({ type: 'PAUSE_SHIFT' });
    expect(engine.dispatch(command).ok).toBe(true);
  });

  it('defensively owns command data and confirmed snapshots', () => {
    const engine = runningEngine();
    const steps = [
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ];
    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps,
        goal: { kind: 'CENTER', centerId: center.id },
      }).ok,
    ).toBe(true);
    steps[0]!.column = 99;

    const route = engine.getSnapshot().rovers[0]!.route!;
    expect(route.steps[0]).toEqual({ column: 1, row: 0 });
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.steps[0])).toBe(true);
  });
});
