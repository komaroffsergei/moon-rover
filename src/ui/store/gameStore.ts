import { createStore, type StoreApi } from 'zustand/vanilla';

import type {
  Cargo,
  CommandErrorCode,
  CommandResult,
  GameCommand,
  GameSnapshot,
  GridCell,
  RoverActionAvailability,
} from '../../domain';

export type GameSelectedEntity =
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'center'; readonly id: string }
  | { readonly kind: 'rover'; readonly id: string };

export interface GamePublishedView {
  readonly snapshot: GameSnapshot;
  readonly baseCell: GridCell;
  readonly selectedEntity: GameSelectedEntity | null;
  readonly focusRequest: {
    readonly key: number;
    readonly entity: GameSelectedEntity;
    readonly cell: GridCell;
  } | null;
  readonly centerMetrics: readonly {
    readonly centerId: string;
    readonly oxygenPercent: number;
    readonly foodPercent: number;
    readonly equipmentPercent: number;
    readonly depletionForecastGameMinutes: number;
  }[];
  readonly roverActions: readonly RoverActionAvailability[];
}

export interface BatteryTransferPreview {
  readonly donorBatteryAfter: number;
  readonly repairBatteryAfter: number;
  readonly discardedCharge: number;
}

export type RouteDispatchResult =
  CommandResult | { readonly ok: false; readonly code: 'ROVER_NOT_SELECTED' };

export interface GameStoreController {
  getView(): GamePublishedView;
  subscribe(listener: (view: GamePublishedView) => void): () => void;
  start(): CommandResult;
  sendCommand(command: GameCommand): CommandResult;
  selectEntity(entity: GameSelectedEntity): boolean;
  focusEntity(entity: GameSelectedEntity): boolean;
  previewBatteryTransfer(
    donorRoverId: string,
    repairRoverId: string,
  ): BatteryTransferPreview | null;
}

export type GameScreen = 'LEVEL_SELECT' | 'BRIEFING' | 'GAME';
export type GameModal = 'PAUSE' | 'BATTERY_TRANSFER' | null;
export type GameCommandError =
  CommandErrorCode | 'ROVER_NOT_SELECTED' | 'BATTERY_TRANSFER_UNAVAILABLE';

export interface GameLevelInfo {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme' | 'maximum';
  readonly riskChoiceCenterCount: number;
  readonly shiftDurationRealSeconds: number;
  readonly centerCount: number;
  readonly roverCount: number;
  readonly courierCount: number;
  readonly previewAsset: string;
}

export interface BatteryTransferState {
  readonly donorRoverId: string;
  readonly repairRoverId: string;
  readonly preview: BatteryTransferPreview;
}

export interface CreateGameStoreOptions {
  readonly controller: GameStoreController;
  readonly level: GameLevelInfo;
  readonly initialScreen?: GameScreen;
}

export interface GameStoreState {
  readonly level: GameLevelInfo;
  readonly view: GamePublishedView;
  readonly screen: GameScreen;
  readonly modal: GameModal;
  readonly batteryTransfer: BatteryTransferState | null;
  readonly radioOpen: boolean;
  readonly commandError: GameCommandError | null;
  readonly cargoDrafts: Readonly<Record<string, Readonly<Cargo>>>;
  openBriefing(): void;
  showLevelSelect(): void;
  startGame(): CommandResult;
  selectEntity(entity: GameSelectedEntity): boolean;
  focusEntity(entity: GameSelectedEntity): boolean;
  reportRouteCommandResult(result: RouteDispatchResult): void;
  pause(): CommandResult;
  resume(): CommandResult;
  toggleRadio(): void;
  closeRadio(): void;
  editCargo(roverId: string, resource: keyof Cargo, value: number): void;
  applyCargo(roverId: string): CommandResult | null;
  sendCommand(command: GameCommand): CommandResult;
  openBatteryTransfer(donorRoverId: string, repairRoverId: string): boolean;
  cancelBatteryTransfer(): void;
  confirmBatteryTransfer(): CommandResult | null;
}

export interface GameStoreSession {
  readonly store: StoreApi<GameStoreState>;
  dispose(): void;
}

const EMPTY_CARGO_DRAFTS: GameStoreState['cargoDrafts'] = Object.freeze({});

function copyCargo(cargo: Readonly<Cargo>): Readonly<Cargo> {
  return Object.freeze({
    oxygen: cargo.oxygen,
    food: cargo.food,
    equipment: cargo.equipment,
  });
}

function commandError(result: CommandResult): CommandErrorCode | null {
  return result.ok ? null : result.code;
}

export function createGameStore(
  options: CreateGameStoreOptions,
): GameStoreSession {
  const { controller } = options;
  const level = Object.freeze({ ...options.level });
  const initialView = controller.getView();

  const store = createStore<GameStoreState>()((set, get) => ({
    level,
    view: initialView,
    screen: options.initialScreen ?? 'LEVEL_SELECT',
    modal: null,
    batteryTransfer: null,
    radioOpen: false,
    commandError: null,
    cargoDrafts: EMPTY_CARGO_DRAFTS,

    openBriefing: () => {
      set({ screen: 'BRIEFING', commandError: null });
    },
    showLevelSelect: () => {
      set({
        screen: 'LEVEL_SELECT',
        modal: null,
        batteryTransfer: null,
        radioOpen: false,
        commandError: null,
      });
    },
    startGame: () => {
      const result = controller.start();
      set({
        ...(result.ok ? { screen: 'GAME' as const } : {}),
        commandError: commandError(result),
      });
      return result;
    },
    selectEntity: (entity) => controller.selectEntity(entity),
    focusEntity: (entity) => controller.focusEntity(entity),
    reportRouteCommandResult: (result) => {
      set({ commandError: result.ok ? null : result.code });
    },
    pause: () => {
      const result = controller.sendCommand({ type: 'PAUSE_SHIFT' });
      set({
        ...(result.ok ? { modal: 'PAUSE' as const } : {}),
        commandError: commandError(result),
      });
      return result;
    },
    resume: () => {
      const result = controller.sendCommand({ type: 'RESUME_SHIFT' });
      set({
        ...(result.ok ? { modal: null } : {}),
        commandError: commandError(result),
      });
      return result;
    },
    toggleRadio: () => {
      set((state) => ({ radioOpen: !state.radioOpen }));
    },
    closeRadio: () => {
      set({ radioOpen: false });
    },
    editCargo: (roverId, resource, value) => {
      const state = get();
      const source =
        state.cargoDrafts[roverId] ??
        state.view.snapshot.rovers.find(({ id }) => id === roverId)?.cargo;
      if (!source) return;

      const draft = copyCargo({ ...source, [resource]: value });
      set({
        cargoDrafts: Object.freeze({
          ...state.cargoDrafts,
          [roverId]: draft,
        }),
      });
    },
    applyCargo: (roverId) => {
      const state = get();
      const cargo =
        state.cargoDrafts[roverId] ??
        state.view.snapshot.rovers.find(({ id }) => id === roverId)?.cargo;
      if (!cargo) return null;

      const result = controller.sendCommand({
        type: 'SET_ROVER_CARGO',
        roverId,
        cargo: { ...cargo },
      });
      set({ commandError: commandError(result) });
      return result;
    },
    sendCommand: (command) => {
      const result = controller.sendCommand(command);
      set({ commandError: commandError(result) });
      return result;
    },
    openBatteryTransfer: (donorRoverId, repairRoverId) => {
      const preview = controller.previewBatteryTransfer(
        donorRoverId,
        repairRoverId,
      );
      if (preview === null) {
        set({
          modal: null,
          batteryTransfer: null,
          commandError: 'BATTERY_TRANSFER_UNAVAILABLE',
        });
        return false;
      }

      set({
        modal: 'BATTERY_TRANSFER',
        batteryTransfer: Object.freeze({
          donorRoverId,
          repairRoverId,
          preview: Object.freeze({ ...preview }),
        }),
        commandError: null,
      });
      return true;
    },
    cancelBatteryTransfer: () => {
      set((state) => ({
        modal: state.modal === 'BATTERY_TRANSFER' ? null : state.modal,
        batteryTransfer: null,
      }));
    },
    confirmBatteryTransfer: () => {
      const transfer = get().batteryTransfer;
      if (transfer === null) return null;

      const result = controller.sendCommand({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: transfer.donorRoverId,
        repairRoverId: transfer.repairRoverId,
      });
      set({
        ...(result.ok ? { modal: null, batteryTransfer: null } : {}),
        commandError: commandError(result),
      });
      return result;
    },
  }));

  const unsubscribe = controller.subscribe((view) => {
    store.setState({ view });
  });
  let disposed = false;

  return Object.freeze({
    store,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  });
}
