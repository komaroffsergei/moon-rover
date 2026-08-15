import type { DomainEvent, GridCell } from '../../domain';
import type { MutableRoverState } from '../types';
import { sameCell } from '../rovers/cells';

export type InterruptedRoutePolicy = 'RESUME' | 'CLEAR';

function clearRoute(rover: MutableRoverState): void {
  rover.route = null;
  rover.routeStepIndex = 0;
  rover.stepElapsedGameMinutes = 0;
  rover.stepDurationGameMinutes = null;
  rover.routeLegIndex = 0;
  rover.legDistance = 0;
  rover.routeTraversalIndex = 0;
}

function readyStatus(rover: MutableRoverState, baseCell: GridCell) {
  if (rover.battery <= 0) return 'OUT_OF_BATTERY' as const;
  if (rover.route !== null) return 'MOVING' as const;
  return sameCell(rover.cell, baseCell)
    ? ('IDLE_AT_BASE' as const)
    : ('IDLE_ON_MAP' as const);
}

export function resolveRoverIncident(
  rover: MutableRoverState,
  baseCell: GridCell,
  gameMinute: number,
  events: DomainEvent[],
  routePolicy: InterruptedRoutePolicy,
): void {
  const incident = rover.activeIncident;
  if (incident === null) return;
  rover.activeIncident = null;
  events.push({
    type: 'INCIDENT_RESOLVED',
    roverId: rover.id,
    incidentKind: incident.kind,
    cell: { ...rover.cell },
    gameMinute,
  });

  const reachedEnd =
    rover.route !== null &&
    (rover.route.mode === 'FREE_NAVIGATION'
      ? rover.routeLegIndex >= rover.route.legs.length
      : rover.routeStepIndex >= rover.route.steps.length);
  if (reachedEnd) {
    clearRoute(rover);
    events.push({
      type: 'ROVER_ARRIVED',
      roverId: rover.id,
      cell: { ...rover.cell },
      gameMinute,
    });
  } else if (routePolicy === 'CLEAR') {
    clearRoute(rover);
  }

  rover.status = readyStatus(rover, baseCell);
  if (rover.battery <= 0) {
    events.push({
      type: 'ROVER_OUT_OF_BATTERY',
      roverId: rover.id,
      cell: { ...rover.cell },
      gameMinute,
    });
  }
}
