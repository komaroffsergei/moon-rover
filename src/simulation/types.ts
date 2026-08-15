import type {
  Cargo,
  CenterStatus,
  CommandResult,
  DepletingResourceDefinition,
  DomainEvent,
  ConfirmedRoute,
  GameCommand,
  GameSnapshot,
  GridCell,
  NavigationPoint,
  IncidentKind,
  RoverDefinition,
  RoverStatus,
} from '../domain';

export interface SimulationEngine {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult;
  advance(realMilliseconds: number): readonly DomainEvent[];
}

export interface MutableResourceState extends DepletingResourceDefinition {
  current: number;
  emittedThresholds: Set<number>;
}

export interface MutableCenterState {
  id: string;
  name: string;
  cell: GridCell;
  status: CenterStatus;
  oxygen: MutableResourceState;
  food: MutableResourceState;
  equipment: number;
  equipmentCapacity: number;
  recoveryRemainingGameMinutes: number | null;
  emittedRecoveryThresholds: Set<number>;
  nextEquipmentDemandGameMinute: number;
}

export interface MutableRoverState extends Omit<
  RoverDefinition,
  'initialCell' | 'initialCargo' | 'batteryInitial'
> {
  status: RoverStatus;
  cell: GridCell;
  position: NavigationPoint;
  cargo: Cargo;
  baseLoadout: Cargo;
  battery: number;
  route: ConfirmedRoute | null;
  routeStepIndex: number;
  stepElapsedGameMinutes: number;
  stepDurationGameMinutes: number | null;
  routeLegIndex: number;
  legDistance: number;
  routeTraversalIndex: number;
  activeIncident: {
    kind: IncidentKind;
    remainingGameMinutes: number | null;
  } | null;
  incidentCooldownCellsRemaining: number;
}
