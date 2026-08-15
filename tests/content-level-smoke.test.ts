import { describe, expect, it } from 'vitest';

import {
  createSimulationConfigFromContent,
  loadContentBundle,
  parseJsonText,
  selectFacilityPlacement,
} from '../src/content';
import {
  commonContentSources,
  runtimeLevelSources,
} from '../src/content/levels/catalog';
import type {
  Cargo,
  CenterDefinition,
  CenterSnapshot,
  DomainEvent,
  GridCell,
  SimulationConfig,
} from '../src/domain';
import { createSimulationEngine } from '../src/simulation';

const ADVANCE_MILLISECONDS = 500;
const MAX_SCHEDULER_ITERATIONS = 1_000;

interface CourierTrip {
  readonly centerId: string;
  readonly direction: 'OUTBOUND' | 'RETURNING';
}

function cellKey(cell: GridCell): string {
  return `${cell.column},${cell.row}`;
}

function sameCell(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function safePath(
  config: SimulationConfig,
  origin: GridCell,
  destination: GridCell,
): readonly GridCell[] {
  const queue: GridCell[] = [{ ...origin }];
  const previous = new Map<string, GridCell | null>([[cellKey(origin), null]]);
  const neighbors = [
    { column: 0, row: -1 },
    { column: 1, row: 0 },
    { column: 0, row: 1 },
    { column: -1, row: 0 },
  ] as const;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (sameCell(current, destination)) break;

    for (const offset of neighbors) {
      const candidate = {
        column: current.column + offset.column,
        row: current.row + offset.row,
      };
      if (
        candidate.column < 0 ||
        candidate.column >= config.routingMap.width ||
        candidate.row < 0 ||
        candidate.row >= config.routingMap.height ||
        previous.has(cellKey(candidate))
      ) {
        continue;
      }
      const routingCell =
        config.routingMap.cells[
          candidate.row * config.routingMap.width + candidate.column
        ];
      if (
        routingCell?.walkable !== true ||
        (routingCell.incidentProfileId !== 'normal' &&
          !sameCell(candidate, destination))
      ) {
        continue;
      }
      previous.set(cellKey(candidate), current);
      queue.push(candidate);
    }
  }

  if (!previous.has(cellKey(destination))) {
    throw new Error(
      `Нет безопасного пути ${cellKey(origin)} -> ${cellKey(destination)}`,
    );
  }

  const reversed: GridCell[] = [];
  let current: GridCell | null = destination;
  while (current !== null && !sameCell(current, origin)) {
    reversed.push({ ...current });
    current = previous.get(cellKey(current)) ?? null;
  }
  return reversed.reverse();
}

function requireCommand(
  label: string,
  result: ReturnType<ReturnType<typeof createSimulationEngine>['dispatch']>,
): void {
  if (!result.ok) {
    throw new Error(`${label}: команда отклонена (${result.code})`);
  }
}

function urgency(
  center: CenterSnapshot,
  equipmentDemandCenterIds: ReadonlySet<string>,
): number {
  const consumableDeficit =
    200 - center.resources.oxygen - center.resources.food;
  const equipmentDeficit = equipmentDemandCenterIds.has(center.id)
    ? (100 - center.resources.equipment) * 3
    : 0;
  const minimum = Math.min(
    center.resources.oxygen,
    center.resources.food,
    equipmentDemandCenterIds.has(center.id)
      ? center.resources.equipment
      : Number.POSITIVE_INFINITY,
  );
  const criticality = Math.max(0, 60 - minimum) * 12;
  return consumableDeficit + equipmentDeficit + criticality;
}

function cargoFor(
  capacity: number,
  center: CenterSnapshot,
  equipmentDemandEnabled: boolean,
  centerDefinition: CenterDefinition,
  config: SimulationConfig,
  currentGameMinute: number,
  travelGameMinutes: number,
): Cargo {
  const dueDemands = equipmentDemandEnabled
    ? equipmentDemandsDueBeforeArrival(
        config,
        currentGameMinute,
        currentGameMinute + travelGameMinutes,
      )
    : 0;
  const projected = {
    oxygen:
      center.resources.oxygen -
      (travelGameMinutes * centerDefinition.oxygen.capacity) /
        centerDefinition.oxygen.depletionGameMinutes,
    food:
      center.resources.food -
      (travelGameMinutes * centerDefinition.food.capacity) /
        centerDefinition.food.depletionGameMinutes,
    equipment: equipmentDemandEnabled
      ? center.resources.equipment - dueDemands * config.equipmentDemand.lossMax
      : 100,
  };

  if (equipmentDemandEnabled && projected.equipment <= 20) {
    return { oxygen: 0, food: 0, equipment: capacity };
  }

  const weights = {
    oxygen: Math.max(1, 100 - projected.oxygen),
    food: Math.max(1, 100 - projected.food),
    equipment: equipmentDemandEnabled
      ? Math.max(1, 100 - projected.equipment)
      : 0,
  };
  for (const resource of ['oxygen', 'food', 'equipment'] as const) {
    if (projected[resource] <= 35) weights[resource] *= 3;
  }
  const totalWeight = weights.oxygen + weights.food + weights.equipment;
  const oxygen = Math.floor((capacity * weights.oxygen) / totalWeight);
  const food = Math.floor((capacity * weights.food) / totalWeight);
  if (!equipmentDemandEnabled) {
    return { oxygen, food: capacity - oxygen, equipment: 0 };
  }
  return {
    oxygen,
    food,
    equipment: capacity - oxygen - food,
  };
}

function equipmentDemandsDueBeforeArrival(
  config: SimulationConfig,
  currentGameMinute: number,
  arrivalGameMinute: number,
): number {
  let due = config.equipmentDemand.firstEligibleGameMinute;
  while (due <= currentGameMinute) {
    due += config.equipmentDemand.minimumIntervalGameMinutes;
  }
  let count = 0;
  while (due <= arrivalGameMinute) {
    count += 1;
    due += config.equipmentDemand.minimumIntervalGameMinutes;
  }
  return count;
}

function routeTravelGameMinutes(
  config: SimulationConfig,
  steps: readonly GridCell[],
  gameMinutesPerNormalCell: number,
): number {
  return steps.reduce((total, step) => {
    const cell =
      config.routingMap.cells[step.row * config.routingMap.width + step.column];
    if (cell === undefined) throw new Error('Клетка маршрута отсутствует');
    return total + cell.movementCost * gameMinutesPerNormalCell;
  }, 0);
}

function assertFiniteNumbers(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `${path} должен быть конечным, получено ${String(value)}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertFiniteNumbers(item, `${path}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteNumbers(item, `${path}.${key}`);
    }
  }
}

describe('production level winning smoke', () => {
  it.each(runtimeLevelSources)(
    'wins $id with its fixed seed and routes that only enter hazard at a center',
    (source) => {
      const bundle = loadContentBundle({
        ...commonContentSources,
        levelMeta: source.levelMeta,
        map: parseJsonText(source.mapText, source.mapFileName),
        theme: source.theme,
      });
      const config = createSimulationConfigFromContent(
        bundle,
        selectFacilityPlacement(bundle, 'content-smoke'),
      );
      const engine = createSimulationEngine(config);
      const equipmentDemandCenterIds = new Set(
        bundle.levelMeta.seededEquipmentDemandCenterIds,
      );
      const trips = new Map<string, CourierTrip>();
      const paths = new Map<string, readonly GridCell[]>();
      const allEvents: DomainEvent[] = [];
      const deliveredCenterIds = new Set<string>();
      const equipmentDeliveredCenterIds = new Set<string>();

      const routeBetween = (from: GridCell, to: GridCell) => {
        const key = `${cellKey(from)}>${cellKey(to)}`;
        const cached = paths.get(key);
        if (cached !== undefined) return cached;
        const route = safePath(config, from, to);
        paths.set(key, route);
        return route;
      };

      const assignOutboundTrips = (): void => {
        const snapshot = engine.getSnapshot();
        const claimedCenterIds = new Set(
          [...trips.values()]
            .filter(({ direction }) => direction === 'OUTBOUND')
            .map(({ centerId }) => centerId),
        );

        for (const rover of snapshot.rovers) {
          if (rover.kind !== 'courier' || rover.status !== 'IDLE_AT_BASE') {
            continue;
          }
          trips.delete(rover.id);
          requireCommand(
            `Зарядить ${rover.id}`,
            engine.dispatch({ type: 'CHARGE_ROVER', roverId: rover.id }),
          );

          const currentCenters = engine.getSnapshot().centers;
          const currentGameMinute = engine.getSnapshot().elapsedGameMinutes;
          const unclaimed = currentCenters.filter(
            ({ id }) => !claimedCenterIds.has(id),
          );
          const candidates = unclaimed.length > 0 ? unclaimed : currentCenters;
          const target = candidates.toSorted((left, right) => {
            const serviceUrgency = (center: CenterSnapshot): number => {
              const definition = config.centers.find(
                ({ id }) => id === center.id,
              );
              if (definition === undefined) {
                throw new Error(`Нет config центра ${center.id}`);
              }
              const travelGameMinutes = routeTravelGameMinutes(
                config,
                routeBetween(config.baseCell, center.cell),
                rover.gameMinutesPerNormalCell,
              );
              const dueDemands = equipmentDemandCenterIds.has(center.id)
                ? equipmentDemandsDueBeforeArrival(
                    config,
                    currentGameMinute,
                    currentGameMinute + travelGameMinutes,
                  )
                : 0;
              const arrivalMinimum = Math.min(
                center.resources.oxygen -
                  (travelGameMinutes * definition.oxygen.capacity) /
                    definition.oxygen.depletionGameMinutes,
                center.resources.food -
                  (travelGameMinutes * definition.food.capacity) /
                    definition.food.depletionGameMinutes,
                equipmentDemandCenterIds.has(center.id)
                  ? center.resources.equipment -
                      dueDemands * config.equipmentDemand.lossMax
                  : Number.POSITIVE_INFINITY,
              );
              return (
                urgency(center, equipmentDemandCenterIds) +
                Math.max(0, 60 - arrivalMinimum) * 40
              );
            };
            return (
              serviceUrgency(right) - serviceUrgency(left) ||
              left.id.localeCompare(right.id)
            );
          })[0];
          if (target === undefined) throw new Error('Нет центра назначения');

          const targetDefinition = config.centers.find(
            ({ id }) => id === target.id,
          );
          if (targetDefinition === undefined) {
            throw new Error(`Нет config центра ${target.id}`);
          }
          const outboundSteps = routeBetween(config.baseCell, target.cell);
          const travelGameMinutes = routeTravelGameMinutes(
            config,
            outboundSteps,
            rover.gameMinutesPerNormalCell,
          );
          const cargo = cargoFor(
            rover.cargoCapacity,
            target,
            equipmentDemandCenterIds.has(target.id),
            targetDefinition,
            config,
            currentGameMinute,
            travelGameMinutes,
          );
          requireCommand(
            `Загрузить ${rover.id}`,
            engine.dispatch({
              type: 'SET_ROVER_CARGO',
              roverId: rover.id,
              cargo,
            }),
          );
          requireCommand(
            `Отправить ${rover.id} в ${target.id}`,
            engine.dispatch({
              type: 'ASSIGN_ROVER_ROUTE',
              roverId: rover.id,
              steps: outboundSteps,
              goal: { kind: 'CENTER', centerId: target.id },
            }),
          );
          trips.set(rover.id, {
            centerId: target.id,
            direction: 'OUTBOUND',
          });
          claimedCenterIds.add(target.id);
        }
      };

      const serviceArrivals = (): void => {
        const snapshot = engine.getSnapshot();
        for (const rover of snapshot.rovers) {
          const trip = trips.get(rover.id);
          if (
            rover.kind !== 'courier' ||
            rover.status !== 'IDLE_ON_MAP' ||
            trip?.direction !== 'OUTBOUND'
          ) {
            continue;
          }
          const center = snapshot.centers.find(
            ({ id }) => id === trip.centerId,
          );
          if (center === undefined || !sameCell(rover.cell, center.cell)) {
            throw new Error(`${rover.id} прибыл не в назначенный центр`);
          }

          const delivery = allEvents.findLast(
            (event) =>
              event.type === 'CARGO_DELIVERED' &&
              event.roverId === rover.id &&
              event.centerId === center.id,
          );
          if (delivery?.type === 'CARGO_DELIVERED') {
            deliveredCenterIds.add(center.id);
            if (delivery.delivered.equipment > 0) {
              equipmentDeliveredCenterIds.add(center.id);
            }
          }

          const residualUnload = engine.dispatch({
            type: 'UNLOAD_ROVER_CARGO',
            roverId: rover.id,
            centerId: center.id,
          });
          if (
            !residualUnload.ok &&
            !['CENTER_FULL', 'ROVER_CARGO_EMPTY'].includes(residualUnload.code)
          ) {
            throw new Error(
              `Разгрузить остаток ${rover.id} в ${center.id}: ${residualUnload.code}`,
            );
          }
          if (residualUnload.ok) {
            allEvents.push(...residualUnload.events);
            const residualDelivery = residualUnload.events.find(
              (event) => event.type === 'CARGO_DELIVERED',
            );
            if (residualDelivery?.type === 'CARGO_DELIVERED') {
              deliveredCenterIds.add(center.id);
              if (residualDelivery.delivered.equipment > 0) {
                equipmentDeliveredCenterIds.add(center.id);
              }
            }
          }

          requireCommand(
            `Вернуть ${rover.id} на базу`,
            engine.dispatch({
              type: 'ASSIGN_ROVER_ROUTE',
              roverId: rover.id,
              steps: routeBetween(center.cell, config.baseCell),
              goal: { kind: 'BASE' },
            }),
          );
          trips.set(rover.id, {
            centerId: center.id,
            direction: 'RETURNING',
          });
        }
      };

      requireCommand('START_SHIFT', engine.dispatch({ type: 'START_SHIFT' }));
      expect(engine.getSnapshot().phase).toBe('RUNNING');
      assignOutboundTrips();

      let iterations = 0;
      while (
        engine.getSnapshot().phase === 'RUNNING' &&
        iterations < MAX_SCHEDULER_ITERATIONS
      ) {
        iterations += 1;
        allEvents.push(...engine.advance(ADVANCE_MILLISECONDS));
        const snapshot = engine.getSnapshot();
        assertFiniteNumbers(snapshot);
        const lostCenter = snapshot.centers.find(
          ({ status }) => status === 'LOST',
        );
        if (lostCenter !== undefined) {
          throw new Error(
            `${source.id}: ${lostCenter.id} потерян на минуте ${snapshot.elapsedGameMinutes}; ` +
              `${JSON.stringify(lostCenter.resources)}; rovers=${JSON.stringify(
                snapshot.rovers.map(({ id, status, cell, activeIncident }) => ({
                  id,
                  status,
                  cell,
                  activeIncident,
                  trip: trips.get(id),
                })),
              )}; incidents=${JSON.stringify(
                allEvents.filter(({ type }) => type === 'INCIDENT_STARTED'),
              )}`,
          );
        }

        if (snapshot.phase === 'RUNNING') {
          serviceArrivals();
          assignOutboundTrips();
        }
      }

      const terminal = engine.getSnapshot();
      const firstDemandMinute = Math.min(
        ...allEvents.flatMap((event) =>
          event.type === 'EQUIPMENT_DEMAND' ? [event.gameMinute] : [],
        ),
      );
      const initialDemandCenterIds = new Set(
        allEvents.flatMap((event) =>
          event.type === 'EQUIPMENT_DEMAND' &&
          event.gameMinute === firstDemandMinute
            ? [event.centerId]
            : [],
        ),
      );

      expect(iterations).toBeLessThanOrEqual(MAX_SCHEDULER_ITERATIONS);
      expect(firstDemandMinute).toBe(
        config.equipmentDemand.firstEligibleGameMinute,
      );
      expect([...initialDemandCenterIds].toSorted()).toEqual(
        [...equipmentDemandCenterIds].toSorted(),
      );
      expect(initialDemandCenterIds.size).toBe(source.ordinal);
      expect([...deliveredCenterIds].toSorted()).toEqual(
        bundle.levelMeta.centers.map(({ id }) => id).toSorted(),
      );
      expect([...equipmentDeliveredCenterIds].toSorted()).toEqual(
        [...equipmentDemandCenterIds].toSorted(),
      );
      expect(allEvents.some(({ type }) => type === 'CENTER_LOST')).toBe(false);
      expect(terminal.centers.every(({ status }) => status !== 'LOST')).toBe(
        true,
      );
      if (terminal.phase !== 'VICTORY') {
        throw new Error(
          `${source.id}: terminal=${terminal.phase}; centers=${JSON.stringify(
            terminal.centers.map(({ id, status, resources }) => ({
              id,
              status,
              resources,
            })),
          )}`,
        );
      }
      expect(terminal.phase).toBe('VICTORY');
      expect(allEvents).toContainEqual(
        expect.objectContaining({ type: 'SHIFT_ENDED', outcome: 'VICTORY' }),
      );
      expect(terminal.elapsedRealMilliseconds).toBeLessThanOrEqual(
        config.time.shiftRealSeconds * 1_000,
      );
      assertFiniteNumbers(terminal);
    },
    30_000,
  );

  it('keeps monotonically tighter starting resources by ordinal', () => {
    const progression = runtimeLevelSources.map((source) => {
      const bundle = loadContentBundle({
        ...commonContentSources,
        levelMeta: source.levelMeta,
        map: parseJsonText(source.mapText, source.mapFileName),
        theme: source.theme,
      });
      return {
        minimumInitial: Math.min(
          ...bundle.levelMeta.centers.flatMap(({ oxygen, food }) => [
            oxygen.initial,
            food.initial,
          ]),
        ),
        minimumDepletionGameMinutes: Math.min(
          ...bundle.levelMeta.centers.flatMap(({ oxygen, food }) => [
            oxygen.depletionGameMinutes,
            food.depletionGameMinutes,
          ]),
        ),
      };
    });

    expect(progression).toEqual([
      { minimumInitial: 88, minimumDepletionGameMinutes: 450 },
      { minimumInitial: 84, minimumDepletionGameMinutes: 420 },
      { minimumInitial: 80, minimumDepletionGameMinutes: 390 },
      { minimumInitial: 76, minimumDepletionGameMinutes: 360 },
      { minimumInitial: 72, minimumDepletionGameMinutes: 360 },
    ]);
  });
});
