import { describe, expect, it } from 'vitest';

import type {
  DomainEvent,
  GridCell,
  IncidentKind,
  IncidentWeights,
  RoverDefinition,
  RoverSnapshot,
  SimulationConfig,
  SimulationEngine,
} from '../src/simulation';
import { createSimulationEngine } from '../src/simulation';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

const roverId = standardRover.id;
const twoStepRoute = [
  { column: 1, row: 0 },
  { column: 2, row: 0 },
] as const;
const cooldownRoute = [
  { column: 1, row: 0 },
  { column: 2, row: 0 },
  { column: 3, row: 0 },
  { column: 4, row: 0 },
  { column: 4, row: 1 },
] as const;

function weightsFor(kind: IncidentKind): IncidentWeights {
  return {
    dustStorm: kind === 'dustStorm' ? 1 : 0,
    meteorite: kind === 'meteorite' ? 1 : 0,
    crater: kind === 'crater' ? 1 : 0,
  };
}

function incidentConfig({
  route = twoStepRoute,
  roverKind = 'courier',
  chance = 1,
  weights = weightsFor('dustStorm'),
  seed = 'incident-test-seed',
  batteryInitial,
}: {
  route?: readonly GridCell[];
  roverKind?: RoverDefinition['kind'];
  chance?: number;
  weights?: IncidentWeights;
  seed?: string;
  batteryInitial?: number;
} = {}): SimulationConfig {
  const endpoint = route.at(-1);
  if (endpoint === undefined) throw new Error('Test route must not be empty');

  const center = {
    ...structuredClone(standardCenter),
    cell: { ...endpoint },
  };
  const rover: RoverDefinition = {
    ...structuredClone(standardRover),
    ...(batteryInitial === undefined ? {} : { batteryInitial }),
    ...(roverKind === 'repair'
      ? {
          archetypeId: 'test-repair',
          kind: 'repair' as const,
          cargoCapacity: 0,
          initialCargo: { oxygen: 0, food: 0, equipment: 0 },
        }
      : {}),
  };
  const base = makeSimulationConfig({
    seed,
    centers: [center],
    rovers: [rover],
  });
  base.equipmentDemand.firstEligibleGameMinute = 10_000;

  return {
    ...base,
    routingMap: {
      ...base.routingMap,
      cells: base.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: chance,
        incidentProfileId: 'test-profile',
      })),
    },
    incidentRules: {
      eventCooldownCells: 3,
      dustStormGameMinutes: 10,
      selfRepairGameMinutes: 10,
      profiles: [
        {
          id: 'test-profile',
          cellChance: chance,
          weights,
        },
      ],
    },
  };
}

function startRoute(
  config: SimulationConfig,
  steps: readonly GridCell[],
): SimulationEngine {
  const engine = createSimulationEngine(config);
  expect(engine.dispatch({ type: 'START_SHIFT' }).ok).toBe(true);
  expect(
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId,
      steps,
      goal: { kind: 'CENTER', centerId: standardCenter.id },
    }),
  ).toEqual({ ok: true, events: [] });
  return engine;
}

function observedRover(engine: SimulationEngine): RoverSnapshot {
  return engine.getSnapshot().rovers[0]!;
}

function incidentEvents(events: readonly DomainEvent[]) {
  return events.filter(
    ({ type }) => type === 'INCIDENT_STARTED' || type === 'INCIDENT_RESOLVED',
  );
}

function advanceUntil(
  engine: SimulationEngine,
  predicate: () => boolean,
  maximumSteps = 500,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    events.push(...engine.advance(100));
    if (predicate()) return events;
  }
  throw new Error('Timed out waiting for simulation condition');
}

function advanceInChunks(
  engine: SimulationEngine,
  totalMilliseconds: number,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  for (let elapsed = 0; elapsed < totalMilliseconds; elapsed += 100) {
    events.push(...engine.advance(100));
  }
  return events;
}

describe('movement incidents', () => {
  it('checks a certain incident only after completing a cell entry', () => {
    const engine = startRoute(incidentConfig(), twoStepRoute);

    expect(engine.advance(1_900)).toEqual([]);
    expect(observedRover(engine)).toMatchObject({
      status: 'MOVING',
      cell: { column: 0, row: 0 },
      battery: 100,
      activeIncident: null,
    });

    expect(engine.advance(100)).toEqual([
      {
        type: 'INCIDENT_STARTED',
        roverId,
        roverKind: 'courier',
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 2,
      },
    ]);
    expect(observedRover(engine)).toMatchObject({
      status: 'DELAYED',
      cell: { column: 1, row: 0 },
      battery: 99,
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 10 },
    });
  });

  it('holds a dust storm for exactly ten game minutes without battery drain or stacking', () => {
    const engine = startRoute(incidentConfig(), twoStepRoute);
    engine.advance(2_000);

    expect(incidentEvents(engine.advance(9_900))).toEqual([]);
    expect(observedRover(engine)).toMatchObject({
      status: 'DELAYED',
      cell: { column: 1, row: 0 },
      battery: 99,
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 0.1 },
    });

    expect(engine.advance(100)).toEqual([
      {
        type: 'INCIDENT_RESOLVED',
        roverId,
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
    ]);
    expect(observedRover(engine)).toMatchObject({
      status: 'MOVING',
      cell: { column: 1, row: 0 },
      battery: 99,
      activeIncident: null,
    });
  });

  it('uses the remainder of an entry tick for an exact timed incident', () => {
    const oneStepRoute = [{ column: 1, row: 0 }] as const;
    const config = incidentConfig({ route: oneStepRoute });
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell, index) =>
        index === 1 ? { ...cell, movementCost: 1.125 } : cell,
      ),
    };
    const engine = startRoute(config, oneStepRoute);

    expect(engine.advance(2_300)).toEqual([
      {
        type: 'INCIDENT_STARTED',
        roverId,
        roverKind: 'courier',
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 2.25,
      },
    ]);
    expect(observedRover(engine).activeIncident).toEqual({
      kind: 'dustStorm',
      remainingGameMinutes: 9.95,
    });
    engine.advance(9_900);
    expect(engine.advance(100)).toEqual([
      {
        type: 'INCIDENT_RESOLVED',
        roverId,
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 12.25,
      },
      {
        type: 'ROVER_ARRIVED',
        roverId,
        cell: { column: 1, row: 0 },
        gameMinute: 12.25,
      },
    ]);
  });

  it('does not allow a route command to cancel an active incident', () => {
    const engine = startRoute(incidentConfig(), twoStepRoute);
    engine.advance(2_000);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId,
        steps: [{ column: 2, row: 0 }],
        goal: { kind: 'CENTER', centerId: standardCenter.id },
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it.each([
    ['meteorite', 'BROKEN'],
    ['crater', 'STUCK'],
  ] as const)(
    'leaves a courier %s incident blocked indefinitely',
    (kind, status) => {
      const engine = startRoute(
        incidentConfig({ weights: weightsFor(kind) }),
        twoStepRoute,
      );

      expect(engine.advance(2_000)).toContainEqual({
        type: 'INCIDENT_STARTED',
        roverId,
        roverKind: 'courier',
        incidentKind: kind,
        cell: { column: 1, row: 0 },
        gameMinute: 2,
      });
      expect(observedRover(engine)).toMatchObject({
        status,
        cell: { column: 1, row: 0 },
        battery: 99,
        activeIncident: { kind, remainingGameMinutes: null },
      });
      const blocked = observedRover(engine);

      expect(incidentEvents(engine.advance(20_000))).toEqual([]);
      expect(observedRover(engine)).toEqual(blocked);
    },
  );

  it.each(['meteorite', 'crater'] as const)(
    'self-repairs a repair unit hit by %s in exactly ten game minutes',
    (kind) => {
      const engine = startRoute(
        incidentConfig({
          roverKind: 'repair',
          weights: weightsFor(kind),
        }),
        twoStepRoute,
      );
      engine.advance(2_000);

      expect(observedRover(engine)).toMatchObject({
        status: 'SELF_REPAIR',
        cell: { column: 1, row: 0 },
        battery: 99,
        activeIncident: { kind, remainingGameMinutes: 10 },
      });
      expect(incidentEvents(engine.advance(9_900))).toEqual([]);
      expect(observedRover(engine)).toMatchObject({
        status: 'SELF_REPAIR',
        battery: 99,
        activeIncident: { kind, remainingGameMinutes: 0.1 },
      });

      expect(engine.advance(100)).toEqual([
        {
          type: 'INCIDENT_RESOLVED',
          roverId,
          incidentKind: kind,
          cell: { column: 1, row: 0 },
          gameMinute: 12,
        },
      ]);
      expect(observedRover(engine)).toMatchObject({
        status: 'MOVING',
        battery: 99,
        activeIncident: null,
      });
    },
  );

  it('skips exactly three successful entries after an incident and checks the fourth', () => {
    const engine = startRoute(
      incidentConfig({ route: cooldownRoute }),
      cooldownRoute,
    );
    const allEvents: DomainEvent[] = [];

    allEvents.push(
      ...advanceUntil(engine, () => observedRover(engine).status === 'DELAYED'),
    );
    allEvents.push(
      ...advanceUntil(
        engine,
        () => observedRover(engine).activeIncident === null,
      ),
    );

    for (const expectedCell of cooldownRoute.slice(1, 4)) {
      const entryEvents = advanceUntil(
        engine,
        () =>
          observedRover(engine).cell.column === expectedCell.column &&
          observedRover(engine).cell.row === expectedCell.row,
      );
      allEvents.push(...entryEvents);
      expect(
        entryEvents.filter(({ type }) => type === 'INCIDENT_STARTED'),
      ).toEqual([]);
      expect(observedRover(engine).status).toBe('MOVING');
    }

    const secondStart = advanceUntil(
      engine,
      () => observedRover(engine).status === 'DELAYED',
    );
    allEvents.push(...secondStart);

    expect(
      allEvents.filter(({ type }) => type === 'INCIDENT_STARTED'),
    ).toHaveLength(2);
    expect(observedRover(engine)).toMatchObject({
      status: 'DELAYED',
      cell: cooldownRoute.at(-1),
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 10 },
    });
  });

  it('is identical for one large advance and equivalent fixed-size chunks', () => {
    const config = incidentConfig({
      route: cooldownRoute,
      roverKind: 'repair',
      seed: 'deterministic-incidents',
      weights: { dustStorm: 5, meteorite: 3, crater: 2 },
    });
    const large = startRoute(config, cooldownRoute);
    const chunked = startRoute(structuredClone(config), cooldownRoute);

    const largeEvents = large.advance(20_000);
    const chunkedEvents = advanceInChunks(chunked, 20_000);

    expect(chunkedEvents).toEqual(largeEvents);
    expect(chunked.getSnapshot()).toEqual(large.getSnapshot());
    expect(largeEvents.some(({ type }) => type === 'INCIDENT_STARTED')).toBe(
      true,
    );
  });

  it('freezes both an active timer and the incident RNG while paused', () => {
    const config = incidentConfig({
      route: cooldownRoute,
      roverKind: 'repair',
      seed: 'pause-incidents',
      weights: { dustStorm: 5, meteorite: 3, crater: 2 },
    });
    const control = startRoute(config, cooldownRoute);
    const paused = startRoute(structuredClone(config), cooldownRoute);
    expect(paused.advance(2_000)).toEqual(control.advance(2_000));

    expect(paused.dispatch({ type: 'PAUSE_SHIFT' }).ok).toBe(true);
    const frozen = paused.getSnapshot();
    expect(paused.advance(60_000)).toEqual([]);
    expect(paused.getSnapshot()).toEqual(frozen);
    expect(paused.dispatch({ type: 'RESUME_SHIFT' }).ok).toBe(true);

    const controlEvents = control.advance(18_000);
    const pausedEvents = paused.advance(18_000);
    expect(pausedEvents).toEqual(controlEvents);
    expect(paused.getSnapshot()).toEqual(control.getSnapshot());
  });

  it('delays final arrival until an incident on the destination is resolved', () => {
    const oneStepRoute = [{ column: 1, row: 0 }] as const;
    const config = incidentConfig({ route: oneStepRoute });
    config.rovers[0]!.initialCargo.oxygen = 10;
    config.centers[0]!.oxygen.initial = 90;
    const engine = startRoute(config, oneStepRoute);

    const startEvents = engine.advance(2_000);
    expect(startEvents).toContainEqual({
      type: 'INCIDENT_STARTED',
      roverId,
      roverKind: 'courier',
      incidentKind: 'dustStorm',
      cell: { column: 1, row: 0 },
      gameMinute: 2,
    });
    expect(startEvents.some(({ type }) => type === 'ROVER_ARRIVED')).toBe(
      false,
    );
    expect(observedRover(engine)).toMatchObject({
      status: 'DELAYED',
      cell: { column: 1, row: 0 },
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 10 },
    });
    const beforeUnload = engine.getSnapshot();
    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId,
        centerId: standardCenter.id,
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(beforeUnload);

    expect(
      engine.advance(9_900).some(({ type }) => type === 'ROVER_ARRIVED'),
    ).toBe(false);
    expect(engine.advance(100)).toEqual([
      {
        type: 'INCIDENT_RESOLVED',
        roverId,
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
      {
        type: 'ROVER_ARRIVED',
        roverId,
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
      {
        type: 'CARGO_DELIVERED',
        roverId,
        centerId: standardCenter.id,
        delivered: { oxygen: 10, food: 0, equipment: 0 },
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
    ]);
    expect(observedRover(engine)).toMatchObject({
      status: 'IDLE_ON_MAP',
      cell: { column: 1, row: 0 },
      activeIncident: null,
      cargo: { oxygen: 0, food: 0, equipment: 0 },
    });
  });

  it('rejects an overflowing runtime incident weight total', () => {
    const config = incidentConfig({
      weights: {
        dustStorm: Number.MAX_VALUE,
        meteorite: Number.MAX_VALUE,
        crater: Number.MAX_VALUE,
      },
    });

    expect(() => createSimulationEngine(config)).toThrow(RangeError);
  });

  it('finishes a final-cell incident before reporting zero battery', () => {
    const oneStepRoute = [{ column: 1, row: 0 }] as const;
    const config = incidentConfig({ route: oneStepRoute, batteryInitial: 1 });
    config.rovers[0]!.batteryCapacity = 1;
    const engine = startRoute(config, oneStepRoute);

    engine.advance(2_000);
    expect(observedRover(engine)).toMatchObject({
      status: 'DELAYED',
      battery: 0,
      activeIncident: { kind: 'dustStorm', remainingGameMinutes: 10 },
    });
    expect(engine.advance(10_000)).toEqual([
      {
        type: 'INCIDENT_RESOLVED',
        roverId,
        incidentKind: 'dustStorm',
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
      {
        type: 'ROVER_ARRIVED',
        roverId,
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
      {
        type: 'ROVER_OUT_OF_BATTERY',
        roverId,
        cell: { column: 1, row: 0 },
        gameMinute: 12,
      },
    ]);
    expect(observedRover(engine)).toMatchObject({
      status: 'OUT_OF_BATTERY',
      cell: { column: 1, row: 0 },
      battery: 0,
      activeIncident: null,
    });
    expect(engine.getSnapshot().rovers[0]!.route).toBeNull();
  });
});
