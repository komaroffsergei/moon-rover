import { describe, expect, it } from 'vitest';

import {
  createSimulationEngine,
  type DomainEvent,
  type SimulationEngine,
} from '../src/simulation';
import {
  makeSimulationConfig,
  setAndUnload,
  standardCenter,
} from './fixtures/simulation';

function demands(events: readonly DomainEvent[]) {
  return events.filter((event) => event.type === 'EQUIPMENT_DEMAND');
}

function resupplyEquipment(engine: SimulationEngine): void {
  setAndUnload(engine, { oxygen: 0, food: 0, equipment: 100 });
}

describe('equipment demand and outcomes', () => {
  it('schedules seeded demands only for level-selected centers', () => {
    const skipped = structuredClone(standardCenter);
    skipped.id = 'center-skipped';
    skipped.name = 'Без заявки';
    const config = makeSimulationConfig({
      centers: [structuredClone(standardCenter), skipped],
      equipmentDemandCenterIds: [standardCenter.id],
    });
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    expect(demands(engine.advance(30_000))).toEqual([
      expect.objectContaining({
        type: 'EQUIPMENT_DEMAND',
        centerId: standardCenter.id,
        gameMinute: 30,
      }),
    ]);
  });

  it('keeps demands enabled for every center when selection is omitted', () => {
    const second = structuredClone(standardCenter);
    second.id = 'center-two';
    second.name = 'Центр Два';
    const engine = createSimulationEngine(
      makeSimulationConfig({
        centers: [structuredClone(standardCenter), second],
      }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    expect(
      demands(engine.advance(30_000)).map(({ centerId }) => centerId),
    ).toEqual([standardCenter.id, second.id]);
  });

  it('uses the seed deterministically and respects demand intervals', () => {
    const first = createSimulationEngine(
      makeSimulationConfig({ seed: 'same' }),
    );
    const second = createSimulationEngine(
      makeSimulationConfig({ seed: 'same' }),
    );
    const third = createSimulationEngine(
      makeSimulationConfig({ seed: 'different' }),
    );
    for (const engine of [first, second, third]) {
      engine.dispatch({ type: 'START_SHIFT' });
    }

    const firstEvents = demands(first.advance(120_000));
    const secondEvents = demands(second.advance(120_000));
    const thirdEvents = demands(third.advance(120_000));

    expect(firstEvents).toEqual(secondEvents);
    expect(firstEvents.map(({ gameMinute }) => gameMinute)).toEqual([
      30, 75, 120,
    ]);
    expect(firstEvents.map(({ amount }) => amount)).not.toEqual(
      thirdEvents.map(({ amount }) => amount),
    );
    expect(
      firstEvents.every(({ amount }) => amount >= 20 && amount <= 40),
    ).toBe(true);
  });

  it('enters recovery when the first equipment demand reaches zero', () => {
    const center = structuredClone(standardCenter);
    center.equipmentInitial = 20;
    const config = makeSimulationConfig({ centers: [center] });
    config.equipmentDemand.lossMin = 20;
    config.equipmentDemand.lossMax = 20;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    const events = engine.advance(30_000);

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'RUNNING',
      centers: [
        {
          status: 'RECOVERY',
          resources: { equipment: 0 },
          recoveryRemainingGameMinutes: 30,
        },
      ],
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'CENTER_RECOVERY_STARTED' }),
    );
  });

  it('allows victory with multiple operational centers including WARNING', () => {
    const working = structuredClone(standardCenter);
    working.oxygen.depletionGameMinutes = 10_000;
    working.food.depletionGameMinutes = 10_000;
    const warning = structuredClone(working);
    warning.id = 'center-warning';
    warning.name = 'Предупреждение';
    warning.equipmentInitial = 20;
    const config = makeSimulationConfig({
      centers: [working, warning],
      time: {
        fixedStepMilliseconds: 100,
        gameMinutesPerRealSecond: 1,
        shiftRealSeconds: 1,
      },
    });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    const events = engine.advance(1_000);

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'VICTORY',
      centers: [{ status: 'WORKING' }, { status: 'WARNING' }],
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIFT_ENDED', outcome: 'VICTORY' }),
    );
  });

  it('defeats multiple centers when one is in recovery at shift end', () => {
    const working = structuredClone(standardCenter);
    working.oxygen.depletionGameMinutes = 10_000;
    working.food.depletionGameMinutes = 10_000;
    const recovering = structuredClone(working);
    recovering.id = 'center-recovering';
    recovering.name = 'Аварийный';
    recovering.oxygen.initial = 0.05;
    recovering.oxygen.depletionGameMinutes = 1_000;
    const config = makeSimulationConfig({
      centers: [working, recovering],
      time: {
        fixedStepMilliseconds: 100,
        gameMinutesPerRealSecond: 1,
        shiftRealSeconds: 1,
      },
    });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    const events = engine.advance(1_000);

    expect(engine.getSnapshot()).toMatchObject({
      phase: 'DEFEAT',
      centers: [{ status: 'WORKING' }, { status: 'RECOVERY' }],
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIFT_ENDED', outcome: 'DEFEAT' }),
    );
  });

  it('treats a recovery center at shift end as defeat', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });

    for (let elapsed = 0; elapsed < 450_000; elapsed += 45_000) {
      engine.advance(45_000);
      if (engine.getSnapshot().phase === 'RUNNING') resupplyEquipment(engine);
    }
    engine.advance(29_900);
    resupplyEquipment(engine);
    const events = engine.advance(100);

    expect(engine.getSnapshot().phase).toBe('DEFEAT');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIFT_ENDED', outcome: 'DEFEAT' }),
    );
  });

  it('applies a confirmed delivery before the end-of-shift outcome', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });

    for (let elapsed = 0; elapsed < 450_000; elapsed += 45_000) {
      engine.advance(45_000);
      if (engine.getSnapshot().phase === 'RUNNING') resupplyEquipment(engine);
    }
    engine.advance(29_900);
    setAndUnload(engine, {
      oxygen: 100,
      food: 100,
      equipment: 100,
    });
    const events = engine.advance(100);

    expect(engine.getSnapshot().phase).toBe('VICTORY');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'SHIFT_ENDED', outcome: 'VICTORY' }),
    );
  });

  it('rejects invalid cargo delivery commands atomically', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({
        type: 'UNLOAD_ROVER_CARGO',
        roverId: 'rover-one',
        centerId: 'missing-center',
      }),
    ).toEqual({ ok: false, code: 'CENTER_NOT_FOUND' });
    expect(engine.getSnapshot()).toEqual(before);

    expect(
      engine.dispatch({
        type: 'SET_ROVER_CARGO',
        roverId: 'rover-one',
        cargo: { oxygen: Number.NaN, food: 0, equipment: 0 },
      }),
    ).toEqual({ ok: false, code: 'INVALID_CARGO' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('is a no-op after a terminal outcome', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(480_000);
    const terminal = engine.getSnapshot();

    expect(engine.advance(10_000)).toEqual([]);
    expect(engine.getSnapshot()).toEqual(terminal);
    expect(engine.dispatch({ type: 'PAUSE_SHIFT' })).toEqual({
      ok: false,
      code: 'INVALID_PHASE',
    });
  });
});
