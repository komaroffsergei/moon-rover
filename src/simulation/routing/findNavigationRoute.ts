import type {
  GridCell,
  NavigationLeg,
  NavigationPoint,
  RouteCellTraversal,
  RoutingMap,
  WeightedRouteWeights,
} from '../../domain';
import { traceGridSegment } from '../../shared/navigation/traceGridSegment';

export type FindNavigationRouteErrorCode =
  'CELL_OUT_OF_BOUNDS' | 'CELL_NOT_WALKABLE' | 'ROUTE_UNREACHABLE';

export type FindNavigationRouteResult =
  | {
      readonly ok: true;
      readonly steps: readonly GridCell[];
      readonly legs: readonly NavigationLeg[];
      readonly totalWeight: number;
    }
  | { readonly ok: false; readonly code: FindNavigationRouteErrorCode };

interface NavigationNode {
  readonly point: NavigationPoint;
  readonly cell: GridCell;
}

interface WeightedLeg {
  readonly leg: NavigationLeg;
  readonly weight: number;
}

const WEIGHT_EPSILON = 1e-10;

function sameCell(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function samePoint(left: NavigationPoint, right: NavigationPoint): boolean {
  return (
    Math.abs(left.column - right.column) <= WEIGHT_EPSILON &&
    Math.abs(left.row - right.row) <= WEIGHT_EPSILON
  );
}

function copyCell(cell: GridCell): GridCell {
  return Object.freeze({ column: cell.column, row: cell.row });
}

function copyPoint(point: NavigationPoint): NavigationPoint {
  return Object.freeze({ column: point.column, row: point.row });
}

function isCellInBounds(cell: GridCell, map: RoutingMap): boolean {
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

function pointBelongsToCell(point: NavigationPoint, cell: GridCell): boolean {
  return (
    point.column >= cell.column - 0.5 - WEIGHT_EPSILON &&
    point.column <= cell.column + 0.5 + WEIGHT_EPSILON &&
    point.row >= cell.row - 0.5 - WEIGHT_EPSILON &&
    point.row <= cell.row + 0.5 + WEIGHT_EPSILON
  );
}

function validateInput(
  origin: NavigationPoint,
  originCell: GridCell,
  destination: GridCell,
  map: RoutingMap,
  weights: WeightedRouteWeights,
): FindNavigationRouteErrorCode | null {
  if (
    !Number.isInteger(map.width) ||
    map.width <= 0 ||
    !Number.isInteger(map.height) ||
    map.height <= 0 ||
    map.cells.length !== map.width * map.height
  ) {
    throw new RangeError('Routing map должен иметь размеры width × height');
  }
  if (
    !Number.isFinite(weights.movementCost) ||
    weights.movementCost <= 0 ||
    !Number.isFinite(weights.incidentRisk) ||
    weights.incidentRisk < 0
  ) {
    throw new RangeError('Веса маршрута должны быть конечными и допустимыми');
  }
  map.cells.forEach((cell, index) => {
    if (
      typeof cell.walkable !== 'boolean' ||
      !Number.isFinite(cell.movementCost) ||
      cell.movementCost <= 0 ||
      !Number.isFinite(cell.effectiveCellChance) ||
      cell.effectiveCellChance < 0 ||
      cell.effectiveCellChance > 1
    ) {
      throw new RangeError(`Некорректная routing cell ${index}`);
    }
  });
  if (
    !Number.isFinite(origin.column) ||
    !Number.isFinite(origin.row) ||
    !isCellInBounds(originCell, map) ||
    !isCellInBounds(destination, map) ||
    !pointBelongsToCell(origin, originCell)
  ) {
    return 'CELL_OUT_OF_BOUNDS';
  }
  if (
    map.cells[cellIndex(originCell, map)]?.walkable !== true ||
    map.cells[cellIndex(destination, map)]?.walkable !== true
  ) {
    return 'CELL_NOT_WALKABLE';
  }
  return null;
}

function createWeightedLeg(
  from: NavigationNode,
  to: NavigationNode,
  map: RoutingMap,
  weights: WeightedRouteWeights,
): WeightedLeg | null {
  const distance = Math.hypot(
    to.point.column - from.point.column,
    to.point.row - from.point.row,
  );
  if (distance <= WEIGHT_EPSILON) return null;

  const intersections = traceGridSegment(from.point, to.point, map);
  if (
    intersections.length === 0 ||
    intersections.some(({ cell }) => {
      const routingCell = map.cells[cell.row * map.width + cell.column];
      return routingCell?.walkable !== true;
    })
  ) {
    return null;
  }

  const traversals: RouteCellTraversal[] = [];
  let weight = 0;
  for (const intersection of intersections) {
    const cell = copyCell(intersection.cell);
    const touchesOnlyAtOrigin =
      intersection.endRatio <= WEIGHT_EPSILON && !sameCell(cell, from.cell);
    if (touchesOnlyAtOrigin) continue;
    const touchesOnlyAtCorner =
      intersection.distance <= WEIGHT_EPSILON &&
      !sameCell(cell, from.cell) &&
      !sameCell(cell, to.cell);
    if (touchesOnlyAtCorner) continue;

    const routingCell = map.cells[cellIndex(cell, map)]!;
    const entersCell = !sameCell(cell, from.cell);
    const traversal = Object.freeze({
      cell,
      distance: intersection.distance,
      startDistance: intersection.startRatio * distance,
      endDistance: intersection.endRatio * distance,
      entersCell,
    });
    traversals.push(traversal);
    weight +=
      traversal.distance * routingCell.movementCost * weights.movementCost;
    if (entersCell) {
      weight += routingCell.effectiveCellChance * weights.incidentRisk;
    }
  }

  return Object.freeze({
    leg: Object.freeze({
      from: copyPoint(from.point),
      to: copyPoint(to.point),
      distance,
      traversals: Object.freeze(traversals),
    }),
    weight,
  });
}

function success(
  steps: readonly GridCell[],
  legs: readonly NavigationLeg[],
  totalWeight: number,
): FindNavigationRouteResult {
  return Object.freeze({
    ok: true,
    steps: Object.freeze(steps.map(copyCell)),
    legs: Object.freeze(legs),
    totalWeight,
  });
}

/**
 * Ищет детерминированный visibility-маршрут по центрам walkable-клеток.
 * Первый узел — точная текущая позиция, поэтому reroute не меняет координату.
 */
export function findNavigationRoute(
  origin: NavigationPoint,
  originCell: GridCell,
  destination: GridCell,
  map: RoutingMap,
  weights: WeightedRouteWeights,
): FindNavigationRouteResult {
  const inputError = validateInput(
    origin,
    originCell,
    destination,
    map,
    weights,
  );
  if (inputError !== null)
    return Object.freeze({ ok: false, code: inputError });

  const destinationPoint = {
    column: destination.column,
    row: destination.row,
  };
  if (samePoint(origin, destinationPoint)) return success([], [], 0);

  const nodes: NavigationNode[] = [
    { point: copyPoint(origin), cell: copyCell(originCell) },
  ];
  let destinationNodeIndex = -1;
  for (let index = 0; index < map.cells.length; index += 1) {
    if (map.cells[index]?.walkable !== true) continue;
    const cell = {
      column: index % map.width,
      row: Math.floor(index / map.width),
    };
    if (samePoint(origin, cell)) {
      if (sameCell(cell, destination)) destinationNodeIndex = 0;
      continue;
    }
    nodes.push({ point: copyPoint(cell), cell: copyCell(cell) });
    if (sameCell(cell, destination)) destinationNodeIndex = nodes.length - 1;
  }
  if (destinationNodeIndex < 0) {
    return Object.freeze({ ok: false, code: 'ROUTE_UNREACHABLE' });
  }

  const distances = Array<number>(nodes.length).fill(Number.POSITIVE_INFINITY);
  const previous = Array<number>(nodes.length).fill(-1);
  const previousLeg = Array<NavigationLeg | null>(nodes.length).fill(null);
  const visited = Array<boolean>(nodes.length).fill(false);
  distances[0] = 0;

  while (true) {
    let currentIndex = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < nodes.length; index += 1) {
      const distance = distances[index]!;
      if (!visited[index] && distance < currentDistance - WEIGHT_EPSILON) {
        currentIndex = index;
        currentDistance = distance;
      }
    }
    if (currentIndex < 0 || currentIndex === destinationNodeIndex) break;
    visited[currentIndex] = true;

    for (
      let candidateIndex = 0;
      candidateIndex < nodes.length;
      candidateIndex += 1
    ) {
      if (candidateIndex === currentIndex || visited[candidateIndex]) continue;
      const weightedLeg = createWeightedLeg(
        nodes[currentIndex]!,
        nodes[candidateIndex]!,
        map,
        weights,
      );
      if (weightedLeg === null) continue;
      const candidateDistance = currentDistance + weightedLeg.weight;
      if (candidateDistance < distances[candidateIndex]! - WEIGHT_EPSILON) {
        distances[candidateIndex] = candidateDistance;
        previous[candidateIndex] = currentIndex;
        previousLeg[candidateIndex] = weightedLeg.leg;
      }
    }
  }

  if (!Number.isFinite(distances[destinationNodeIndex])) {
    return Object.freeze({ ok: false, code: 'ROUTE_UNREACHABLE' });
  }

  const reversedSteps: GridCell[] = [];
  const reversedLegs: NavigationLeg[] = [];
  let cursor = destinationNodeIndex;
  while (cursor !== 0) {
    const leg = previousLeg[cursor] ?? null;
    const node = nodes[cursor];
    const previousIndex = previous[cursor] ?? -1;
    if (leg === null || node === undefined || previousIndex < 0) {
      return Object.freeze({ ok: false, code: 'ROUTE_UNREACHABLE' });
    }
    reversedSteps.push(node.cell);
    reversedLegs.push(leg);
    cursor = previousIndex;
  }

  reversedSteps.reverse();
  reversedLegs.reverse();
  return success(reversedSteps, reversedLegs, distances[destinationNodeIndex]!);
}
