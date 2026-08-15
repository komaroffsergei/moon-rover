import { describe, expect, it } from 'vitest';

import { createSimulationEngine, type DomainEvent } from '../src/simulation';
import {
  makeSimulationConfig,
  setAndUnload,
  standardCenter,
} from './fixtures/simulation';

function thresholdValues(events: readonly DomainEvent[]): number[] {
  return events
    .filter((event) => event.type === 'RESOURCE_THRESHOLD')
    .map((event) => event.threshold);
}

describe('center resources and recovery', () => {
  it('depletes oxygen and food linearly in game time', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(60_000);

    const center = engine.getSnapshot().centers[0]!;
    expect(center.resources.oxygen).toBeCloseTo(87.5, 8);
    expect(center.resources.food).toBeCloseTo(87.5, 8);
    expect(center.depletionForecastGameMinutes).toBeCloseTo(420, 8);
  });

  it('emits 50/25/10/5/1 thresholds once while crossing them', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 50.01;
    center.oxygen.depletionGameMinutes = 180;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    const first = engine.advance(100);
    expect(thresholdValues(first)).toEqual([50]);
    expect(thresholdValues(engine.advance(100))).toEqual([]);

    const rest = engine.advance(90_000);
    expect(thresholdValues(rest)).toEqual([25, 10, 5, 1]);
  });

  it('re-arms a resource threshold after replenishment above it', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 50.01;
    center.oxygen.depletionGameMinutes = 180;
    const config = makeSimulationConfig({ centers: [center] });
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    expect(thresholdValues(engine.advance(100))).toEqual([50]);
    expect(
      setAndUnload(engine, { oxygen: 100, food: 0, equipment: 0 }).ok,
    ).toBe(true);

    expect(thresholdValues(engine.advance(90_000))).toContain(50);
  });

  it('enters recovery at zero without immediate defeat', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.oxygen.depletionGameMinutes = 180;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    const events = engine.advance(100);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'RUNNING',
      centers: [{ status: 'RECOVERY', recoveryRemainingGameMinutes: 30 }],
    });
    expect(events.map(({ type }) => type)).toContain('CENTER_RECOVERY_STARTED');
  });

  it('restores a center when delivery arrives on the last fixed step', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.oxygen.depletionGameMinutes = 180;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);
    engine.advance(29_900);
    expect(
      engine.getSnapshot().centers[0]!.recoveryRemainingGameMinutes,
    ).toBeCloseTo(0.1, 8);

    const result = setAndUnload(engine, {
      oxygen: 10,
      food: 0,
      equipment: 0,
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.events.map(({ type }) => type)).toContain(
      'CENTER_RESTORED',
    );
    engine.advance(100);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'RUNNING',
      centers: [{ status: 'WARNING', recoveryRemainingGameMinutes: null }],
    });
  });

  it('loses exactly after 30 recovery game minutes', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.oxygen.depletionGameMinutes = 180;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);

    engine.advance(29_900);
    expect(engine.getSnapshot().phase).toBe('RUNNING');
    const events = engine.advance(100);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'DEFEAT',
      centers: [{ status: 'LOST', recoveryRemainingGameMinutes: 0 }],
    });
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['CENTER_LOST', 'SHIFT_ENDED']),
    );
  });

  it('emits each recovery threshold once per episode', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.oxygen.depletionGameMinutes = 180;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    const events = [
      ...engine.advance(100),
      ...engine.advance(29_000),
      ...engine.advance(800),
    ];
    expect(
      events
        .filter((event) => event.type === 'RECOVERY_THRESHOLD')
        .map(({ remainingGameMinutes }) => remainingGameMinutes),
    ).toEqual([30, 20, 10, 5, 1]);
  });

  it('keeps recovery active after a partial delivery', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 0.05;
    center.food.initial = 0.05;
    center.oxygen.depletionGameMinutes = 180;
    center.food.depletionGameMinutes = 240;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(200);

    const result = setAndUnload(engine, {
      oxygen: 10,
      food: 0,
      equipment: 0,
    });
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: 'CARGO_DELIVERED',
          delivered: { oxygen: 10, food: 0, equipment: 0 },
        },
      ],
    });
    expect(engine.getSnapshot().centers[0]!.status).toBe('RECOVERY');
  });
});
