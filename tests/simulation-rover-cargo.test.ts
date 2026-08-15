import { describe, expect, it } from 'vitest';

import { createSimulationEngine, type DomainEvent } from '../src/simulation';
import {
  baseCell,
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

function oxygenThresholds(events: readonly DomainEvent[]): number[] {
  return events.flatMap((event) =>
    event.type === 'RESOURCE_THRESHOLD' && event.resource === 'oxygen'
      ? [event.threshold]
      : [],
  );
}

describe('rover cargo', () => {
  it('services a rover at base and restores the latest fractional loadout on return', () => {
    const center = structuredClone(standardCenter);
    center.cell = { column: 1, row: 0 };
    center.equipmentInitial = 99.8;
    const rover = structuredClone(standardRover);
    rover.batteryInitial = 7;
    rover.initialCargo = { oxygen: 0, food: 0, equipment: 0.125 };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);

    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      battery: rover.batteryCapacity,
      cargo: rover.initialCargo,
      status: 'IDLE_AT_BASE',
    });
    expect(
      engine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: rover.id,
        cargo: { oxygen: 0, food: 0, equipment: 0.35 },
      }),
    ).toEqual({ ok: true, events: [] });
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [center.cell],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    const arrivalEvents = engine.advance(2_000);
    const delivery = arrivalEvents.find(
      (event) => event.type === 'CARGO_DELIVERED',
    );
    expect(delivery).toMatchObject({
      type: 'CARGO_DELIVERED',
      roverId: rover.id,
      centerId: center.id,
      delivered: { oxygen: 0, food: 0 },
      cell: center.cell,
      gameMinute: 2,
    });
    expect(
      delivery?.type === 'CARGO_DELIVERED'
        ? delivery.delivered.equipment
        : Number.NaN,
    ).toBeCloseTo(0.2, 12);
    expect(engine.getSnapshot().rovers[0]!.cargo.equipment).toBeCloseTo(
      0.15,
      12,
    );

    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [baseCell],
      goal: { kind: 'BASE' },
    });
    engine.advance(2_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      battery: rover.batteryCapacity,
      cargo: { oxygen: 0, food: 0, equipment: 0.35 },
      status: 'IDLE_AT_BASE',
    });
  });

  it('services an exhausted rover on final base arrival without an empty-battery event', () => {
    const rover = structuredClone(standardRover);
    rover.initialCell = { column: 1, row: 0 };
    rover.batteryInitial = 1;
    const config = makeSimulationConfig({ rovers: [rover] });
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
      roverId: rover.id,
      steps: [baseCell],
      goal: { kind: 'BASE' },
    });

    const events = engine.advance(2_000);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ROVER_ARRIVED', roverId: rover.id }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: 'ROVER_OUT_OF_BATTERY',
        roverId: rover.id,
      }),
    );
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      battery: rover.batteryCapacity,
      status: 'IDLE_AT_BASE',
    });
  });

  it('preserves cargo at pass-through and auto-unloads capped cargo at final center arrival', () => {
    const passThrough = structuredClone(standardCenter);
    passThrough.id = 'pass-through';
    passThrough.cell = { column: 1, row: 0 };
    passThrough.equipmentInitial = 90;
    const destination = structuredClone(standardCenter);
    destination.id = 'destination';
    destination.cell = { column: 2, row: 0 };
    destination.equipmentInitial = 99.75;
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 0, food: 0, equipment: 0.4 };
    const config = makeSimulationConfig({
      centers: [passThrough, destination],
      rovers: [rover],
    });
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [passThrough.cell, destination.cell],
      goal: { kind: 'CENTER', centerId: destination.id },
    });

    expect(engine.advance(2_000)).not.toContainEqual(
      expect.objectContaining({ type: 'CARGO_DELIVERED' }),
    );
    expect(engine.getSnapshot().centers[0]!.resources.equipment).toBe(90);
    expect(engine.getSnapshot().rovers[0]!.cargo.equipment).toBe(0.4);

    const beforeArrival = engine.getSnapshot();
    const events = engine.advance(2_000);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'CARGO_DELIVERED',
        roverId: rover.id,
        centerId: destination.id,
        delivered: { oxygen: 0, food: 0, equipment: 0.25 },
      }),
    );
    const after = engine.getSnapshot();
    expect(after.rovers[0]!.cargo.equipment).toBeCloseTo(0.15, 12);
    expect(
      beforeArrival.centers[1]!.resources.equipment +
        beforeArrival.rovers[0]!.cargo.equipment,
    ).toBeCloseTo(
      after.centers[1]!.resources.equipment + after.rovers[0]!.cargo.equipment,
      12,
    );
  });

  it('auto-unloads every cargo type at a recovery center and conserves fractional excess', () => {
    const center = structuredClone(standardCenter);
    center.cell = { column: 1, row: 0 };
    center.oxygen.initial = 80;
    center.food.initial = 85;
    center.equipmentInitial = 1;
    const rover = structuredClone(standardRover);
    rover.initialCargo = {
      oxygen: 11.5,
      food: 10.75,
      equipment: 120.25,
    };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    config.equipmentDemand = {
      firstEligibleGameMinute: 0,
      minimumIntervalGameMinutes: 10_000,
      lossMin: 1,
      lossMax: 1,
    };
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);
    expect(engine.getSnapshot().centers[0]!.status).toBe('RECOVERY');
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [center.cell],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    const events = engine.advance(2_000);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'CARGO_DELIVERED',
        roverId: rover.id,
        centerId: center.id,
        delivered: { oxygen: 11.5, food: 10.75, equipment: 100 },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'CENTER_RESTORED', centerId: center.id }),
    );
    const after = engine.getSnapshot();
    expect(after.rovers[0]!.cargo).toEqual({
      oxygen: 0,
      food: 0,
      equipment: 20.25,
    });
    const delivery = events.find((event) => event.type === 'CARGO_DELIVERED');
    if (delivery?.type !== 'CARGO_DELIVERED') {
      throw new Error('Expected automatic cargo delivery');
    }
    for (const resource of ['oxygen', 'food', 'equipment'] as const) {
      expect(
        after.rovers[0]!.cargo[resource] + delivery.delivered[resource],
      ).toBeCloseTo(rover.initialCargo[resource], 12);
    }
  });

  it('unloads available cargo even when it cannot restore the depleted resource', () => {
    const center = structuredClone(standardCenter);
    center.cell = { column: 1, row: 0 };
    center.oxygen.initial = 80;
    center.food.initial = 80;
    center.equipmentInitial = 1;
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 11.5, food: 10.75, equipment: 0 };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    config.equipmentDemand = {
      firstEligibleGameMinute: 0,
      minimumIntervalGameMinutes: 10_000,
      lossMin: 1,
      lossMax: 1,
    };
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [center.cell],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    const events = engine.advance(2_000);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'CARGO_DELIVERED',
        delivered: { oxygen: 11.5, food: 10.75, equipment: 0 },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'CENTER_RESTORED' }),
    );
    expect(engine.getSnapshot()).toMatchObject({
      centers: [{ status: 'RECOVERY', resources: { equipment: 0 } }],
      rovers: [{ cargo: { oxygen: 0, food: 0, equipment: 0 } }],
    });
  });

  it('keeps cargo when every offered resource is full at final center arrival', () => {
    const center = structuredClone(standardCenter);
    center.cell = { column: 1, row: 0 };
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 0, food: 0, equipment: 0.4 };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.incidentRules.profiles[0]!.cellChance = 0;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 0,
      })),
    };
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [center.cell],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    const events = engine.advance(2_000);
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'CARGO_DELIVERED' }),
    );
    expect(engine.getSnapshot().rovers[0]!.cargo).toEqual(rover.initialCargo);
  });

  it('sets mixed cargo up to the runtime capacity instantly at the unlimited base', () => {
    const rover = structuredClone(standardRover);
    rover.cargoCapacity = 7;
    const engine = createSimulationEngine(
      makeSimulationConfig({ rovers: [rover] }),
    );

    expect(
      engine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: rover.id,
        cargo: { oxygen: 2, food: 2, equipment: 3 },
      }),
    ).toEqual({ ok: true, events: [] });
    expect(engine.getSnapshot()).toMatchObject({
      elapsedRealMilliseconds: 0,
      rovers: [
        {
          cargoCapacity: 7,
          cargo: { oxygen: 2, food: 2, equipment: 3 },
        },
      ],
    });
  });

  it('rejects combined overflow and invalid quantities atomically', () => {
    const rover = structuredClone(standardRover);
    rover.cargoCapacity = 7;
    const engine = createSimulationEngine(
      makeSimulationConfig({ rovers: [rover] }),
    );
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: rover.id,
        cargo: { oxygen: 3, food: 3, equipment: 2 },
      }),
    ).toEqual({ ok: false, code: 'CARGO_CAPACITY_EXCEEDED' });
    expect(engine.getSnapshot()).toEqual(before);

    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        engine.dispatch({
          type: 'SET_ROVER_CARGO',
          roverId: rover.id,
          cargo: { oxygen: invalid, food: 0, equipment: 0 },
        }),
      ).toEqual({ ok: false, code: 'INVALID_CARGO' });
      expect(engine.getSnapshot()).toEqual(before);
    }
  });

  it.each(['oxygen', 'food', 'equipment'] as const)(
    'does not load %s into a repair rover',
    (resource) => {
      const rover = structuredClone(standardRover);
      rover.id = 'repair-one';
      rover.kind = 'repair';
      rover.cargoCapacity = 0;
      const engine = createSimulationEngine(
        makeSimulationConfig({ rovers: [rover] }),
      );
      const cargo = { oxygen: 0, food: 0, equipment: 0 };
      cargo[resource] = 1;

      expect(
        engine.dispatch({
          type: 'SET_ROVER_CARGO',
          roverId: rover.id,
          cargo,
        }),
      ).toEqual({ ok: false, code: 'REPAIR_ROVER_CANNOT_CARRY' });
      expect(engine.getSnapshot().rovers[0]!.cargo).toEqual({
        oxygen: 0,
        food: 0,
        equipment: 0,
      });
    },
  );

  it('rejects mixed cargo for repair and loading away from base', () => {
    const repair = structuredClone(standardRover);
    repair.id = 'repair-mixed';
    repair.kind = 'repair';
    repair.cargoCapacity = 0;
    const repairEngine = createSimulationEngine(
      makeSimulationConfig({ rovers: [repair] }),
    );
    expect(
      repairEngine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: repair.id,
        cargo: { oxygen: 1, food: 1, equipment: 1 },
      }),
    ).toEqual({ ok: false, code: 'REPAIR_ROVER_CANNOT_CARRY' });

    const remote = structuredClone(standardRover);
    remote.initialCell = { column: 1, row: 0 };
    const remoteEngine = createSimulationEngine(
      makeSimulationConfig({ rovers: [remote] }),
    );
    const before = remoteEngine.getSnapshot();
    expect(
      remoteEngine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: remote.id,
        cargo: { oxygen: 1, food: 0, equipment: 0 },
      }),
    ).toEqual({ ok: false, code: 'ROVER_NOT_AT_BASE' });
    expect(remoteEngine.getSnapshot()).toEqual(before);
  });

  it('unloads up to each center capacity and conserves the remainder', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 95.25;
    center.food.initial = 80.125;
    center.equipmentInitial = 100;
    const rover = structuredClone(standardRover);
    rover.initialCell = center.cell;
    rover.initialCargo = { oxygen: 10.125, food: 30.25, equipment: 5.5 };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }),
    ).toMatchObject({
      ok: true,
      events: [
        {
          type: 'CARGO_DELIVERED',
          roverId: rover.id,
          centerId: center.id,
          delivered: { oxygen: 4.75, food: 19.875, equipment: 0 },
        },
      ],
    });
    expect(engine.getSnapshot()).toMatchObject({
      elapsedRealMilliseconds: 0,
      centers: [{ resources: { oxygen: 100, food: 100, equipment: 100 } }],
      rovers: [{ cargo: { oxygen: 5.375, food: 10.375, equipment: 5.5 } }],
    });
    const after = engine.getSnapshot();
    for (const resource of ['oxygen', 'food', 'equipment'] as const) {
      expect(
        before.centers[0]!.resources[resource] +
          before.rovers[0]!.cargo[resource],
      ).toBeCloseTo(
        after.centers[0]!.resources[resource] +
          after.rovers[0]!.cargo[resource],
        12,
      );
    }
  });

  it('does not destroy sub-nanounit cargo during a capped transfer', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 100 - 2e-10;
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 4e-10, food: 0, equipment: 0 };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }).ok,
    ).toBe(true);
    const remainder = engine.getSnapshot().rovers[0]!.cargo.oxygen;
    expect(remainder).toBeGreaterThan(1e-10);
    expect(remainder).toBeLessThan(3e-10);
  });

  it('rejects full or unreachable targets without losing cargo', () => {
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 1, food: 0, equipment: 0 };
    const engine = createSimulationEngine(
      makeSimulationConfig({ rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: standardCenter.id,
      }),
    ).toEqual({ ok: false, code: 'CENTER_FULL' });
    expect(engine.getSnapshot()).toEqual(before);

    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: 'missing-center',
      }),
    ).toEqual({ ok: false, code: 'CENTER_NOT_FOUND' });
    expect(engine.getSnapshot()).toEqual(before);

    const remoteCenter = structuredClone(standardCenter);
    remoteCenter.cell = { column: 1, row: 0 };
    const remote = createSimulationEngine(
      makeSimulationConfig({ centers: [remoteCenter], rovers: [rover] }),
    );
    remote.dispatch({ type: 'START_SHIFT' });
    const remoteBefore = remote.getSnapshot();
    expect(
      remote.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: remoteCenter.id,
      }),
    ).toEqual({ ok: false, code: 'ROVER_NOT_AT_CENTER' });
    expect(remote.getSnapshot()).toEqual(remoteBefore);
  });

  it('handles exact fill and empty cargo without partial mutation', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 95;
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 5, food: 0, equipment: 0 };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }),
    ).toMatchObject({
      ok: true,
      events: [
        {
          type: 'CARGO_DELIVERED',
          delivered: { oxygen: 5, food: 0, equipment: 0 },
        },
      ],
    });
    expect(engine.getSnapshot()).toMatchObject({
      centers: [{ resources: { oxygen: 100 } }],
      rovers: [{ cargo: { oxygen: 0, food: 0, equipment: 0 } }],
    });
    const beforeEmpty = engine.getSnapshot();
    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }),
    ).toEqual({ ok: false, code: 'ROVER_CARGO_EMPTY' });
    expect(engine.getSnapshot()).toEqual(beforeEmpty);
  });

  it('restores a recovering center only after all zero resources are supplied', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.food.initial = 0.01;
    const rover = structuredClone(standardRover);
    rover.initialCell = center.cell;
    rover.initialCargo = { oxygen: 10, food: 0, equipment: 0 };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(200);

    const partial = engine.dispatch({
      type: 'UNLOAD_ROVER_CARGO',
      roverId: rover.id,
      centerId: center.id,
    });
    expect(partial).toMatchObject({
      ok: true,
      events: [
        {
          type: 'CARGO_DELIVERED',
          delivered: { oxygen: 10, food: 0, equipment: 0 },
        },
      ],
    });
    expect(engine.getSnapshot().centers[0]!.status).toBe('RECOVERY');

    // Rover is also on the base cell, so its composition can be replaced.
    expect(center.cell).toEqual(baseCell);
    engine.dispatch({
      type: 'SET_ROVER_CARGO',
      roverId: rover.id,
      cargo: { oxygen: 0, food: 10, equipment: 0 },
    });
    const restored = engine.dispatch({
      type: 'UNLOAD_ROVER_CARGO',
      roverId: rover.id,
      centerId: center.id,
    });
    expect(restored.ok && restored.events).toContainEqual(
      expect.objectContaining({ type: 'CENTER_RESTORED' }),
    );
    expect(engine.getSnapshot().centers[0]).toMatchObject({
      status: 'WARNING',
      recoveryRemainingGameMinutes: null,
    });
  });

  it('re-arms only thresholds replenished strictly above their value', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 50.25;
    center.oxygen.depletionGameMinutes = 20;
    const rover = structuredClone(standardRover);
    rover.initialCell = center.cell;
    rover.initialCargo = { oxygen: 0.25, food: 0, equipment: 0 };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    expect(engine.advance(100)).toContainEqual(
      expect.objectContaining({
        type: 'RESOURCE_THRESHOLD',
        resource: 'oxygen',
        threshold: 50,
      }),
    );
    engine.dispatch({
      type: 'UNLOAD_ROVER_CARGO',
      roverId: rover.id,
      centerId: center.id,
    });
    expect(engine.getSnapshot().centers[0]!.resources.oxygen).toBeCloseTo(
      50,
      8,
    );
    expect(engine.advance(100)).not.toContainEqual(
      expect.objectContaining({ threshold: 50 }),
    );
  });

  it('re-arms only lower thresholds after a partial replenishment', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 50.01;
    center.oxygen.depletionGameMinutes = 100;
    const rover = structuredClone(standardRover);
    rover.initialCargo = { oxygen: 5.09, food: 0, equipment: 0 };
    const config = makeSimulationConfig({ centers: [center], rovers: [rover] });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    const firstCycle = oxygenThresholds(engine.advance(25_100));
    expect(firstCycle).toEqual([50, 25]);
    engine.dispatch({
      type: 'UNLOAD_ROVER_CARGO',
      roverId: rover.id,
      centerId: center.id,
    });

    const secondCycle = oxygenThresholds(engine.advance(5_100));
    expect(secondCycle).toEqual([25]);
  });

  it('applies cargo commands in PAUSED and rejects unload outside an active shift', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 90;
    const rover = structuredClone(standardRover);
    rover.batteryInitial = 5;
    rover.initialCargo = { oxygen: 5, food: 0, equipment: 0 };
    const briefing = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    const beforeBriefing = briefing.getSnapshot();
    expect(
      briefing.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }),
    ).toEqual({ ok: false, code: 'SHIFT_NOT_ACTIVE' });
    expect(briefing.getSnapshot()).toEqual(beforeBriefing);

    briefing.dispatch({ type: 'START_SHIFT' });
    briefing.dispatch({ type: 'PAUSE_SHIFT' });
    expect(
      briefing.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: rover.id,
        centerId: center.id,
      }).ok,
    ).toBe(true);
    expect(
      briefing.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: rover.id,
        cargo: { oxygen: 1, food: 1, equipment: 1 },
      }).ok,
    ).toBe(true);
    expect(
      briefing.dispatch({ type: 'CHARGE_ROVER', roverId: rover.id }).ok,
    ).toBe(true);
  });

  it('rejects all cargo mutations after a terminal outcome', () => {
    const config = makeSimulationConfig({
      time: {
        fixedStepMilliseconds: 100,
        gameMinutesPerRealSecond: 1,
        shiftRealSeconds: 0.1,
      },
    });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);
    const terminal = engine.getSnapshot();
    expect(terminal.phase).toBe('VICTORY');

    expect(
      engine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: standardRover.id,
        cargo: { oxygen: 1, food: 0, equipment: 0 },
      }),
    ).toEqual({ ok: false, code: 'INVALID_PHASE' });
    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: standardRover.id,
        centerId: standardCenter.id,
      }),
    ).toEqual({ ok: false, code: 'SHIFT_NOT_ACTIVE' });
    expect(
      engine.dispatch({ type: 'CHARGE_ROVER', roverId: standardRover.id }),
    ).toEqual({ ok: false, code: 'INVALID_PHASE' });
    expect(engine.getSnapshot()).toEqual(terminal);
  });
});
