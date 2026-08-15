import { describe, expect, it } from 'vitest';

import {
  calculateBatteryAfterCellEntry,
  calculateCellBatteryCost,
  createSimulationEngine,
} from '../src/simulation';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

describe('rover battery', () => {
  it('calculates cell cost from runtime terrain and rover coefficients', () => {
    expect(calculateCellBatteryCost(2.75, 1.2)).toBeCloseTo(3.3, 12);
    expect(calculateCellBatteryCost(2.75, 0.5)).toBeCloseTo(1.375, 12);
    expect(calculateBatteryAfterCellEntry(2, 2.75, 1.2)).toBe(0);
  });

  it.each([
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    [-1, 1],
    [1, -1],
  ])('rejects invalid movement coefficients (%s, %s)', (cost, multiplier) => {
    expect(() => calculateCellBatteryCost(cost, multiplier)).toThrow(
      RangeError,
    );
  });

  it('supports a zero-cost cell and rejects non-finite results/current charge', () => {
    expect(calculateCellBatteryCost(0, 1.5)).toBe(0);
    expect(() =>
      calculateCellBatteryCost(Number.MAX_VALUE, Number.MAX_VALUE),
    ).toThrow(RangeError);
    for (const current of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateBatteryAfterCellEntry(current, 1, 1)).toThrow(
        RangeError,
      );
    }
  });

  it.each([
    ['fast', 90],
    ['heavy', 120],
    ['repair', 100],
  ] as const)(
    'charges %s to its runtime battery capacity',
    (archetypeId, capacity) => {
      const rover = structuredClone(standardRover);
      rover.archetypeId = archetypeId;
      rover.kind = archetypeId === 'repair' ? 'repair' : 'courier';
      rover.cargoCapacity = rover.kind === 'repair' ? 0 : rover.cargoCapacity;
      rover.batteryCapacity = capacity;
      rover.batteryInitial = 5;
      const engine = createSimulationEngine(
        makeSimulationConfig({ rovers: [rover] }),
      );

      expect(
        engine.dispatch({ type: 'CHARGE_ROVER', roverId: rover.id }),
      ).toEqual({ ok: true, events: [] });
      expect(engine.getSnapshot().rovers[0]!.battery).toBe(capacity);
    },
  );

  it('rejects charging away from the base atomically', () => {
    const rover = structuredClone(standardRover);
    rover.initialCell = { column: 1, row: 0 };
    rover.batteryInitial = 5;
    const engine = createSimulationEngine(
      makeSimulationConfig({ rovers: [rover] }),
    );
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({ type: 'CHARGE_ROVER', roverId: rover.id }),
    ).toEqual({ ok: false, code: 'ROVER_NOT_AT_BASE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('auto-services an empty rover when it spawns at base', () => {
    const rover = { ...structuredClone(standardRover), batteryInitial: 0 };
    const center = {
      ...structuredClone(standardCenter),
      cell: { column: 1, row: 0 },
    };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], rovers: [rover] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });

    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      battery: rover.batteryCapacity,
      status: 'IDLE_AT_BASE',
      movement: null,
    });
    expect(
      engine.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: rover.id,
        steps: [{ column: 1, row: 0 }],
        goal: { kind: 'CENTER', centerId: center.id },
      }),
    ).toEqual({ ok: true, events: [] });
  });

  it('does not charge a rover while it is leaving the base', () => {
    const center = {
      ...structuredClone(standardCenter),
      cell: { column: 2, row: 0 },
    };
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center] }),
    );
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: standardRover.id,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: center.id },
    });
    engine.advance(1_000);
    const before = engine.getSnapshot();

    expect(
      engine.dispatch({ type: 'CHARGE_ROVER', roverId: standardRover.id }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(before);
  });

  it('waits for a final-base incident before allowing charge', () => {
    const rover = {
      ...structuredClone(standardRover),
      initialCell: { column: 1, row: 0 },
      batteryInitial: 50,
    };
    const profile = {
      id: 'certain-dust',
      cellChance: 1,
      weights: { dustStorm: 1, meteorite: 0, crater: 0 },
    };
    const baseConfig = makeSimulationConfig({ rovers: [rover] });
    const engine = createSimulationEngine({
      ...baseConfig,
      incidentRules: {
        ...baseConfig.incidentRules,
        profiles: [profile],
      },
      routingMap: {
        ...baseConfig.routingMap,
        cells: baseConfig.routingMap.cells.map((cell) => ({
          ...cell,
          effectiveCellChance: 1,
          incidentProfileId: profile.id,
        })),
      },
    });
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: rover.id,
      steps: [{ column: 0, row: 0 }],
      goal: { kind: 'BASE' },
    });
    engine.advance(2_000);
    const delayed = engine.getSnapshot();

    expect(delayed.rovers[0]).toMatchObject({
      cell: { column: 0, row: 0 },
      status: 'DELAYED',
      battery: 49,
    });
    expect(
      engine.dispatch({ type: 'CHARGE_ROVER', roverId: rover.id }),
    ).toEqual({ ok: false, code: 'ROVER_UNAVAILABLE' });
    expect(engine.getSnapshot()).toEqual(delayed);

    engine.advance(10_000);
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      status: 'IDLE_AT_BASE',
      battery: rover.batteryCapacity,
    });
  });
});
