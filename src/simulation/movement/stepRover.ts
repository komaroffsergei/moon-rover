import type {
  DomainEvent,
  GridCell,
  IncidentKind,
  IncidentProfileDefinition,
  IncidentRules,
  NavigationLeg,
  RoutingMap,
} from '../../domain';
import { roundGameValue } from '../clock/fixedStepClock';
import { calculateBatteryAfterCellEntry } from '../battery/calculateBattery';
import {
  drawIncident,
  type IncidentRandomStreams,
} from '../incidents/incidentRandom';
import { calculateCellTravelGameMinutes } from '../routing/forecastRoute';
import type { MutableRoverState } from '../types';
import { sameCell } from '../rovers/cells';
import { resolveRoverIncident } from './resolveRoverIncident';

function routingCellAt(map: RoutingMap, cell: GridCell) {
  return map.cells[cell.row * map.width + cell.column];
}

function positionAlongLeg(leg: NavigationLeg, distance: number) {
  const progress =
    leg.distance <= 0 ? 1 : Math.min(1, Math.max(0, distance / leg.distance));
  return {
    column: leg.from.column + (leg.to.column - leg.from.column) * progress,
    row: leg.from.row + (leg.to.row - leg.from.row) * progress,
  };
}

function idleStatus(rover: MutableRoverState, baseCell: GridCell) {
  return sameCell(rover.cell, baseCell) ? 'IDLE_AT_BASE' : 'IDLE_ON_MAP';
}

function movementStatus(rover: MutableRoverState, baseCell: GridCell) {
  if (rover.battery <= 0) return 'OUT_OF_BATTERY' as const;
  return rover.route === null
    ? idleStatus(rover, baseCell)
    : ('MOVING' as const);
}

function incidentDuration(
  rover: MutableRoverState,
  kind: IncidentKind,
  rules: IncidentRules,
): number | null {
  if (kind === 'dustStorm') return rules.dustStormGameMinutes;
  return rover.kind === 'repair' ? rules.selfRepairGameMinutes : null;
}

function startIncident(
  rover: MutableRoverState,
  kind: IncidentKind,
  rules: IncidentRules,
): void {
  const remainingGameMinutes = incidentDuration(rover, kind, rules);
  rover.activeIncident = { kind, remainingGameMinutes };
  rover.incidentCooldownCellsRemaining = rules.eventCooldownCells;
  rover.status =
    kind === 'dustStorm'
      ? 'DELAYED'
      : rover.kind === 'repair'
        ? 'SELF_REPAIR'
        : kind === 'meteorite'
          ? 'BROKEN'
          : 'STUCK';
}

function finishRoute(
  rover: MutableRoverState,
  baseCell: GridCell,
  gameMinute: number,
  events: DomainEvent[],
): void {
  rover.route = null;
  rover.routeStepIndex = 0;
  rover.stepElapsedGameMinutes = 0;
  rover.stepDurationGameMinutes = null;
  rover.routeLegIndex = 0;
  rover.legDistance = 0;
  rover.routeTraversalIndex = 0;
  events.push({
    type: 'ROVER_ARRIVED',
    roverId: rover.id,
    cell: { ...rover.cell },
    gameMinute,
  });
  rover.status = movementStatus(rover, baseCell);
}

export interface StepRoverContext {
  deltaGameMinutes: number;
  gameMinuteAtStepStart: number;
  baseCell: GridCell;
  routingMap: RoutingMap;
  incidentRules: IncidentRules;
  incidentProfiles: ReadonlyMap<string, IncidentProfileDefinition>;
  random: IncidentRandomStreams;
}

export function stepRover(
  rover: MutableRoverState,
  context: StepRoverContext,
): readonly DomainEvent[] {
  const events: DomainEvent[] = [];
  let budget = context.deltaGameMinutes;
  let consumed = 0;

  const advanceActiveIncident = (): boolean => {
    const activeIncident = rover.activeIncident;
    if (activeIncident === null) return false;
    if (activeIncident.remainingGameMinutes === null) return true;

    const used = Math.min(budget, activeIncident.remainingGameMinutes);
    activeIncident.remainingGameMinutes = roundGameValue(
      activeIncident.remainingGameMinutes - used,
    );
    budget = roundGameValue(budget - used);
    consumed = roundGameValue(consumed + used);
    if (activeIncident.remainingGameMinutes > 0) return true;
    resolveRoverIncident(
      rover,
      context.baseCell,
      roundGameValue(context.gameMinuteAtStepStart + consumed),
      events,
      'RESUME',
    );
    return false;
  };

  if (advanceActiveIncident()) return events;

  if (rover.status !== 'MOVING' || rover.battery <= 0 || rover.route === null) {
    return events;
  }

  const processCellEntry = (target: GridCell, entryGameMinute: number) => {
    const routingCell = routingCellAt(context.routingMap, target);
    if (routingCell === undefined) throw new Error('Route target отсутствует');
    rover.cell = { ...target };

    let incident: IncidentKind | null = null;
    if (rover.incidentCooldownCellsRemaining > 0) {
      rover.incidentCooldownCellsRemaining -= 1;
    } else {
      const profile = context.incidentProfiles.get(
        routingCell.incidentProfileId,
      );
      if (profile === undefined) {
        throw new Error(
          `Incident profile ${routingCell.incidentProfileId} отсутствует`,
        );
      }
      incident = drawIncident(context.random, profile);
    }
    if (incident === null) return false;

    startIncident(rover, incident, context.incidentRules);
    events.push({
      type: 'INCIDENT_STARTED',
      roverId: rover.id,
      roverKind: rover.kind,
      incidentKind: incident,
      cell: { ...rover.cell },
      gameMinute: entryGameMinute,
    });
    return true;
  };

  if (rover.route.mode === 'FREE_NAVIGATION') {
    const DISTANCE_EPSILON = 1e-9;
    while (
      budget > 0 &&
      rover.route !== null &&
      rover.route.mode === 'FREE_NAVIGATION'
    ) {
      const leg = rover.route.legs[rover.routeLegIndex];
      if (leg === undefined) {
        finishRoute(
          rover,
          context.baseCell,
          roundGameValue(context.gameMinuteAtStepStart + consumed),
          events,
        );
        break;
      }
      const traversal = leg.traversals[rover.routeTraversalIndex];
      if (traversal === undefined) {
        rover.position = { ...leg.to };
        rover.routeLegIndex += 1;
        rover.legDistance = 0;
        rover.routeTraversalIndex = 0;
        if (rover.routeLegIndex >= rover.route.legs.length) {
          finishRoute(
            rover,
            context.baseCell,
            roundGameValue(context.gameMinuteAtStepStart + consumed),
            events,
          );
        }
        continue;
      }
      if (rover.legDistance < traversal.startDistance - DISTANCE_EPSILON) {
        throw new Error('Навигационный traversal содержит разрыв');
      }
      rover.legDistance = Math.max(rover.legDistance, traversal.startDistance);

      const routingCell = routingCellAt(context.routingMap, traversal.cell);
      if (routingCell === undefined)
        throw new Error('Route target отсутствует');
      const remainingDistance = Math.max(
        0,
        traversal.endDistance - rover.legDistance,
      );
      if (remainingDistance > DISTANCE_EPSILON) {
        const gameMinutesPerDistance =
          routingCell.movementCost * rover.gameMinutesPerNormalCell;
        const batteryPerDistance =
          routingCell.movementCost * rover.batteryCostMultiplier;
        const distanceByTime = budget / gameMinutesPerDistance;
        const distanceByBattery =
          batteryPerDistance === 0
            ? Number.POSITIVE_INFINITY
            : rover.battery / batteryPerDistance;
        const travelledDistance = Math.min(
          remainingDistance,
          distanceByTime,
          distanceByBattery,
        );
        const usedGameMinutes = travelledDistance * gameMinutesPerDistance;
        rover.legDistance = Math.min(
          traversal.endDistance,
          rover.legDistance + travelledDistance,
        );
        rover.position = positionAlongLeg(leg, rover.legDistance);
        rover.battery = Math.max(
          0,
          roundGameValue(
            rover.battery - travelledDistance * batteryPerDistance,
          ),
        );
        budget = Math.max(0, roundGameValue(budget - usedGameMinutes));
        consumed = roundGameValue(consumed + usedGameMinutes);

        if (rover.legDistance < traversal.endDistance - DISTANCE_EPSILON) {
          if (rover.battery <= 0) {
            rover.status = 'OUT_OF_BATTERY';
            events.push({
              type: 'ROVER_OUT_OF_BATTERY',
              roverId: rover.id,
              cell: { ...rover.cell },
              gameMinute: roundGameValue(
                context.gameMinuteAtStepStart + consumed,
              ),
            });
          }
          break;
        }
        rover.legDistance = traversal.endDistance;
        rover.position = positionAlongLeg(leg, rover.legDistance);
      }

      rover.routeTraversalIndex += 1;
      const nextTraversal = leg.traversals[rover.routeTraversalIndex];
      if (nextTraversal?.entersCell === true) {
        const entryGameMinute = roundGameValue(
          context.gameMinuteAtStepStart + consumed,
        );
        const incidentStarted = processCellEntry(
          nextTraversal.cell,
          entryGameMinute,
        );
        if (incidentStarted) {
          if (advanceActiveIncident()) break;
          if (rover.route === null || rover.battery <= 0) break;
          continue;
        }
      }
      if (nextTraversal === undefined) {
        rover.position = { ...leg.to };
        rover.routeLegIndex += 1;
        rover.legDistance = 0;
        rover.routeTraversalIndex = 0;
        if (rover.routeLegIndex >= rover.route.legs.length) {
          finishRoute(
            rover,
            context.baseCell,
            roundGameValue(context.gameMinuteAtStepStart + consumed),
            events,
          );
        }
      }
      if (rover.battery <= 0) {
        rover.status = 'OUT_OF_BATTERY';
        events.push({
          type: 'ROVER_OUT_OF_BATTERY',
          roverId: rover.id,
          cell: { ...rover.cell },
          gameMinute: roundGameValue(context.gameMinuteAtStepStart + consumed),
        });
        break;
      }
    }
    return events;
  }

  while (budget > 0 && rover.route !== null) {
    const target = rover.route.steps[rover.routeStepIndex];
    if (target === undefined) {
      finishRoute(
        rover,
        context.baseCell,
        roundGameValue(context.gameMinuteAtStepStart + consumed),
        events,
      );
      break;
    }
    const routingCell = routingCellAt(context.routingMap, target);
    if (routingCell === undefined) throw new Error('Route target отсутствует');
    const duration = calculateCellTravelGameMinutes(
      routingCell.movementCost,
      rover.gameMinutesPerNormalCell,
    );
    rover.stepDurationGameMinutes = duration;
    const remaining = roundGameValue(duration - rover.stepElapsedGameMinutes);
    const used = Math.min(budget, remaining);
    rover.stepElapsedGameMinutes = roundGameValue(
      rover.stepElapsedGameMinutes + used,
    );
    const progress =
      duration <= 0 ? 1 : rover.stepElapsedGameMinutes / duration;
    rover.position = {
      column:
        rover.cell.column + (target.column - rover.cell.column) * progress,
      row: rover.cell.row + (target.row - rover.cell.row) * progress,
    };
    budget = roundGameValue(budget - used);
    consumed = roundGameValue(consumed + used);
    if (rover.stepElapsedGameMinutes < duration) break;

    rover.cell = { ...target };
    rover.position = { ...target };
    rover.routeStepIndex += 1;
    rover.stepElapsedGameMinutes = 0;
    rover.stepDurationGameMinutes = null;
    rover.battery = calculateBatteryAfterCellEntry(
      rover.battery,
      routingCell.movementCost,
      rover.batteryCostMultiplier,
    );

    let incident: IncidentKind | null = null;
    if (rover.incidentCooldownCellsRemaining > 0) {
      rover.incidentCooldownCellsRemaining -= 1;
    } else {
      const profile = context.incidentProfiles.get(
        routingCell.incidentProfileId,
      );
      if (profile === undefined) {
        throw new Error(
          `Incident profile ${routingCell.incidentProfileId} отсутствует`,
        );
      }
      incident = drawIncident(context.random, profile);
    }
    const entryGameMinute = roundGameValue(
      context.gameMinuteAtStepStart + consumed,
    );
    if (incident !== null) {
      startIncident(rover, incident, context.incidentRules);
      events.push({
        type: 'INCIDENT_STARTED',
        roverId: rover.id,
        roverKind: rover.kind,
        incidentKind: incident,
        cell: { ...rover.cell },
        gameMinute: entryGameMinute,
      });
      if (advanceActiveIncident()) break;
      if (rover.route === null || rover.battery <= 0) {
        break;
      }
      continue;
    }

    const reachedEnd = rover.routeStepIndex >= rover.route.steps.length;
    if (reachedEnd) {
      finishRoute(rover, context.baseCell, entryGameMinute, events);
    }
    if (rover.battery <= 0) {
      rover.status = 'OUT_OF_BATTERY';
      events.push({
        type: 'ROVER_OUT_OF_BATTERY',
        roverId: rover.id,
        cell: { ...rover.cell },
        gameMinute: entryGameMinute,
      });
      break;
    }
  }

  return events;
}
