import type {
  MapGameController,
  MapGameView,
  MapSelectedEntity,
  MapSimulationPort,
} from '../game/mapGamePort';
import {
  appendRouteStep,
  candidateRouteCells,
  clearRouteDraft,
  createRouteDraft,
  forecastRoute,
  forecastBatteryTransfer,
  undoRouteStep,
  projectRoverActionAvailability,
  type GameSnapshot,
  type CenterDefinition,
  type GridCell,
  type RouteDraft,
  type RouteForecast,
  type RouteGoal,
  type RoutingMap,
  type RoverSnapshot,
} from '../simulation';
import { createCenterUiMetrics } from './createDispatcherView';

export interface CreateMapGameControllerOptions {
  readonly simulation: MapSimulationPort;
  readonly routingMap: RoutingMap;
  readonly baseCell: GridCell;
  readonly centerDefinitions?: readonly CenterDefinition[];
}

const NO_CANDIDATES: readonly GridCell[] = Object.freeze([]);
const VIEW_PUBLISH_INTERVAL_MILLISECONDS = 100;

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

function cellsEqual(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function cellsAreCardinalNeighbors(left: GridCell, right: GridCell): boolean {
  return (
    Math.abs(left.column - right.column) + Math.abs(left.row - right.row) === 1
  );
}

function routeGoalForDraft(
  draft: RouteDraft,
  snapshot: GameSnapshot,
  baseCell: GridCell,
  selectedRoverId: string,
): RouteGoal | null {
  const endpoint = draft.steps.at(-1);
  if (!endpoint) return null;
  if (cellsEqual(endpoint, baseCell)) return { kind: 'BASE' };

  const center = snapshot.centers.find(({ cell }) =>
    cellsEqual(cell, endpoint),
  );
  if (center) return { kind: 'CENTER', centerId: center.id };

  const rover = snapshot.rovers.find(
    ({ id, cell }) => id !== selectedRoverId && cellsEqual(cell, endpoint),
  );
  if (rover) return { kind: 'ROVER', roverId: rover.id };

  const adjacentRover = snapshot.rovers.find(
    ({ id, cell }) =>
      id !== selectedRoverId && cellsAreCardinalNeighbors(cell, endpoint),
  );
  return adjacentRover
    ? { kind: 'RESCUE_ADJACENT', roverId: adjacentRover.id }
    : null;
}

function copyForecast(forecast: RouteForecast): RouteForecast {
  return Object.freeze({ ...forecast });
}

export function createMapGameController(
  options: CreateMapGameControllerOptions,
): MapGameController {
  const simulation = options.simulation;
  const routingMap = structuredClone(options.routingMap);
  const baseCell = copyCell(options.baseCell);
  const centerDefinitions = structuredClone(options.centerDefinitions ?? []);

  let selectedEntity: MapSelectedEntity | null = null;
  let routingRoverId: string | null = null;
  let routeDraft: RouteDraft | null = null;
  let focusRequestKey = 0;
  let focusRequest: MapGameView['focusRequest'] = null;
  let lastPublishedElapsedMilliseconds =
    simulation.getSnapshot().elapsedRealMilliseconds;
  let lastPublishedPhase = simulation.getSnapshot().phase;
  const listeners = new Set<(view: MapGameView) => void>();

  function syncRoutingRover(snapshot: GameSnapshot): RoverSnapshot | null {
    if (routingRoverId === null) {
      routeDraft = null;
      return null;
    }

    const rover = snapshot.rovers.find(({ id }) => id === routingRoverId);
    if (!rover) {
      routingRoverId = null;
      routeDraft = null;
      return null;
    }

    if (routeDraft === null || !cellsEqual(routeDraft.origin, rover.cell)) {
      routeDraft = createRouteDraft(rover.cell);
    }

    return rover;
  }

  function getView(): MapGameView {
    const snapshot = simulation.getSnapshot();
    const rover = syncRoutingRover(snapshot);
    const draft = routeDraft;
    const centerMetrics = Object.freeze(
      snapshot.centers.flatMap((center) => {
        const definition = centerDefinitions.find(({ id }) => id === center.id);
        return definition ? [createCenterUiMetrics(center, definition)] : [];
      }),
    );
    const roverActions = projectRoverActionAvailability(
      snapshot,
      baseCell,
      centerDefinitions,
    );

    if (rover === null || draft === null) {
      return Object.freeze({
        snapshot,
        baseCell,
        selectedEntity,
        routingRoverId: null,
        focusRequest,
        centerMetrics,
        roverActions,
        routeDraft: null,
        candidateCells: NO_CANDIDATES,
        forecast: null,
        canDispatchRoute: false,
      });
    }

    const forecast = forecastRoute(draft, routingMap, {
      gameMinutesPerNormalCell: rover.gameMinutesPerNormalCell,
      batteryCostMultiplier: rover.batteryCostMultiplier,
      currentBattery: rover.battery,
    });

    return Object.freeze({
      snapshot,
      baseCell,
      selectedEntity,
      routingRoverId,
      focusRequest,
      centerMetrics,
      roverActions,
      routeDraft: draft,
      candidateCells: candidateRouteCells(draft, routingMap),
      forecast: copyForecast(forecast),
      canDispatchRoute:
        routeGoalForDraft(draft, snapshot, baseCell, rover.id) !== null,
    });
  }

  function publish(): void {
    if (listeners.size === 0) return;
    const view = getView();
    lastPublishedElapsedMilliseconds = view.snapshot.elapsedRealMilliseconds;
    lastPublishedPhase = view.snapshot.phase;
    for (const listener of listeners) listener(view);
  }

  function entityCell(
    entity: MapSelectedEntity,
    snapshot: GameSnapshot,
  ): GridCell | null {
    if (entity.kind === 'base') {
      return entity.id === 'base' ? baseCell : null;
    }
    const candidates =
      entity.kind === 'center' ? snapshot.centers : snapshot.rovers;
    return candidates.find(({ id }) => id === entity.id)?.cell ?? null;
  }

  function selectEntity(entity: MapSelectedEntity, focus: boolean): boolean {
    const cell = entityCell(entity, simulation.getSnapshot());
    if (cell === null) return false;
    selectedEntity = Object.freeze({ ...entity });
    if (focus) {
      focusRequestKey += 1;
      focusRequest = Object.freeze({
        key: focusRequestKey,
        entity: selectedEntity,
        cell: copyCell(cell),
      });
    }
    publish();
    return true;
  }

  function sendCommand(command: Parameters<MapSimulationPort['dispatch']>[0]) {
    const result = simulation.dispatch(command);
    publish();
    return result;
  }

  const controller: MapGameController = {
    getView,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(getView());
      return () => listeners.delete(listener);
    },
    start: () => sendCommand({ type: 'START_SHIFT' }),
    sendCommand,
    advance: (realMilliseconds) => {
      const events = simulation.advance(realMilliseconds);
      const snapshot = simulation.getSnapshot();
      if (
        snapshot.phase !== lastPublishedPhase ||
        events.length > 0 ||
        snapshot.elapsedRealMilliseconds - lastPublishedElapsedMilliseconds >=
          VIEW_PUBLISH_INTERVAL_MILLISECONDS
      ) {
        publish();
      }
      return events;
    },
    selectEntity: (entity) => selectEntity(entity, false),
    focusEntity: (entity) => selectEntity(entity, true),
    beginRoute: (roverId) => {
      const rover = simulation
        .getSnapshot()
        .rovers.find(({ id }) => id === roverId);
      if (!rover) return false;

      routingRoverId = rover.id;
      routeDraft = createRouteDraft(rover.cell);
      publish();
      return true;
    },
    cancelRoute: () => {
      routingRoverId = null;
      routeDraft = null;
      publish();
    },
    selectCell: (cell) => {
      const rover = syncRoutingRover(simulation.getSnapshot());
      if (rover === null || routeDraft === null) return false;

      const result = appendRouteStep(routeDraft, cell, routingMap);
      if (!result.ok) return false;

      routeDraft = result.draft;
      publish();
      return true;
    },
    undo: () => {
      syncRoutingRover(simulation.getSnapshot());
      if (routeDraft !== null) routeDraft = undoRouteStep(routeDraft);
      publish();
    },
    clear: () => {
      syncRoutingRover(simulation.getSnapshot());
      if (routeDraft !== null) routeDraft = clearRouteDraft(routeDraft);
      publish();
    },
    dispatchRoute: () => {
      const snapshot = simulation.getSnapshot();
      const rover = syncRoutingRover(snapshot);
      if (rover === null || routeDraft === null) {
        return { ok: false, code: 'ROVER_NOT_SELECTED' };
      }
      const goal = routeGoalForDraft(routeDraft, snapshot, baseCell, rover.id);
      if (goal === null) return { ok: false, code: 'ROUTE_GOAL_INVALID' };

      const result = simulation.dispatch({
        type: 'ASSIGN_ROVER_ROUTE',
        roverId: rover.id,
        steps: routeDraft.steps.map(copyCell),
        goal,
      });

      if (result.ok) {
        routingRoverId = null;
        routeDraft = null;
      }
      publish();
      return result;
    },
    routeSelectedRoverTo: (destination) => {
      const snapshot = simulation.getSnapshot();
      if (selectedEntity?.kind !== 'rover') {
        return { ok: false, code: 'ROVER_NOT_SELECTED' };
      }
      const selectedRoverId = selectedEntity.id;
      const rover = snapshot.rovers.find(({ id }) => id === selectedRoverId);
      if (rover === undefined) {
        return { ok: false, code: 'ROVER_NOT_SELECTED' };
      }

      const result = simulation.dispatch({
        type: 'ROUTE_ROVER_TO',
        roverId: rover.id,
        destination: copyCell(destination),
      });
      if (result.ok) {
        routingRoverId = null;
        routeDraft = null;
      }
      publish();
      return result;
    },
    previewBatteryTransfer: (donorRoverId, repairRoverId) => {
      const snapshot = simulation.getSnapshot();
      const donor = snapshot.rovers.find(({ id }) => id === donorRoverId);
      const repair = snapshot.rovers.find(({ id }) => id === repairRoverId);
      if (
        !donor ||
        !repair ||
        donor.kind !== 'courier' ||
        repair.kind !== 'repair'
      ) {
        return null;
      }
      return Object.freeze(
        forecastBatteryTransfer(donor.battery, repair.batteryCapacity),
      );
    },
  };

  return Object.freeze(controller);
}
