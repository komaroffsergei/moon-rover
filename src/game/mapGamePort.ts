import type {
  CommandResult,
  DomainEvent,
  GameCommand,
  GameSnapshot,
  GridCell,
  RoverActionAvailability,
} from '../domain';

export interface MapSimulationPort {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult;
  advance(realMilliseconds: number): readonly DomainEvent[];
}

export type MapSelectedEntity =
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'center'; readonly id: string }
  | { readonly kind: 'rover'; readonly id: string };

export interface MapFocusRequest {
  readonly key: number;
  readonly entity: MapSelectedEntity;
  readonly cell: GridCell;
}

export interface MapBatteryTransferPreview {
  readonly donorBatteryAfter: number;
  readonly repairBatteryAfter: number;
  readonly discardedCharge: number;
}

export interface MapCenterUiMetrics {
  readonly centerId: string;
  readonly oxygenPercent: number;
  readonly foodPercent: number;
  readonly equipmentPercent: number;
  readonly depletionForecastGameMinutes: number;
}

export interface MapGameView {
  readonly snapshot: GameSnapshot;
  readonly baseCell: GridCell;
  readonly selectedEntity: MapSelectedEntity | null;
  readonly focusRequest: MapFocusRequest | null;
  readonly centerMetrics: readonly MapCenterUiMetrics[];
  readonly roverActions: readonly RoverActionAvailability[];
}

export type MapRouteDispatchResult =
  CommandResult | { readonly ok: false; readonly code: 'ROVER_NOT_SELECTED' };

export interface MapGameController {
  getView(): MapGameView;
  subscribe(listener: (view: MapGameView) => void): () => void;
  start(): CommandResult;
  sendCommand(command: GameCommand): CommandResult;
  advance(realMilliseconds: number): readonly DomainEvent[];
  selectEntity(entity: MapSelectedEntity): boolean;
  focusEntity(entity: MapSelectedEntity): boolean;
  routeSelectedRoverTo(cell: GridCell): MapRouteDispatchResult;
  previewBatteryTransfer(
    donorRoverId: string,
    repairRoverId: string,
  ): MapBatteryTransferPreview | null;
}
