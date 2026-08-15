import type { RadioCatalog, RadioMessage } from './radio';
import type { GridCell, NavigationPoint } from './grid';

export type ShiftPhase =
  'BRIEFING' | 'RUNNING' | 'PAUSED' | 'VICTORY' | 'DEFEAT';

export type CenterStatus = 'WORKING' | 'WARNING' | 'RECOVERY' | 'LOST';
export type ConsumableResource = 'oxygen' | 'food';

export interface RoutingCell {
  walkable: boolean;
  movementCost: number;
  effectiveCellChance: number;
  incidentProfileId: string;
}

export interface RoutingMap {
  width: number;
  height: number;
  cells: readonly RoutingCell[];
}

export interface WeightedRouteWeights {
  movementCost: number;
  incidentRisk: number;
}

export type IncidentKind = 'dustStorm' | 'meteorite' | 'crater';

export interface IncidentWeights {
  dustStorm: number;
  meteorite: number;
  crater: number;
}

export interface IncidentProfileDefinition {
  id: string;
  cellChance: number;
  weights: IncidentWeights;
}

export interface IncidentRules {
  eventCooldownCells: number;
  dustStormGameMinutes: number;
  selfRepairGameMinutes: number;
  profiles: readonly IncidentProfileDefinition[];
}

export interface RescueRules {
  repairGameMinutes: number;
  craterRescueGameMinutes: number;
}

export type RouteGoal =
  | { kind: 'BASE' }
  | { kind: 'CENTER'; centerId: string }
  | { kind: 'ROVER'; roverId: string }
  | { kind: 'RESCUE_ADJACENT'; roverId: string }
  | { kind: 'CELL'; cell: GridCell };

export interface RouteForecast {
  lengthCells: number;
  gameMinutes: number;
  batteryCost: number;
  batteryRemaining: number;
  risk: number;
}

export interface RouteCellTraversal {
  readonly cell: GridCell;
  readonly distance: number;
  readonly startDistance: number;
  readonly endDistance: number;
  readonly entersCell: boolean;
}

export interface NavigationLeg {
  readonly from: NavigationPoint;
  readonly to: NavigationPoint;
  readonly distance: number;
  readonly traversals: readonly RouteCellTraversal[];
}

export interface ConfirmedRoute {
  mode: 'LEGACY_CELL' | 'FREE_NAVIGATION';
  origin: GridCell;
  originPosition: NavigationPoint;
  steps: readonly GridCell[];
  legs: readonly NavigationLeg[];
  goal: RouteGoal;
  forecast: RouteForecast;
}

export interface Cargo {
  oxygen: number;
  food: number;
  equipment: number;
}

export type RoverKind = 'courier' | 'repair';
export type RoverStatus =
  | 'IDLE_AT_BASE'
  | 'IDLE_ON_MAP'
  | 'MOVING'
  | 'DELAYED'
  | 'BROKEN'
  | 'STUCK'
  | 'REPAIRING'
  | 'RESCUING'
  | 'SELF_REPAIR'
  | 'OUT_OF_BATTERY';

export type EmergencyOperationKind = 'REPAIR' | 'RESCUE';

export interface EmergencyOperationSnapshot {
  kind: EmergencyOperationKind;
  helperRoverId: string;
  targetRoverId: string;
  remainingGameMinutes: number;
}

export interface DepletingResourceDefinition {
  initial: number;
  capacity: number;
  depletionGameMinutes: number;
}

export interface CenterDefinition {
  id: string;
  name: string;
  cell: GridCell;
  oxygen: DepletingResourceDefinition;
  food: DepletingResourceDefinition;
  equipmentInitial: number;
  equipmentCapacity: number;
}

export interface RoverDefinition {
  id: string;
  name: string;
  archetypeId: string;
  kind: RoverKind;
  initialCell: GridCell;
  cargoCapacity: number;
  batteryCapacity: number;
  batteryInitial: number;
  gameMinutesPerNormalCell: number;
  batteryCostMultiplier: number;
  initialCargo: Cargo;
}

export interface TimeConfig {
  fixedStepMilliseconds: number;
  gameMinutesPerRealSecond: number;
  shiftRealSeconds: number;
}

export interface CenterRules {
  warningThreshold: number;
  recoveryGameMinutes: number;
  radioThresholds: readonly number[];
  recoveryRadioThresholds: readonly number[];
}

export interface EquipmentDemandConfig {
  firstEligibleGameMinute: number;
  minimumIntervalGameMinutes: number;
  lossMin: number;
  lossMax: number;
}

export interface SimulationConfig {
  seed: string;
  time: TimeConfig;
  routeWeights: WeightedRouteWeights;
  centerRules: CenterRules;
  equipmentDemand: EquipmentDemandConfig;
  equipmentDemandCenterIds?: readonly string[];
  incidentRules: IncidentRules;
  rescueRules: RescueRules;
  radioCatalog: RadioCatalog;
  routingMap: RoutingMap;
  baseCell: GridCell;
  centers: readonly CenterDefinition[];
  rovers: readonly RoverDefinition[];
}

export interface CenterSnapshot {
  id: string;
  name: string;
  cell: GridCell;
  status: CenterStatus;
  resources: Readonly<{
    oxygen: number;
    food: number;
    equipment: number;
  }>;
  depletionForecastGameMinutes: number;
  recoveryRemainingGameMinutes: number | null;
}

export interface RoverSnapshot {
  id: string;
  name: string;
  archetypeId: string;
  kind: RoverKind;
  status: RoverStatus;
  cell: GridCell;
  position: NavigationPoint;
  cargo: Cargo;
  cargoCapacity: number;
  battery: number;
  batteryCapacity: number;
  gameMinutesPerNormalCell: number;
  batteryCostMultiplier: number;
  route: ConfirmedRoute | null;
  movement: Readonly<{
    from: NavigationPoint;
    to: NavigationPoint;
    progress: number;
  }> | null;
  activeIncident: Readonly<{
    kind: IncidentKind;
    remainingGameMinutes: number | null;
  }> | null;
  incidentCooldownCellsRemaining: number;
}

export interface GameSnapshot {
  phase: ShiftPhase;
  elapsedRealMilliseconds: number;
  elapsedGameMinutes: number;
  remainingRealMilliseconds: number;
  centers: readonly CenterSnapshot[];
  rovers: readonly RoverSnapshot[];
  emergencyOperations: readonly EmergencyOperationSnapshot[];
  radioMessages: readonly RadioMessage[];
}

interface CenterTimedEvent {
  centerId: string;
  cell: GridCell;
  gameMinute: number;
}

interface RoverTimedEvent {
  roverId: string;
  cell: GridCell;
  gameMinute: number;
}

interface EmergencyTimedEvent {
  helperRoverId: string;
  targetRoverId: string;
  cell: GridCell;
  gameMinute: number;
}

export type DomainEvent =
  | (CenterTimedEvent & {
      type: 'RESOURCE_THRESHOLD';
      resource: ConsumableResource;
      threshold: number;
    })
  | (CenterTimedEvent & { type: 'CENTER_RECOVERY_STARTED' })
  | (CenterTimedEvent & {
      type: 'RECOVERY_THRESHOLD';
      remainingGameMinutes: number;
    })
  | (CenterTimedEvent & { type: 'CENTER_RESTORED' })
  | (CenterTimedEvent & { type: 'CENTER_LOST' })
  | (CenterTimedEvent & { type: 'EQUIPMENT_DEMAND'; amount: number })
  | (CenterTimedEvent & {
      type: 'CENTER_DELIVERY_REQUESTED';
      resource: keyof Cargo;
      amount: number;
    })
  | (RoverTimedEvent & {
      type: 'INCIDENT_STARTED';
      incidentKind: IncidentKind;
      roverKind: RoverKind;
    })
  | (RoverTimedEvent & {
      type: 'INCIDENT_RESOLVED';
      incidentKind: IncidentKind;
    })
  | (RoverTimedEvent & { type: 'ROVER_ARRIVED' })
  | (RoverTimedEvent & {
      type: 'CARGO_DELIVERED';
      centerId: string;
      delivered: Cargo;
    })
  | (RoverTimedEvent & { type: 'ROVER_OUT_OF_BATTERY' })
  | (EmergencyTimedEvent & {
      type: 'EMERGENCY_OPERATION_STARTED';
      operationKind: EmergencyOperationKind;
      durationGameMinutes: number;
    })
  | (EmergencyTimedEvent & {
      type: 'EMERGENCY_OPERATION_COMPLETED';
      operationKind: EmergencyOperationKind;
    })
  | {
      type: 'BATTERY_TRANSFERRED';
      donorRoverId: string;
      repairRoverId: string;
      transferredCharge: number;
      discardedCharge: number;
      cell: GridCell;
      gameMinute: number;
    }
  | {
      type: 'SHIFT_ENDED';
      gameMinute: number;
      outcome: 'VICTORY' | 'DEFEAT';
    };

export type GameCommand =
  | { type: 'START_SHIFT' }
  | { type: 'PAUSE_SHIFT' }
  | { type: 'RESUME_SHIFT' }
  | { type: 'SET_ROVER_CARGO'; roverId: string; cargo: Cargo }
  | { type: 'UNLOAD_ROVER_CARGO'; roverId: string; centerId: string }
  | { type: 'CHARGE_ROVER'; roverId: string }
  | {
      type: 'START_ROVER_REPAIR';
      repairRoverId: string;
      targetRoverId: string;
    }
  | {
      type: 'START_CRATER_RESCUE';
      rescuerRoverId: string;
      targetRoverId: string;
    }
  | {
      type: 'CONFIRM_BATTERY_TRANSFER';
      donorRoverId: string;
      repairRoverId: string;
    }
  | {
      type: 'ASSIGN_ROVER_ROUTE';
      roverId: string;
      steps: readonly GridCell[];
      goal: RouteGoal;
    }
  | {
      type: 'ROUTE_ROVER_TO';
      roverId: string;
      destination: GridCell;
    };

export type StartRoverRepairCommand = Extract<
  GameCommand,
  { type: 'START_ROVER_REPAIR' }
>;

export type StartCraterRescueCommand = Extract<
  GameCommand,
  { type: 'START_CRATER_RESCUE' }
>;

export interface BatteryTransferPair {
  readonly donorRoverId: string;
  readonly repairRoverId: string;
}

/** Готовая read-only проекция действий одного ровера для внешних адаптеров. */
export interface RoverActionAvailability {
  readonly roverId: string;
  readonly canEditCargo: boolean;
  readonly canAssignRoute: boolean;
  readonly canCharge: boolean;
  readonly unloadCenterId: string | null;
  readonly repairCommands: readonly StartRoverRepairCommand[];
  readonly rescueCommands: readonly StartCraterRescueCommand[];
  readonly batteryTransferPairs: readonly BatteryTransferPair[];
}

export type CommandErrorCode =
  | 'INVALID_PHASE'
  | 'SHIFT_NOT_ACTIVE'
  | 'CENTER_NOT_FOUND'
  | 'CENTER_FULL'
  | 'ROVER_NOT_FOUND'
  | 'ROVER_NOT_AT_BASE'
  | 'ROVER_NOT_AT_CENTER'
  | 'ROVER_CARGO_EMPTY'
  | 'REPAIR_ROVER_CANNOT_CARRY'
  | 'INVALID_CARGO'
  | 'CARGO_CAPACITY_EXCEEDED'
  | 'ROUTE_INVALID'
  | 'ROUTE_GOAL_INVALID'
  | 'ROVER_UNAVAILABLE'
  | 'RESCUER_INVALID_KIND'
  | 'TARGET_NOT_BROKEN'
  | 'TARGET_NOT_STUCK'
  | 'ROVER_OUT_OF_RANGE'
  | 'BATTERY_RECIPIENT_INVALID'
  | 'BATTERY_DONOR_INVALID'
  | 'REPAIR_BATTERY_NOT_EMPTY'
  | 'DONOR_BATTERY_EMPTY';

export type CommandResult =
  | { ok: true; events: readonly DomainEvent[] }
  | { ok: false; code: CommandErrorCode };
