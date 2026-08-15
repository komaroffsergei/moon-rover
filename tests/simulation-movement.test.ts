import { describe, expect, it } from 'vitest';

import type {
  CenterDefinition,
  GridCell,
  RoverDefinition,
  SimulationConfig,
  SimulationEngine,
} from '../src/simulation';
import {
  calculateCellTravelGameMinutes,
  createSimulationEngine,
} from '../src/simulation';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

const origin: GridCell = { column: 0, row: 0 };
const eastCenter: CenterDefinition = {
  ...structuredClone(standardCenter),
  id: 'east-center',
  name: 'Восточный центр',
  cell: { column: 2, row: 0 },
};
const southCenter: CenterDefinition = {
  ...structuredClone(standardCenter),
  id: 'south-center',
  name: 'Южный центр',
  cell: { column: 0, row: 2 },
};

function makeMovementConfig(
  roverOverrides: Partial<RoverDefinition> = {},
  movementCosts: Readonly<Record<number, number>> = {},
): SimulationConfig {
  const safeProfile = {
    id: 'safe',
    cellChance: 0,
    weights: { dustStorm: 1, meteorite: 0, crater: 0 },
  };

  return makeSimulationConfig({
    incidentRules: {
      eventCooldownCells: 3,
      dustStormGameMinutes: 10,
      selfRepairGameMinutes: 10,
      profiles: [safeProfile],
    },
    routingMap: {
      width: 3,
      height: 3,
      cells: Array.from({ length: 9 }, (_, index) => ({
        walkable: true,
        movementCost: movementCosts[index] ?? 1,
        effectiveCellChance: 0,
        incidentProfileId: safeProfile.id,
      })),
    },
    centers: [eastCenter, southCenter],
    rovers: [{ ...structuredClone(standardRover), ...roverOverrides }],
  });
}

function startEngine(config = makeMovementConfig()): SimulationEngine {
  const engine = createSimulationEngine(config);
  expect(engine.dispatch({ type: 'START_SHIFT' })).toEqual({
    ok: true,
    events: [],
  });
  return engine;
}

function assignEastRoute(engine: SimulationEngine): void {
  expect(
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: standardRover.id,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: eastCenter.id },
    }),
  ).toEqual({ ok: true, events: [] });
}

describe('fixed-step rover movement', () => {
  it('uses destination terrain cost and debits battery only on exact entry', () => {
    const destinationMovementCost = 2;
    const rover = {
      ...structuredClone(standardRover),
      batteryCapacity: 10,
      batteryInitial: 10,
      batteryCostMultiplier: 1.5,
    };
    const adjacentCenter = {
      ...eastCenter,
      cell: { column: 1, row: 0 },
    };
    const configWithAdjacentGoal = makeMovementConfig(rover, {
      1: destinationMovementCost,
    });
    configWithAdjacentGoal.centers = [adjacentCenter, southCenter];
    const exactEngine = startEngine(configWithAdjacentGoal);

    expect(
      exactEngine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: rover.id,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CENTER', centerId: adjacentCenter.id },
      }),
    ).toEqual({ ok: true, events: [] });

    const durationGameMinutes = calculateCellTravelGameMinutes(
      destinationMovementCost,
      rover.gameMinutesPerNormalCell,
    );
    exactEngine.advance(durationGameMinutes * 1_000 - 100);
    const beforeEntry = exactEngine.getSnapshot().rovers[0]!;
    expect(beforeEntry.cell).toEqual(origin);
    expect(beforeEntry.battery).toBe(10);
    expect(beforeEntry.movement).toMatchObject({
      from: origin,
      to: { column: 1, row: 0 },
    });
    expect(beforeEntry.movement?.progress).toBeCloseTo(0.975);

    exactEngine.advance(100);
    expect(exactEngine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 1, row: 0 },
      battery: 7,
      status: 'IDLE_ON_MAP',
      movement: null,
      route: null,
    });
  });

  it('finishes every route cell, clears the assignment and derives idle location', () => {
    const engine = startEngine();
    assignEastRoute(engine);

    engine.advance(4_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: eastCenter.cell,
      battery: 98,
      status: 'IDLE_ON_MAP',
      movement: null,
      route: null,
    });

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [{ column: 1, row: 0 }, origin],
        goal: { kind: 'BASE' },
      }),
    ).toEqual({ ok: true, events: [] });
    engine.advance(4_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: origin,
      battery: standardRover.batteryCapacity,
      status: 'IDLE_AT_BASE',
      movement: null,
      route: null,
    });
  });

  it('completes the current entry, clamps insufficient battery and stops', () => {
    const engine = startEngine(
      makeMovementConfig({ batteryCapacity: 0.5, batteryInitial: 0.5 }),
    );
    assignEastRoute(engine);

    engine.advance(2_000);
    const exhausted = engine.getSnapshot().rovers[0]!;
    expect(exhausted).toMatchObject({
      cell: { column: 1, row: 0 },
      battery: 0,
      status: 'OUT_OF_BATTERY',
      movement: null,
    });
    expect(exhausted.route?.steps).toEqual([
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ]);

    engine.advance(30_000);
    expect(engine.getSnapshot().rovers[0]).toEqual(exhausted);
  });

  it('freezes interpolation while paused', () => {
    const engine = startEngine();
    assignEastRoute(engine);
    engine.advance(1_000);
    const moving = engine.getSnapshot().rovers[0]!;
    expect(moving.movement?.progress).toBeCloseTo(0.5);

    expect(engine.dispatch({ type: 'PAUSE_SHIFT' }).ok).toBe(true);
    engine.advance(60_000);
    expect(engine.getSnapshot().rovers[0]).toEqual(moving);
  });

  it('redirects mid-segment after the committed edge without resetting progress', () => {
    const engine = startEngine();
    assignEastRoute(engine);
    engine.advance(1_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: origin,
      battery: 100,
      movement: {
        from: origin,
        to: { column: 1, row: 0 },
        progress: 0.5,
      },
    });

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 1, row: 0 },
          { column: 1, row: 1 },
          { column: 0, row: 1 },
          { column: 0, row: 2 },
        ],
        goal: { kind: 'CENTER', centerId: southCenter.id },
      }),
    ).toEqual({ ok: true, events: [] });

    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: origin,
      battery: 100,
      movement: {
        from: origin,
        to: { column: 1, row: 0 },
        progress: 0.5,
      },
      route: {
        origin,
        steps: [
          { column: 1, row: 0 },
          { column: 1, row: 1 },
          { column: 0, row: 1 },
          { column: 0, row: 2 },
        ],
      },
    });

    engine.advance(1_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 1, row: 0 },
      battery: 99,
      movement: {
        from: { column: 1, row: 0 },
        to: { column: 1, row: 1 },
        progress: 0,
      },
    });

    engine.advance(6_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: southCenter.cell,
      battery: 96,
      status: 'IDLE_ON_MAP',
      movement: null,
      route: null,
    });
  });

  it('rejects a mid-segment redirect that would abandon the committed edge', () => {
    const engine = startEngine();
    assignEastRoute(engine);
    engine.advance(1_000);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [
          { column: 0, row: 1 },
          { column: 0, row: 2 },
        ],
        goal: { kind: 'CENTER', centerId: southCenter.id },
      }),
    ).toEqual({ ok: false, code: 'ROUTE_INVALID' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('normalizes sub-nanominute duration precision instead of stalling', () => {
    const adjacentCenter = {
      ...eastCenter,
      cell: { column: 1, row: 0 },
    };
    const config = makeMovementConfig({}, { 1: 0.5000000002 });
    config.centers = [adjacentCenter, southCenter];
    const engine = startEngine(config);

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: standardRover.id,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CENTER', centerId: adjacentCenter.id },
      }),
    ).toEqual({ ok: true, events: [] });
    engine.advance(1_000);

    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 1, row: 0 },
      route: null,
      movement: null,
    });
  });
});
