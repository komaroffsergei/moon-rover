import { describe, expect, it, vi } from 'vitest';

import { createMapGameController } from '../src/app/createMapGameController';
import { createSimulationEngine } from '../src/simulation';
import {
  baseCell,
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

function createController() {
  const config = makeSimulationConfig();
  const simulation = createSimulationEngine(config);
  return {
    controller: createMapGameController({
      simulation,
      baseCell: config.baseCell,
      centerDefinitions: config.centers,
    }),
    simulation,
  };
}

describe('map game controller', () => {
  it('starts and advances the simulation through its narrow port', () => {
    const { controller } = createController();

    expect(controller.getView().snapshot.phase).toBe('BRIEFING');
    expect(controller.getView().roverActions[0]).toMatchObject({
      roverId: standardRover.id,
      canEditCargo: true,
      canAssignRoute: false,
    });
    expect(controller.start()).toEqual({ ok: true, events: [] });
    expect(controller.getView().roverActions[0]?.canAssignRoute).toBe(true);
    expect(controller.advance(100)).toEqual([]);
    expect(controller.getView().snapshot).toMatchObject({
      phase: 'RUNNING',
      elapsedRealMilliseconds: 100,
      elapsedGameMinutes: 0.1,
    });
  });

  it('owns selection without mutating simulation state', () => {
    const { controller, simulation } = createController();
    const before = simulation.getSnapshot();

    expect(controller.selectEntity({ kind: 'rover', id: 'missing' })).toBe(
      false,
    );
    expect(
      controller.selectEntity({ kind: 'center', id: standardCenter.id }),
    ).toBe(true);
    expect(controller.getView()).toMatchObject({
      selectedEntity: { kind: 'center', id: standardCenter.id },
      baseCell,
    });
    expect(simulation.getSnapshot()).toEqual(before);
  });

  it('routes the selected rover immediately to any walkable cell', () => {
    const { controller, simulation } = createController();
    controller.start();

    expect(controller.routeSelectedRoverTo({ column: 2, row: 0 })).toEqual({
      ok: false,
      code: 'ROVER_NOT_SELECTED',
    });
    expect(
      controller.selectEntity({ kind: 'rover', id: standardRover.id }),
    ).toBe(true);
    expect(controller.routeSelectedRoverTo({ column: 2, row: 0 })).toEqual({
      ok: true,
      events: [],
    });
    expect(simulation.getSnapshot().rovers[0]?.route).toMatchObject({
      mode: 'FREE_NAVIGATION',
      origin: baseCell,
      steps: [{ column: 2, row: 0 }],
      legs: [
        {
          from: baseCell,
          to: { column: 2, row: 0 },
          distance: 2,
        },
      ],
      goal: { kind: 'CELL', cell: { column: 2, row: 0 } },
    });
    expect(controller.getView().selectedEntity).toEqual({
      kind: 'rover',
      id: standardRover.id,
    });

    expect(controller.routeSelectedRoverTo({ column: 99, row: 0 })).toEqual({
      ok: false,
      code: 'ROUTE_INVALID',
    });
  });

  it('uses simulation-configured route weights instead of a controller fallback', () => {
    const origin = { column: 0, row: 1 };
    const destination = { column: 4, row: 1 };
    const baseConfig = makeSimulationConfig();
    const routingMap = {
      width: 5,
      height: 3,
      cells: Array.from({ length: 15 }, (_, index) => {
        const column = index % 5;
        const row = Math.floor(index / 5);
        const hazardous = row === 1 && column >= 1 && column <= 3;
        return {
          walkable: true,
          movementCost: 1,
          effectiveCellChance: hazardous ? 0.16 : 0.0075,
          incidentProfileId: hazardous ? 'hazard-high' : 'normal',
        };
      }),
    };
    const config = makeSimulationConfig({
      baseCell: origin,
      centers: [{ ...structuredClone(standardCenter), cell: { ...origin } }],
      rovers: [
        { ...structuredClone(standardRover), initialCell: { ...origin } },
      ],
      routingMap,
      routeWeights: { movementCost: 1, incidentRisk: 0 },
      incidentRules: {
        ...baseConfig.incidentRules,
        profiles: [
          ...baseConfig.incidentRules.profiles,
          {
            id: 'hazard-high',
            cellChance: 0.16,
            weights: { dustStorm: 1, meteorite: 0, crater: 0 },
          },
        ],
      },
    });
    const simulation = createSimulationEngine(config);
    const controller = createMapGameController({
      simulation,
      baseCell: config.baseCell,
    });
    controller.start();
    controller.selectEntity({ kind: 'rover', id: standardRover.id });

    expect(controller.routeSelectedRoverTo(destination)).toMatchObject({
      ok: true,
    });
    expect(simulation.getSnapshot().rovers[0]?.route?.steps).toEqual([
      destination,
    ]);
  });

  it('plans a moving redirect from the exact live position', () => {
    const { controller, simulation } = createController();
    controller.start();
    controller.selectEntity({ kind: 'rover', id: standardRover.id });
    expect(controller.routeSelectedRoverTo({ column: 2, row: 0 })).toEqual({
      ok: true,
      events: [],
    });
    controller.advance(1_000);
    const before = simulation.getSnapshot().rovers[0]!;
    expect(before.movement).toMatchObject({
      from: baseCell,
      to: { column: 2, row: 0 },
      progress: 0.25,
    });

    expect(controller.routeSelectedRoverTo({ column: 2, row: 2 })).toEqual({
      ok: true,
      events: [],
    });
    const redirected = simulation.getSnapshot().rovers[0]!;
    expect(redirected).toMatchObject({
      cell: before.cell,
      position: before.position,
      battery: before.battery,
      movement: {
        from: before.position,
        progress: 0,
      },
      route: {
        mode: 'FREE_NAVIGATION',
        originPosition: before.position,
        goal: { kind: 'CELL', cell: { column: 2, row: 2 } },
      },
    });
    expect(redirected.movement?.to).not.toEqual(before.movement?.to);
    expect(redirected.route?.steps.at(-1)).toEqual({ column: 2, row: 2 });
  });

  it('owns an immutable base projection', () => {
    const config = makeSimulationConfig();
    const mutableBase = { ...config.baseCell };
    const simulation = createSimulationEngine(config);
    const controller = createMapGameController({
      simulation,
      baseCell: mutableBase,
    });
    mutableBase.column = 99;

    const view = controller.getView();
    expect(view.baseCell).toEqual(baseCell);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.baseCell)).toBe(true);
  });

  it('publishes an immediate view, command changes and at most ten advance updates per second', () => {
    const { controller } = createController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(controller.getView());

    expect(
      controller.selectEntity({ kind: 'center', id: standardCenter.id }),
    ).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.lastCall?.[0].selectedEntity).toEqual({
      kind: 'center',
      id: standardCenter.id,
    });

    controller.start();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.lastCall?.[0].snapshot.phase).toBe('RUNNING');

    const callsBeforeAdvances = listener.mock.calls.length;
    for (let index = 0; index < 20; index += 1) controller.advance(10);
    const advancePublicationCount =
      listener.mock.calls.length - callsBeforeAdvances;
    expect(advancePublicationCount).toBeGreaterThan(0);
    expect(advancePublicationCount).toBeLessThanOrEqual(2);

    const callsBeforeCommand = listener.mock.calls.length;
    expect(controller.sendCommand({ type: 'PAUSE_SHIFT' })).toEqual({
      ok: true,
      events: [],
    });
    expect(listener).toHaveBeenCalledTimes(callsBeforeCommand + 1);
    expect(listener.mock.lastCall?.[0].snapshot.phase).toBe('PAUSED');

    unsubscribe();
    const callsAfterUnsubscribe = listener.mock.calls.length;
    controller.sendCommand({ type: 'RESUME_SHIFT' });
    controller.advance(100);
    expect(listener).toHaveBeenCalledTimes(callsAfterUnsubscribe);
  });

  it('forwards a generic game command and exposes its domain result', () => {
    const { controller } = createController();

    expect(controller.sendCommand({ type: 'START_SHIFT' })).toEqual({
      ok: true,
      events: [],
    });
    expect(controller.sendCommand({ type: 'PAUSE_SHIFT' })).toEqual({
      ok: true,
      events: [],
    });
    expect(controller.getView().snapshot.phase).toBe('PAUSED');
  });

  it('previews a battery transfer from current rover state without mutating it', () => {
    const repairRover = {
      ...structuredClone(standardRover),
      id: 'repair-rover',
      archetypeId: 'repair',
      kind: 'repair' as const,
      initialCell: { column: 1, row: 0 },
      cargoCapacity: 0,
      batteryInitial: 0,
    };
    const donorRover = {
      ...structuredClone(standardRover),
      id: 'donor-rover',
      archetypeId: 'heavy',
      initialCell: { column: 1, row: 1 },
      batteryCapacity: 120,
      batteryInitial: 120,
    };
    const config = makeSimulationConfig({ rovers: [repairRover, donorRover] });
    const simulation = createSimulationEngine(config);
    const controller = createMapGameController({
      simulation,
      baseCell: config.baseCell,
    });
    const before = simulation.getSnapshot();

    expect(
      controller.previewBatteryTransfer(donorRover.id, repairRover.id),
    ).toEqual({
      donorBatteryAfter: 0,
      repairBatteryAfter: 100,
      discardedCharge: 20,
    });
    expect(simulation.getSnapshot()).toEqual(before);
  });
});
