import type {
  CommandResult,
  DomainEvent,
  GameCommand,
  GameSnapshot,
  GridCell,
  RoverActionAvailability,
  RouteForecast,
} from '../domain';

export interface MapSimulationPort {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult;
  advance(realMilliseconds: number): readonly DomainEvent[];
}

export interface MapRouteDraftView {
  readonly origin: GridCell;
  readonly steps: readonly GridCell[];
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
  readonly routingRoverId: string | null;
  readonly focusRequest: MapFocusRequest | null;
  readonly centerMetrics: readonly MapCenterUiMetrics[];
  readonly roverActions: readonly RoverActionAvailability[];
  readonly routeDraft: MapRouteDraftView | null;
  readonly candidateCells: readonly GridCell[];
  readonly forecast: RouteForecast | null;
  readonly canDispatchRoute: boolean;
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
  beginRoute(roverId: string): boolean;
  cancelRoute(): void;
  selectCell(cell: GridCell): boolean;
  undo(): void;
  clear(): void;
  dispatchRoute(): MapRouteDispatchResult;
  routeSelectedRoverTo(cell: GridCell): MapRouteDispatchResult;
  previewBatteryTransfer(
    donorRoverId: string,
    repairRoverId: string,
  ): MapBatteryTransferPreview | null;
}
