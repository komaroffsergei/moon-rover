import type { GridCell, RoverDefinition, RoverSnapshot } from '../../domain';
import type { MutableRoverState } from '../types';
import { sameCell } from './cells';

export function createRoverState(
  definition: RoverDefinition,
  baseCell: GridCell,
): MutableRoverState {
  const { initialCell, initialCargo, batteryInitial, ...properties } =
    definition;
  const atBase = sameCell(initialCell, baseCell);
  return {
    ...properties,
    status:
      !atBase && batteryInitial <= 0
        ? 'OUT_OF_BATTERY'
        : atBase
          ? 'IDLE_AT_BASE'
          : 'IDLE_ON_MAP',
    cell: { ...initialCell },
    position: { ...initialCell },
    cargo: { ...initialCargo },
    baseLoadout: { ...initialCargo },
    battery: atBase ? definition.batteryCapacity : batteryInitial,
    route: null,
    routeStepIndex: 0,
    stepElapsedGameMinutes: 0,
    stepDurationGameMinutes: null,
    routeLegIndex: 0,
    legDistance: 0,
    routeTraversalIndex: 0,
    activeIncident: null,
    incidentCooldownCellsRemaining: 0,
  };
}

export function serviceRoverAtBase(rover: MutableRoverState): void {
  rover.battery = rover.batteryCapacity;
  rover.cargo = { ...rover.baseLoadout };
  rover.status = 'IDLE_AT_BASE';
}

export function snapshotRover(rover: MutableRoverState): RoverSnapshot {
  const legacyTarget =
    rover.route?.mode === 'LEGACY_CELL'
      ? rover.route.steps[rover.routeStepIndex]
      : undefined;
  const navigationLeg =
    rover.route?.mode === 'FREE_NAVIGATION'
      ? rover.route.legs[rover.routeLegIndex]
      : undefined;
  const canShowMovement =
    (legacyTarget !== undefined || navigationLeg !== undefined) &&
    rover.status === 'MOVING' &&
    rover.activeIncident === null &&
    rover.battery > 0;
  const snapshot = {
    id: rover.id,
    name: rover.name,
    archetypeId: rover.archetypeId,
    kind: rover.kind,
    status: rover.status,
    cell: { ...rover.cell },
    position: { ...rover.position },
    cargo: { ...rover.cargo },
    cargoCapacity: rover.cargoCapacity,
    battery: rover.battery,
    batteryCapacity: rover.batteryCapacity,
    gameMinutesPerNormalCell: rover.gameMinutesPerNormalCell,
    batteryCostMultiplier: rover.batteryCostMultiplier,
    route: rover.route,
    movement: !canShowMovement
      ? null
      : navigationLeg !== undefined
        ? {
            from: { ...navigationLeg.from },
            to: { ...navigationLeg.to },
            progress:
              navigationLeg.distance <= 0
                ? 1
                : Math.min(1, rover.legDistance / navigationLeg.distance),
          }
        : {
            from: { ...rover.cell },
            to: { ...legacyTarget! },
            progress:
              rover.stepDurationGameMinutes === null
                ? 0
                : Math.min(
                    1,
                    rover.stepElapsedGameMinutes /
                      rover.stepDurationGameMinutes,
                  ),
          },
    activeIncident:
      rover.activeIncident === null ? null : { ...rover.activeIncident },
    incidentCooldownCellsRemaining: rover.incidentCooldownCellsRemaining,
  };
  if (snapshot.movement !== null) {
    Object.freeze(snapshot.movement.from);
    Object.freeze(snapshot.movement.to);
    Object.freeze(snapshot.movement);
  }
  Object.freeze(snapshot.position);
  if (snapshot.activeIncident !== null) Object.freeze(snapshot.activeIncident);
  return snapshot;
}
