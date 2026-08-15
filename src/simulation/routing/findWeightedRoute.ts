import type { GridCell, RoutingMap, WeightedRouteWeights } from '../../domain';

export type FindWeightedRouteErrorCode =
  'CELL_OUT_OF_BOUNDS' | 'CELL_NOT_WALKABLE' | 'ROUTE_UNREACHABLE';

export type FindWeightedRouteResult =
  | {
      readonly ok: true;
      readonly steps: readonly GridCell[];
      readonly totalWeight: number;
    }
  | { readonly ok: false; readonly code: FindWeightedRouteErrorCode };

const CARDINAL_OFFSETS = Object.freeze([
  Object.freeze({ column: 0, row: -1 }),
  Object.freeze({ column: 1, row: 0 }),
  Object.freeze({ column: 0, row: 1 }),
  Object.freeze({ column: -1, row: 0 }),
]);
const WEIGHT_EPSILON = 1e-12;

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

function isInBounds(cell: GridCell, map: RoutingMap): boolean {
  return (
    Number.isInteger(cell.column) &&
    Number.isInteger(cell.row) &&
    cell.column >= 0 &&
    cell.column < map.width &&
    cell.row >= 0 &&
    cell.row < map.height
  );
}

function cellIndex(cell: GridCell, map: RoutingMap): number {
  return cell.row * map.width + cell.column;
}

function cellFromIndex(index: number, map: RoutingMap): GridCell {
  return {
    column: index % map.width,
    row: Math.floor(index / map.width),
  };
}

function validateWeights(weights: WeightedRouteWeights): void {
  if (
    !Number.isFinite(weights.movementCost) ||
    weights.movementCost <= 0 ||
    !Number.isFinite(weights.incidentRisk) ||
    weights.incidentRisk < 0
  ) {
    throw new RangeError(
      'Вес движения должен быть положительным, а вес риска — неотрицательным конечным числом',
    );
  }
}

function entryWeight(
  map: RoutingMap,
  index: number,
  weights: WeightedRouteWeights,
): number {
  const cell = map.cells[index];
  if (
    cell === undefined ||
    !Number.isFinite(cell.movementCost) ||
    cell.movementCost <= 0 ||
    !Number.isFinite(cell.effectiveCellChance) ||
    cell.effectiveCellChance < 0 ||
    cell.effectiveCellChance > 1
  ) {
    throw new RangeError(`Некорректная routing cell ${index}`);
  }
  return (
    cell.movementCost * weights.movementCost +
    cell.effectiveCellChance * weights.incidentRisk
  );
}

function success(
  steps: readonly GridCell[],
  totalWeight: number,
): FindWeightedRouteResult {
  return Object.freeze({
    ok: true,
    steps: Object.freeze(steps.map(copyCell)),
    totalWeight,
  });
}

/**
 * Ищет минимальный cardinal-маршрут детерминированным Dijkstra. Стоимость входа
 * объединяет terrain и вероятность происшествия; origin исключён, поскольку
 * ровер уже находится в этой клетке.
 */
export function findWeightedRoute(
  origin: GridCell,
  destination: GridCell,
  map: RoutingMap,
  weights: WeightedRouteWeights,
): FindWeightedRouteResult {
  validateWeights(weights);
  if (!isInBounds(origin, map) || !isInBounds(destination, map)) {
    return Object.freeze({ ok: false, code: 'CELL_OUT_OF_BOUNDS' });
  }

  const originIndex = cellIndex(origin, map);
  const destinationIndex = cellIndex(destination, map);
  if (
    map.cells[originIndex]?.walkable !== true ||
    map.cells[destinationIndex]?.walkable !== true
  ) {
    return Object.freeze({ ok: false, code: 'CELL_NOT_WALKABLE' });
  }
  if (originIndex === destinationIndex) return success([], 0);

  const distances = Array<number>(map.cells.length).fill(
    Number.POSITIVE_INFINITY,
  );
  const previous = Array<number>(map.cells.length).fill(-1);
  const visited = Array<boolean>(map.cells.length).fill(false);
  distances[originIndex] = 0;

  while (true) {
    let currentIndex = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < distances.length; index += 1) {
      const distance = distances[index]!;
      if (!visited[index] && distance < currentDistance - WEIGHT_EPSILON) {
        currentIndex = index;
        currentDistance = distance;
      }
    }
    if (currentIndex < 0) break;
    if (currentIndex === destinationIndex) break;
    visited[currentIndex] = true;

    const current = cellFromIndex(currentIndex, map);
    for (const offset of CARDINAL_OFFSETS) {
      const candidate = {
        column: current.column + offset.column,
        row: current.row + offset.row,
      };
      if (!isInBounds(candidate, map)) continue;
      const candidateIndex = cellIndex(candidate, map);
      if (
        visited[candidateIndex] ||
        map.cells[candidateIndex]?.walkable !== true
      ) {
        continue;
      }
      const candidateDistance =
        currentDistance + entryWeight(map, candidateIndex, weights);
      if (candidateDistance < distances[candidateIndex]! - WEIGHT_EPSILON) {
        distances[candidateIndex] = candidateDistance;
        previous[candidateIndex] = currentIndex;
      }
    }
  }

  if (!Number.isFinite(distances[destinationIndex])) {
    return Object.freeze({ ok: false, code: 'ROUTE_UNREACHABLE' });
  }

  const reversed: GridCell[] = [];
  let cursor = destinationIndex;
  while (cursor !== originIndex) {
    reversed.push(cellFromIndex(cursor, map));
    cursor = previous[cursor]!;
    if (cursor < 0) {
      return Object.freeze({ ok: false, code: 'ROUTE_UNREACHABLE' });
    }
  }
  reversed.reverse();
  return success(reversed, distances[destinationIndex]!);
}
