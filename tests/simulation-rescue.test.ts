import { describe, expect, it } from 'vitest';

import type {
  IncidentKind,
  RoverDefinition,
  SimulationConfig,
  SimulationEngine,
} from '../src/simulation';
import {
  createSimulationEngine,
  forecastBatteryTransfer,
  projectRoverActionAvailability,
} from '../src/simulation';
import { beginAutomaticRoverRepairAfterArrival } from '../src/simulation/rescue/emergencyOperations';
import type { MutableEmergencyOperation } from '../src/simulation/rescue/types';
import { createRoverState } from '../src/simulation/rovers/createRoverState';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

const targetId = 'target-courier';
const helperId = 'helper-rover';
const repairId = 'repair-unit';
const donorId = 'battery-donor';

function courier(
  id: string,
  initialCell: RoverDefinition['initialCell'],
  overrides: Partial<RoverDefinition> = {},
): RoverDefinition {
  return {
    ...structuredClone(standardRover),
    id,
    name: id,
    initialCell,
    ...overrides,
  };
}

function repair(
  id: string,
  initialCell: RoverDefinition['initialCell'],
  overrides: Partial<RoverDefinition> = {},
): RoverDefinition {
  return {
    ...structuredClone(standardRover),
    id,
    name: id,
    archetypeId: 'repair',
    kind: 'repair',
    initialCell,
    cargoCapacity: 0,
    initialCargo: { oxygen: 0, food: 0, equipment: 0 },
    ...overrides,
  };
}

function centerAt(column: number, row = 0) {
  return {
    ...structuredClone(standardCenter),
    cell: { column, row },
  };
}

function forcedIncidentConfig(
  kind: Extract<IncidentKind, 'meteorite' | 'crater'>,
  helper: RoverDefinition,
): SimulationConfig {
  const profile = {
    id: `certain-${kind}`,
    cellChance: 1,
    weights: {
      dustStorm: 0,
      meteorite: kind === 'meteorite' ? 1 : 0,
      crater: kind === 'crater' ? 1 : 0,
    },
  };
  const target = courier(
    targetId,
    { column: 0, row: 0 },
    {
      initialCargo: { oxygen: 7, food: 3, equipment: 0 },
    },
  );
  const base = makeSimulationConfig({
    seed: `rescue-${kind}`,
    centers: [centerAt(2)],
    rovers: [target, helper],
  });
  base.equipmentDemand.firstEligibleGameMinute = 10_000;
  return {
    ...base,
    incidentRules: { ...base.incidentRules, profiles: [profile] },
    routingMap: {
      ...base.routingMap,
      cells: base.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 1,
        incidentProfileId: profile.id,
      })),
    },
  };
}

function crashedEngine(
  kind: Extract<IncidentKind, 'meteorite' | 'crater'>,
  helper: RoverDefinition,
): SimulationEngine {
  const engine = createSimulationEngine(forcedIncidentConfig(kind, helper));
  engine.dispatch({ type: 'START_SHIFT' });
  expect(
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: targetId,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: standardCenter.id },
    }).ok,
  ).toBe(true);
  engine.advance(2_000);
  return engine;
}

function automaticRepairConfig(
  helper: RoverDefinition = repair(repairId, { column: 0, row: 1 }),
): SimulationConfig {
  const config = forcedIncidentConfig('meteorite', helper);
  const meteoriteProfile = config.incidentRules.profiles[0]!;
  const safeProfile = {
    id: 'automatic-repair-safe',
    cellChance: 0,
    weights: { dustStorm: 1, meteorite: 0, crater: 0 },
  };
  config.incidentRules = {
    ...config.incidentRules,
    profiles: [meteoriteProfile, safeProfile],
  };
  config.routingMap = {
    ...config.routingMap,
    cells: config.routingMap.cells.map((cell, index) => ({
      ...cell,
      effectiveCellChance: index === 6 ? 1 : 0,
      incidentProfileId: index === 6 ? meteoriteProfile.id : safeProfile.id,
    })),
  };
  return config;
}

function prepareAutomaticRepairEngine(
  helper: RoverDefinition = repair(repairId, { column: 0, row: 1 }),
): SimulationEngine {
  const engine = createSimulationEngine(automaticRepairConfig(helper));
  engine.dispatch({ type: 'START_SHIFT' });
  expect(
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: targetId,
      steps: [
        { column: 0, row: 1 },
        { column: 1, row: 1 },
      ],
      goal: { kind: 'CELL', cell: { column: 1, row: 1 } },
    }).ok,
  ).toBe(true);
  engine.advance(4_000);
  expect(
    engine.getSnapshot().rovers.find(({ id }) => id === targetId),
  ).toMatchObject({
    status: 'BROKEN',
    cell: { column: 1, row: 1 },
    activeIncident: { kind: 'meteorite' },
  });
  return engine;
}

function startRepairOperation(): SimulationEngine {
  const engine = crashedEngine(
    'meteorite',
    repair(repairId, { column: 1, row: 1 }),
  );
  expect(
    engine.dispatch({
      type: 'START_ROVER_REPAIR',
      repairRoverId: repairId,
      targetRoverId: targetId,
    }),
  ).toEqual({
    ok: true,
    events: [
      {
        type: 'EMERGENCY_OPERATION_STARTED',
        operationKind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        durationGameMinutes: 5,
        cell: { column: 1, row: 0 },
        gameMinute: 2,
      },
    ],
  });
  return engine;
}

describe('emergency repair', () => {
  it('automatically repairs after a fractional final arrival with exact timing and stable event order', () => {
    const whole = prepareAutomaticRepairEngine();
    const chunks = prepareAutomaticRepairEngine();
    for (const engine of [whole, chunks]) {
      expect(
        engine.dispatch({
          type: 'ROUTE_ROVER_TO',
          roverId: repairId,
          destination: { column: 1, row: 2 },
        }).ok,
      ).toBe(true);
    }

    const startEvents = whole.advance(2_900);
    const chunkStartEvents = Array.from({ length: 29 }).flatMap(() =>
      chunks.advance(100),
    );
    expect(chunkStartEvents).toEqual(startEvents);
    expect(startEvents).toEqual([
      {
        type: 'ROVER_ARRIVED',
        roverId: repairId,
        cell: { column: 1, row: 2 },
        gameMinute: 6.828427124,
      },
      {
        type: 'EMERGENCY_OPERATION_STARTED',
        operationKind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        durationGameMinutes: 5,
        cell: { column: 1, row: 1 },
        gameMinute: 6.828427124,
      },
    ]);
    expect(whole.getSnapshot().emergencyOperations).toEqual([
      {
        kind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        remainingGameMinutes: 4.928427124,
      },
    ]);
    expect(
      whole
        .getSnapshot()
        .radioMessages.slice(0, 2)
        .map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.repair.started', 'rover.arrived']);
    expect(
      projectRoverActionAvailability(whole.getSnapshot(), {
        column: 0,
        row: 0,
      }).flatMap(({ repairCommands }) => repairCommands),
    ).toEqual([]);

    const completionEvents = whole.advance(5_000);
    const chunkCompletionEvents = Array.from({ length: 50 }).flatMap(() =>
      chunks.advance(100),
    );
    expect(chunkCompletionEvents).toEqual(completionEvents);
    expect(completionEvents[0]).toMatchObject({
      type: 'EMERGENCY_OPERATION_COMPLETED',
      operationKind: 'REPAIR',
      gameMinute: 11.828427124,
    });
    expect(
      (completionEvents[0]?.gameMinute ?? 0) - startEvents[0]!.gameMinute,
    ).toBeCloseTo(5, 9);
    expect(chunks.getSnapshot()).toEqual(whole.getSnapshot());
  });

  it('uses same-cell then target ID for deterministic automatic repair selection', () => {
    const base = { column: 4, row: 2 };
    const helper = createRoverState(
      repair(repairId, { column: 1, row: 1 }),
      base,
    );
    const makeBrokenState = (id: string, column: number, row: number) => {
      const target = createRoverState(courier(id, { column, row }), base);
      target.status = 'BROKEN';
      target.activeIncident = { kind: 'meteorite', remainingGameMinutes: null };
      return target;
    };
    const adjacent = makeBrokenState('00-adjacent', 1, 0);
    const sameCellLater = makeBrokenState('z-same', 1, 1);
    const sameCellFirst = makeBrokenState('a-same', 1, 1);
    const operations: MutableEmergencyOperation[] = [];

    expect(
      beginAutomaticRoverRepairAfterArrival(
        [adjacent, sameCellLater, helper, sameCellFirst],
        operations,
        helper.id,
        { repairGameMinutes: 5, craterRescueGameMinutes: 3 },
        7,
        0,
        base,
      ),
    ).toEqual([
      {
        type: 'EMERGENCY_OPERATION_STARTED',
        operationKind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: 'a-same',
        durationGameMinutes: 5,
        cell: { column: 1, row: 1 },
        gameMinute: 7,
      },
    ]);
    expect(operations).toEqual([
      {
        kind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: 'a-same',
        remainingGameMinutes: 5,
      },
    ]);
  });

  it('does not auto-start on pass-through or a depleted final arrival', () => {
    const passThrough = prepareAutomaticRepairEngine(
      repair(repairId, { column: 0, row: 2 }),
    );
    passThrough.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: repairId,
      destination: { column: 2, row: 2 },
    });
    expect(
      passThrough
        .advance(4_000)
        .filter(({ type }) => type === 'EMERGENCY_OPERATION_STARTED'),
    ).toEqual([]);
    expect(passThrough.getSnapshot().emergencyOperations).toEqual([]);

    const depleted = prepareAutomaticRepairEngine(
      repair(
        repairId,
        { column: 0, row: 2 },
        { batteryCapacity: 1, batteryInitial: 1 },
      ),
    );
    depleted.dispatch({
      type: 'ROUTE_ROVER_TO',
      roverId: repairId,
      destination: { column: 1, row: 2 },
    });
    expect(depleted.advance(2_000).map(({ type }) => type)).toEqual([
      'ROVER_ARRIVED',
      'ROVER_OUT_OF_BATTERY',
    ]);
    expect(depleted.getSnapshot().emergencyOperations).toEqual([]);
  });

  it('repairs a broken courier in exactly five minutes and explicitly clears its route', () => {
    const engine = startRepairOperation();
    const started = engine.getSnapshot();
    const targetBefore = started.rovers.find(({ id }) => id === targetId)!;
    const helperBefore = started.rovers.find(({ id }) => id === repairId)!;

    expect(started.emergencyOperations).toEqual([
      {
        kind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        remainingGameMinutes: 5,
      },
    ]);
    expect(targetBefore).toMatchObject({ status: 'BROKEN' });
    expect(helperBefore).toMatchObject({ status: 'REPAIRING' });

    expect(engine.advance(4_900)).toEqual([]);
    expect(engine.getSnapshot().emergencyOperations[0]).toMatchObject({
      remainingGameMinutes: 0.1,
    });
    expect(engine.advance(100)).toEqual([
      {
        type: 'EMERGENCY_OPERATION_COMPLETED',
        operationKind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        cell: { column: 1, row: 0 },
        gameMinute: 7,
      },
      {
        type: 'INCIDENT_RESOLVED',
        roverId: targetId,
        incidentKind: 'meteorite',
        cell: { column: 1, row: 0 },
        gameMinute: 7,
      },
    ]);

    const completed = engine.getSnapshot();
    const target = completed.rovers.find(({ id }) => id === targetId)!;
    const helper = completed.rovers.find(({ id }) => id === repairId)!;
    expect(completed.emergencyOperations).toEqual([]);
    expect(target).toMatchObject({
      status: 'IDLE_ON_MAP',
      cell: targetBefore.cell,
      cargo: targetBefore.cargo,
      battery: targetBefore.battery,
      activeIncident: null,
      route: null,
    });
    expect(helper).toMatchObject({
      status: 'IDLE_ON_MAP',
      cell: helperBefore.cell,
      battery: helperBefore.battery,
    });

    engine.advance(20_000);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === targetId),
    ).toMatchObject({
      cell: targetBefore.cell,
      route: null,
    });
  });

  it('rejects an unsuitable, remote or already busy repair helper atomically', () => {
    const wrongKind = crashedEngine(
      'meteorite',
      courier(helperId, { column: 1, row: 1 }),
    );
    const wrongKindBefore = wrongKind.getSnapshot();
    expect(
      wrongKind.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'RESCUER_INVALID_KIND' });
    expect(wrongKind.getSnapshot()).toEqual(wrongKindBefore);

    const remote = crashedEngine(
      'meteorite',
      repair(repairId, { column: 4, row: 2 }),
    );
    expect(
      remote.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_OUT_OF_RANGE' });

    const busy = startRepairOperation();
    const busyBefore = busy.getSnapshot();
    expect(
      busy.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(busy.getSnapshot()).toEqual(busyBefore);
  });

  it('rejects invalid repair targets, zero-charge helpers and diagonal range', () => {
    const healthyConfig = makeSimulationConfig({
      rovers: [
        courier(targetId, { column: 1, row: 0 }),
        repair(repairId, { column: 1, row: 1 }),
      ],
    });
    const healthy = createSimulationEngine(healthyConfig);
    healthy.dispatch({ type: 'START_SHIFT' });
    expect(
      healthy.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'TARGET_NOT_BROKEN' });

    const emptyHelper = crashedEngine(
      'meteorite',
      repair(repairId, { column: 1, row: 1 }, { batteryInitial: 0 }),
    );
    expect(
      emptyHelper.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });

    const diagonal = crashedEngine(
      'meteorite',
      repair(repairId, { column: 0, row: 1 }),
    );
    expect(
      diagonal.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_OUT_OF_RANGE' });
  });

  it('freezes a repair in pause and remains invariant to advance chunking', () => {
    const whole = startRepairOperation();
    const chunks = startRepairOperation();
    const paused = startRepairOperation();

    paused.dispatch({ type: 'PAUSE_SHIFT' });
    const frozen = paused.getSnapshot();
    expect(paused.advance(60_000)).toEqual([]);
    expect(paused.getSnapshot()).toEqual(frozen);
    paused.dispatch({ type: 'RESUME_SHIFT' });

    const wholeEvents = whole.advance(5_000);
    const chunkEvents = Array.from({ length: 50 }).flatMap(() =>
      chunks.advance(100),
    );
    expect(chunkEvents).toEqual(wholeEvents);
    expect(chunks.getSnapshot()).toEqual(whole.getSnapshot());
    expect(paused.advance(5_000)).toEqual(wholeEvents);
    expect(paused.getSnapshot()).toEqual(whole.getSnapshot());
  });

  it('resolves a final-cell incident on the same cell and preserves out-of-battery ordering', () => {
    const config = forcedIncidentConfig(
      'meteorite',
      repair(repairId, { column: 1, row: 0 }),
    );
    config.centers = [centerAt(1)];
    config.rovers = config.rovers.map((rover) =>
      rover.id === targetId
        ? { ...rover, batteryCapacity: 1, batteryInitial: 1 }
        : rover,
    );
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: targetId,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CENTER', centerId: standardCenter.id },
      }).ok,
    ).toBe(true);
    engine.advance(2_000);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === targetId),
    ).toMatchObject({
      status: 'BROKEN',
      cell: { column: 1, row: 0 },
      battery: 0,
    });

    expect(
      engine.dispatch({
        type: 'START_ROVER_REPAIR',
        repairRoverId: repairId,
        targetRoverId: targetId,
      }).ok,
    ).toBe(true);
    const completionEvents = engine.advance(5_000);
    expect(completionEvents.map(({ type }) => type)).toEqual([
      'EMERGENCY_OPERATION_COMPLETED',
      'INCIDENT_RESOLVED',
      'ROVER_ARRIVED',
      'CARGO_DELIVERED',
      'ROVER_OUT_OF_BATTERY',
    ]);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === targetId),
    ).toMatchObject({
      status: 'OUT_OF_BATTERY',
      route: null,
      activeIncident: null,
    });
    const remainingCargo = engine
      .getSnapshot()
      .rovers.find(({ id }) => id === targetId)?.cargo;
    expect(remainingCargo?.oxygen).toBeCloseTo(5.5625);
    expect(remainingCargo?.food).toBeCloseTo(1.5625);
    expect(remainingCargo?.equipment).toBe(0);
  });

  it('locks both operation participants against unrelated commands', () => {
    const engine = startRepairOperation();
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({ type: 'CHARGE_ROVER', roverId: repairId }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: targetId,
        centerId: standardCenter.id,
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('keeps emergency operation snapshots isolated from engine state', () => {
    const engine = startRepairOperation();
    const externalSnapshot = engine.getSnapshot();

    expect(Object.isFrozen(externalSnapshot.emergencyOperations[0])).toBe(true);
    (externalSnapshot.emergencyOperations as unknown[]).length = 0;
    expect(engine.getSnapshot().emergencyOperations).toEqual([
      {
        kind: 'REPAIR',
        helperRoverId: repairId,
        targetRoverId: targetId,
        remainingGameMinutes: 5,
      },
    ]);
  });
});

describe('crater rescue', () => {
  it('allows a repair rover to rescue on the same cell', () => {
    const engine = crashedEngine(
      'crater',
      repair(helperId, { column: 1, row: 0 }),
    );

    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toMatchObject({ ok: true });
    const started = engine.getSnapshot();
    expect(started.emergencyOperations).toHaveLength(1);
    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(started);
  });

  it('rejects a target without a crater incident', () => {
    const config = makeSimulationConfig({
      rovers: [
        courier(targetId, { column: 1, row: 0 }),
        repair(helperId, { column: 1, row: 1 }),
      ],
    });
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'TARGET_NOT_STUCK' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('holds both cells for three minutes, then preserves and resumes the target route', () => {
    const engine = crashedEngine(
      'crater',
      courier(helperId, { column: 1, row: 1 }),
    );
    const before = engine.getSnapshot();
    const targetBefore = before.rovers.find(({ id }) => id === targetId)!;
    const helperBefore = before.rovers.find(({ id }) => id === helperId)!;

    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toEqual({
      ok: true,
      events: [
        {
          type: 'EMERGENCY_OPERATION_STARTED',
          operationKind: 'RESCUE',
          helperRoverId: helperId,
          targetRoverId: targetId,
          durationGameMinutes: 3,
          cell: { column: 1, row: 0 },
          gameMinute: 2,
        },
      ],
    });
    expect(engine.advance(2_900)).toEqual([]);
    expect(engine.getSnapshot().rovers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetId, cell: targetBefore.cell }),
        expect.objectContaining({ id: helperId, cell: helperBefore.cell }),
      ]),
    );
    expect(engine.advance(100)).toEqual([
      {
        type: 'EMERGENCY_OPERATION_COMPLETED',
        operationKind: 'RESCUE',
        helperRoverId: helperId,
        targetRoverId: targetId,
        cell: { column: 1, row: 0 },
        gameMinute: 5,
      },
      {
        type: 'INCIDENT_RESOLVED',
        roverId: targetId,
        incidentKind: 'crater',
        cell: { column: 1, row: 0 },
        gameMinute: 5,
      },
    ]);

    const rescued = engine
      .getSnapshot()
      .rovers.find(({ id }) => id === targetId)!;
    expect(rescued).toMatchObject({
      status: 'MOVING',
      cell: targetBefore.cell,
      route: targetBefore.route,
      activeIncident: null,
    });
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === helperId),
    ).toMatchObject({
      status: 'IDLE_ON_MAP',
      cell: helperBefore.cell,
    });

    engine.advance(2_000);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === targetId),
    ).toMatchObject({
      status: 'IDLE_ON_MAP',
      cell: { column: 2, row: 0 },
      route: null,
    });
  });

  it('rejects non-adjacent rescue without crossing or teleporting through a blocked cell', () => {
    const config = forcedIncidentConfig(
      'crater',
      courier(helperId, { column: 3, row: 0 }),
    );
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell, index) =>
        index === 2 ? { ...cell, walkable: false } : cell,
      ),
    };
    config.centers = [centerAt(1)];
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: targetId,
      steps: [{ column: 1, row: 0 }],
      goal: { kind: 'CENTER', centerId: standardCenter.id },
    });
    engine.advance(2_000);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toEqual({ ok: false, code: 'ROVER_OUT_OF_RANGE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('uses only the remainder of a fixed step after a non-aligned rescue completion', () => {
    const config = forcedIncidentConfig(
      'crater',
      courier(helperId, { column: 1, row: 1 }),
    );
    config.rescueRules = {
      ...config.rescueRules,
      craterRescueGameMinutes: 3.05,
    };
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: targetId,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: standardCenter.id },
    });
    engine.advance(2_000);
    expect(
      engine.dispatch({
        type: 'START_CRATER_RESCUE',
        rescuerRoverId: helperId,
        targetRoverId: targetId,
      }),
    ).toMatchObject({
      ok: true,
      events: [expect.objectContaining({ durationGameMinutes: 3.05 })],
    });

    expect(engine.advance(3_100)).toEqual([
      {
        type: 'EMERGENCY_OPERATION_COMPLETED',
        operationKind: 'RESCUE',
        helperRoverId: helperId,
        targetRoverId: targetId,
        cell: { column: 1, row: 0 },
        gameMinute: 5.05,
      },
      {
        type: 'INCIDENT_RESOLVED',
        roverId: targetId,
        incidentKind: 'crater',
        cell: { column: 1, row: 0 },
        gameMinute: 5.05,
      },
    ]);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === targetId),
    ).toMatchObject({
      status: 'MOVING',
      movement: { progress: 0.025 },
    });
  });
});

function transferConfig({
  repairBattery = 0,
  donorBattery = 120,
  donorKind = 'courier',
  donorCell = { column: 1, row: 1 },
  recipientKind = 'repair',
}: {
  repairBattery?: number;
  donorBattery?: number;
  donorKind?: RoverDefinition['kind'];
  donorCell?: RoverDefinition['initialCell'];
  recipientKind?: RoverDefinition['kind'];
} = {}): SimulationConfig {
  const receiver =
    recipientKind === 'repair'
      ? repair(
          repairId,
          { column: 1, row: 0 },
          {
            batteryInitial: repairBattery,
          },
        )
      : courier(repairId, { column: 1, row: 0 }, { batteryInitial: 0 });
  const donor =
    donorKind === 'repair'
      ? repair(donorId, donorCell, { batteryInitial: donorBattery })
      : courier(donorId, donorCell, {
          archetypeId: 'heavy',
          batteryCapacity: 120,
          batteryInitial: donorBattery,
        });
  return makeSimulationConfig({ rovers: [receiver, donor] });
}

describe('confirmed full battery transfer', () => {
  it('keeps preview pure, discards overflow and changes both batteries only on confirm', () => {
    const config = transferConfig();
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(forecastBatteryTransfer(120, 100)).toEqual({
      donorBatteryAfter: 0,
      repairBatteryAfter: 100,
      discardedCharge: 20,
    });
    const preciseForecast = forecastBatteryTransfer(100.0000000004, 100);
    expect(preciseForecast).toMatchObject({
      donorBatteryAfter: 0,
      repairBatteryAfter: 100,
    });
    expect(preciseForecast.discardedCharge).toBeGreaterThan(0);
    expect(
      preciseForecast.repairBatteryAfter + preciseForecast.discardedCharge,
    ).toBe(100.0000000004);
    expect(engine.getSnapshot()).toEqual(before);

    expect(
      engine.dispatch({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: donorId,
        repairRoverId: repairId,
      }),
    ).toEqual({
      ok: true,
      events: [
        {
          type: 'BATTERY_TRANSFERRED',
          donorRoverId: donorId,
          repairRoverId: repairId,
          transferredCharge: 100,
          discardedCharge: 20,
          cell: { column: 1, row: 0 },
          gameMinute: 0,
        },
        {
          type: 'ROVER_OUT_OF_BATTERY',
          roverId: donorId,
          cell: { column: 1, row: 1 },
          gameMinute: 0,
        },
      ],
    });
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === donorId),
    ).toMatchObject({
      battery: 0,
      status: 'OUT_OF_BATTERY',
    });
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === repairId),
    ).toMatchObject({
      battery: 100,
      status: 'IDLE_ON_MAP',
    });
    const transferred = engine.getSnapshot();
    expect(
      engine.dispatch({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: donorId,
        repairRoverId: repairId,
      }),
    ).toEqual({ ok: false, code: 'REPAIR_BATTERY_NOT_EMPTY' });
    expect(engine.getSnapshot()).toEqual(transferred);
  });

  it('preserves and resumes the stopped repair route after confirmed transfer', () => {
    const receiver = repair(
      repairId,
      { column: 0, row: 0 },
      {
        batteryInitial: 1,
      },
    );
    const donor = courier(
      donorId,
      { column: 1, row: 1 },
      {
        batteryInitial: 50,
      },
    );
    const config = makeSimulationConfig({
      centers: [centerAt(2)],
      rovers: [receiver, donor],
    });
    config.baseCell = { column: 0, row: 1 };
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: repairId,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: standardCenter.id },
    });
    engine.advance(2_000);
    const stoppedRoute = engine
      .getSnapshot()
      .rovers.find(({ id }) => id === repairId)!.route;

    expect(
      engine.dispatch({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: donorId,
        repairRoverId: repairId,
      }).ok,
    ).toBe(true);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === repairId),
    ).toMatchObject({
      battery: 50,
      status: 'MOVING',
      route: stoppedRoute,
    });
    engine.advance(2_000);
    expect(
      engine.getSnapshot().rovers.find(({ id }) => id === repairId),
    ).toMatchObject({
      cell: { column: 2, row: 0 },
      status: 'IDLE_ON_MAP',
      route: null,
    });
  });

  it.each([
    [
      'charged repair target',
      transferConfig({ repairBattery: 1 }),
      'REPAIR_BATTERY_NOT_EMPTY',
    ],
    ['empty donor', transferConfig({ donorBattery: 0 }), 'DONOR_BATTERY_EMPTY'],
    [
      'non-courier donor',
      transferConfig({ donorKind: 'repair', donorBattery: 100 }),
      'BATTERY_DONOR_INVALID',
    ],
    [
      'remote donor',
      transferConfig({ donorCell: { column: 4, row: 2 } }),
      'ROVER_OUT_OF_RANGE',
    ],
    [
      'same-cell donor',
      transferConfig({ donorCell: { column: 1, row: 0 } }),
      'ROVER_OUT_OF_RANGE',
    ],
    [
      'diagonal donor',
      transferConfig({ donorCell: { column: 0, row: 1 } }),
      'ROVER_OUT_OF_RANGE',
    ],
    [
      'non-repair recipient',
      transferConfig({ recipientKind: 'courier' }),
      'BATTERY_RECIPIENT_INVALID',
    ],
  ] as const)('rejects %s atomically', (_label, config, code) => {
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: donorId,
        repairRoverId: repairId,
      }),
    ).toEqual({ ok: false, code });
    expect(engine.getSnapshot()).toEqual(before);
  });
});
