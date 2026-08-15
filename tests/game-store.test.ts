import { describe, expect, it, vi } from 'vitest';

import type {
  Cargo,
  CommandResult,
  GameCommand,
  GridCell,
} from '../src/domain';
import type {
  MapBatteryTransferPreview,
  MapGameController,
  MapGameView,
  MapSelectedEntity,
} from '../src/game/mapGamePort';
import { createGameStore, type GameLevelInfo } from '../src/ui/store/gameStore';

const level: GameLevelInfo = Object.freeze({
  id: 'level-02-shackleton',
  ordinal: 2,
  title: 'Разлом Шеклтона',
  description: 'Тестовый уровень',
  objective: 'Сохранить центры',
  riskLevel: 'medium',
  riskChoiceCenterCount: 2,
  shiftDurationRealSeconds: 300,
  centerCount: 3,
  roverCount: 4,
  courierCount: 3,
  previewAsset: '/preview.webp',
});

function frozenView(): MapGameView {
  return Object.freeze({
    snapshot: Object.freeze({
      phase: 'BRIEFING',
      elapsedRealMilliseconds: 0,
      elapsedGameMinutes: 0,
      remainingRealMilliseconds: 300_000,
      centers: Object.freeze([]),
      rovers: Object.freeze([
        Object.freeze({
          id: 'courier-1',
          name: 'Курьер-1',
          archetypeId: 'standard',
          kind: 'courier',
          status: 'IDLE_AT_BASE',
          cell: Object.freeze({ column: 0, row: 0 }),
          position: Object.freeze({ column: 0, row: 0 }),
          cargo: Object.freeze({ oxygen: 2, food: 3, equipment: 4 }),
          cargoCapacity: 50,
          battery: 90,
          batteryCapacity: 100,
          gameMinutesPerNormalCell: 2,
          batteryCostMultiplier: 1,
          route: null,
          movement: null,
          activeIncident: null,
          incidentCooldownCellsRemaining: 0,
        }),
      ]),
      emergencyOperations: Object.freeze([]),
      radioMessages: Object.freeze([]),
    }),
    baseCell: Object.freeze({ column: 0, row: 0 }),
    selectedEntity: null,
    routingRoverId: null,
    focusRequest: null,
    centerMetrics: Object.freeze([]),
    roverActions: Object.freeze([]),
    routeDraft: null,
    candidateCells: Object.freeze([]),
    forecast: null,
    canDispatchRoute: false,
  });
}

function controllerHarness(initialView = frozenView()) {
  let currentView = initialView;
  let listener: ((view: MapGameView) => void) | null = null;
  const unsubscribe = vi.fn();
  const sendCommand = vi.fn((command: GameCommand): CommandResult => {
    void command;
    return { ok: true as const, events: [] };
  });
  const preview: MapBatteryTransferPreview = Object.freeze({
    donorBatteryAfter: 10,
    repairBatteryAfter: 100,
    discardedCharge: 5,
  });
  const controller: MapGameController = {
    getView: vi.fn(() => currentView),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      nextListener(currentView);
      return unsubscribe;
    }),
    start: vi.fn(() => ({ ok: true as const, events: [] })),
    sendCommand,
    advance: vi.fn(() => []),
    selectEntity: vi.fn(() => true),
    focusEntity: vi.fn(() => true),
    beginRoute: vi.fn(() => true),
    cancelRoute: vi.fn(),
    selectCell: vi.fn(() => true),
    undo: vi.fn(),
    clear: vi.fn(),
    dispatchRoute: vi.fn(() => ({ ok: true as const, events: [] })),
    routeSelectedRoverTo: vi.fn(() => ({ ok: true as const, events: [] })),
    previewBatteryTransfer: vi.fn(() => preview),
  };

  return {
    controller,
    preview,
    publish(view: MapGameView) {
      currentView = view;
      listener?.(view);
    },
    sendCommand,
    unsubscribe,
  };
}

describe('per-session game store', () => {
  it('owns level-select, briefing and game screen flow', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });

    expect(session.store.getState()).toMatchObject({
      level,
      screen: 'LEVEL_SELECT',
      modal: null,
      radioOpen: false,
    });

    session.store.getState().openBriefing();
    expect(session.store.getState().screen).toBe('BRIEFING');
    session.store.getState().showLevelSelect();
    expect(session.store.getState().screen).toBe('LEVEL_SELECT');
    session.store.getState().openBriefing();
    expect(session.store.getState().startGame()).toEqual({
      ok: true,
      events: [],
    });
    expect(harness.controller.start).toHaveBeenCalledOnce();
    expect(session.store.getState().screen).toBe('GAME');

    session.dispose();
  });

  it('owns the closed-by-default radio drawer and supports toggle and collapse', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });

    expect(session.store.getState().radioOpen).toBe(false);
    session.store.getState().toggleRadio();
    expect(session.store.getState().radioOpen).toBe(true);
    session.store.getState().closeRadio();
    expect(session.store.getState().radioOpen).toBe(false);

    session.dispose();
  });

  it('subscribes exactly once, publishes the controller view and disposes once', () => {
    const firstView = frozenView();
    const harness = controllerHarness(firstView);
    const session = createGameStore({
      controller: harness.controller,
      level,
      initialScreen: 'BRIEFING',
    });
    const nextView = Object.freeze({
      ...firstView,
      selectedEntity: Object.freeze({ kind: 'rover', id: 'courier-1' }),
    }) satisfies MapGameView;

    expect(harness.controller.subscribe).toHaveBeenCalledOnce();
    expect(session.store.getState().view).toBe(firstView);
    expect(session.store.getState().screen).toBe('BRIEFING');
    harness.publish(nextView);
    expect(session.store.getState().view).toBe(nextView);

    session.dispose();
    session.dispose();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('pauses and resumes only through typed controller commands', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });

    expect(session.store.getState().pause()).toMatchObject({ ok: true });
    expect(harness.sendCommand).toHaveBeenLastCalledWith({
      type: 'PAUSE_SHIFT',
    });
    expect(session.store.getState().modal).toBe('PAUSE');

    expect(session.store.getState().resume()).toMatchObject({ ok: true });
    expect(harness.sendCommand).toHaveBeenLastCalledWith({
      type: 'RESUME_SHIFT',
    });
    expect(session.store.getState().modal).toBeNull();
    session.dispose();
  });

  it('builds a cargo draft without mutating the snapshot and sends it exactly', () => {
    const view = frozenView();
    const cargoBefore = structuredClone(view.snapshot.rovers[0]!.cargo);
    const harness = controllerHarness(view);
    const session = createGameStore({ controller: harness.controller, level });

    session.store.getState().editCargo('courier-1', 'oxygen', 12);
    session.store.getState().editCargo('courier-1', 'food', 8);
    expect(session.store.getState().applyCargo('courier-1')).toMatchObject({
      ok: true,
    });

    expect(harness.sendCommand).toHaveBeenLastCalledWith({
      type: 'SET_ROVER_CARGO',
      roverId: 'courier-1',
      cargo: { oxygen: 12, food: 8, equipment: 4 },
    });
    expect(view.snapshot.rovers[0]!.cargo).toEqual(cargoBefore);
    expect(session.store.getState().cargoDrafts['courier-1']).toEqual({
      oxygen: 12,
      food: 8,
      equipment: 4,
    });
    session.dispose();
  });

  it('delegates entity and manual-route interactions to the controller', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });
    const entity: MapSelectedEntity = { kind: 'rover', id: 'courier-1' };
    const cell: GridCell = { column: 1, row: 0 };

    expect(session.store.getState().selectEntity(entity)).toBe(true);
    expect(session.store.getState().focusEntity(entity)).toBe(true);
    expect(session.store.getState().beginRoute('courier-1')).toBe(true);
    expect(session.store.getState().selectCell(cell)).toBe(true);
    session.store.getState().undoRoute();
    session.store.getState().clearRoute();
    expect(session.store.getState().dispatchRoute()).toMatchObject({
      ok: true,
    });
    session.store.getState().cancelRoute();

    expect(harness.controller.selectEntity).toHaveBeenCalledWith(entity);
    expect(harness.controller.focusEntity).toHaveBeenCalledWith(entity);
    expect(harness.controller.beginRoute).toHaveBeenCalledWith('courier-1');
    expect(harness.controller.selectCell).toHaveBeenCalledWith(cell);
    expect(harness.controller.undo).toHaveBeenCalledOnce();
    expect(harness.controller.clear).toHaveBeenCalledOnce();
    expect(harness.controller.dispatchRoute).toHaveBeenCalledOnce();
    expect(harness.controller.cancelRoute).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('previews, cancels and confirms battery transfer through the controller', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });

    expect(
      session.store.getState().openBatteryTransfer('courier-1', 'repair-1'),
    ).toBe(true);
    expect(harness.controller.previewBatteryTransfer).toHaveBeenCalledWith(
      'courier-1',
      'repair-1',
    );
    expect(session.store.getState()).toMatchObject({
      modal: 'BATTERY_TRANSFER',
      batteryTransfer: {
        donorRoverId: 'courier-1',
        repairRoverId: 'repair-1',
        preview: harness.preview,
      },
    });

    session.store.getState().cancelBatteryTransfer();
    expect(session.store.getState().modal).toBeNull();
    session.store.getState().openBatteryTransfer('courier-1', 'repair-1');
    expect(session.store.getState().confirmBatteryTransfer()).toMatchObject({
      ok: true,
    });
    expect(harness.sendCommand).toHaveBeenLastCalledWith({
      type: 'CONFIRM_BATTERY_TRANSFER',
      donorRoverId: 'courier-1',
      repairRoverId: 'repair-1',
    });
    expect(session.store.getState()).toMatchObject({
      modal: null,
      batteryTransfer: null,
    });
    session.dispose();
  });

  it('sends arbitrary typed commands, tracks errors and keeps snapshots frozen', () => {
    const view = frozenView();
    const harness = controllerHarness(view);
    harness.sendCommand.mockReturnValueOnce({
      ok: false,
      code: 'ROVER_NOT_AT_CENTER',
    });
    const session = createGameStore({ controller: harness.controller, level });
    const cargo: Cargo = { oxygen: 1, food: 1, equipment: 1 };

    expect(
      session.store.getState().sendCommand({
        type: 'SET_ROVER_CARGO',
        roverId: 'courier-1',
        cargo,
      }),
    ).toEqual({ ok: false, code: 'ROVER_NOT_AT_CENTER' });
    expect(session.store.getState().commandError).toBe('ROVER_NOT_AT_CENTER');
    expect(session.store.getState().view).toBe(view);
    expect(Object.isFrozen(session.store.getState().view.snapshot)).toBe(true);
    expect(Object.isFrozen(view.snapshot.rovers[0]!.cargo)).toBe(true);
    session.dispose();
  });

  it('surfaces a map-originated route rejection and clears it after success', () => {
    const harness = controllerHarness();
    const session = createGameStore({ controller: harness.controller, level });

    session.store
      .getState()
      .reportRouteCommandResult({ ok: false, code: 'ROUTE_INVALID' });
    expect(session.store.getState().commandError).toBe('ROUTE_INVALID');

    session.store.getState().reportRouteCommandResult({ ok: true, events: [] });
    expect(session.store.getState().commandError).toBeNull();
    session.dispose();
  });
});
