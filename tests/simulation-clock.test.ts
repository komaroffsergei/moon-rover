import { describe, expect, it } from 'vitest';

import { createSimulationEngine } from '../src/simulation';
import { makeSimulationConfig } from './fixtures/simulation';

describe('simulation clock', () => {
  it('processes only complete fixed steps and maps 1 second to 1 game minute', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });

    engine.advance(99);
    expect(engine.getSnapshot().elapsedRealMilliseconds).toBe(0);
    engine.advance(1);
    expect(engine.getSnapshot()).toMatchObject({
      elapsedRealMilliseconds: 100,
      elapsedGameMinutes: 0.1,
    });
    engine.advance(900);
    expect(engine.getSnapshot()).toMatchObject({
      elapsedRealMilliseconds: 1_000,
      elapsedGameMinutes: 1,
    });
  });

  it('does not accumulate paused real time', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(50);
    expect(engine.dispatch({ type: 'PAUSE_SHIFT' }).ok).toBe(true);

    engine.advance(10_000);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'PAUSED',
      elapsedRealMilliseconds: 0,
    });

    expect(engine.dispatch({ type: 'RESUME_SHIFT' }).ok).toBe(true);
    engine.advance(50);
    expect(engine.getSnapshot()).toMatchObject({
      phase: 'RUNNING',
      elapsedRealMilliseconds: 100,
    });
  });

  it('freezes resources, recovery, demand and events while paused', () => {
    const center = structuredClone(makeSimulationConfig().centers[0]!);
    center.oxygen.initial = 0.05;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.advance(100);
    engine.dispatch({ type: 'PAUSE_SHIFT' });
    const paused = engine.getSnapshot();

    expect(engine.advance(300_000)).toEqual([]);
    expect(engine.getSnapshot()).toEqual(paused);
  });

  it('does not expose mutable internal state through snapshots', () => {
    const engine = createSimulationEngine(makeSimulationConfig());
    const snapshot = engine.getSnapshot();
    const mutable = snapshot as unknown as {
      centers: Array<{ resources: { oxygen: number } }>;
      rovers: Array<{ cargo: { oxygen: number } }>;
    };
    mutable.centers[0]!.resources.oxygen = 0;
    mutable.rovers[0]!.cargo.oxygen = 999;

    expect(engine.getSnapshot().centers[0]!.resources.oxygen).toBe(100);
    expect(engine.getSnapshot().rovers[0]!.cargo.oxygen).toBe(0);
  });

  it('is invariant to advance chunking', () => {
    const whole = createSimulationEngine(
      makeSimulationConfig({ seed: 'chunk' }),
    );
    const steps = createSimulationEngine(
      makeSimulationConfig({ seed: 'chunk' }),
    );
    whole.dispatch({ type: 'START_SHIFT' });
    steps.dispatch({ type: 'START_SHIFT' });

    const wholeEvents = whole.advance(1_000);
    const stepEvents = Array.from({ length: 10 }).flatMap(() =>
      steps.advance(100),
    );
    expect(stepEvents).toEqual(wholeEvents);
    expect(steps.getSnapshot()).toEqual(whole.getSnapshot());
  });

  it.each([
    ['NaN initial resource', 'resource'],
    ['non-finite equipment capacity', 'equipment'],
  ] as const)('rejects invalid public config: %s', (_name, kind) => {
    const config = makeSimulationConfig();
    const center = config.centers[0]!;
    if (kind === 'resource') center.oxygen.initial = Number.NaN;
    else center.equipmentCapacity = Number.POSITIVE_INFINITY;

    expect(() => createSimulationEngine(config)).toThrow(RangeError);
  });
});
