import type {
  MapGameController,
  MapGameView,
  MapSelectedEntity,
  MapSimulationPort,
} from '../game/mapGamePort';
import {
  forecastBatteryTransfer,
  projectRoverActionAvailability,
  type CenterDefinition,
  type GameSnapshot,
  type GridCell,
} from '../simulation';
import { createCenterUiMetrics } from './createDispatcherView';

export interface CreateMapGameControllerOptions {
  readonly simulation: MapSimulationPort;
  readonly baseCell: GridCell;
  readonly centerDefinitions?: readonly CenterDefinition[];
}

const VIEW_PUBLISH_INTERVAL_MILLISECONDS = 100;

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

export function createMapGameController(
  options: CreateMapGameControllerOptions,
): MapGameController {
  const simulation = options.simulation;
  const baseCell = copyCell(options.baseCell);
  const centerDefinitions = structuredClone(options.centerDefinitions ?? []);

  let selectedEntity: MapSelectedEntity | null = null;
  let focusRequestKey = 0;
  let focusRequest: MapGameView['focusRequest'] = null;
  let lastPublishedElapsedMilliseconds =
    simulation.getSnapshot().elapsedRealMilliseconds;
  let lastPublishedPhase = simulation.getSnapshot().phase;
  const listeners = new Set<(view: MapGameView) => void>();

  function getView(): MapGameView {
    const snapshot = simulation.getSnapshot();
    const centerMetrics = Object.freeze(
      snapshot.centers.flatMap((center) => {
        const definition = centerDefinitions.find(({ id }) => id === center.id);
        return definition ? [createCenterUiMetrics(center, definition)] : [];
      }),
    );

    return Object.freeze({
      snapshot,
      baseCell,
      selectedEntity,
      focusRequest,
      centerMetrics,
      roverActions: projectRoverActionAvailability(
        snapshot,
        baseCell,
        centerDefinitions,
      ),
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

      // ПКМ всегда посылает одну атомарную команду: simulation сама строит
      // маршрут от текущей дробной позиции и сохраняет старый при отказе.
      const result = simulation.dispatch({
        type: 'ROUTE_ROVER_TO',
        roverId: rover.id,
        destination: copyCell(destination),
      });
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
