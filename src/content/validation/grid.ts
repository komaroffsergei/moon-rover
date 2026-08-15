import { hasGridLineOfSight } from '../../shared/navigation/traceGridSegment';

export interface GridPosition {
  column: number;
  row: number;
}

export interface LogicalGrid {
  readonly width: number;
  readonly height: number;
  readonly blocked: ReadonlyArray<boolean>;
  readonly hazardous: ReadonlyArray<boolean>;
}

export function gridIndex(grid: LogicalGrid, position: GridPosition): number {
  return position.row * grid.width + position.column;
}

export function isInsideGrid(
  grid: Pick<LogicalGrid, 'width' | 'height'>,
  position: GridPosition,
): boolean {
  return (
    position.column >= 0 &&
    position.column < grid.width &&
    position.row >= 0 &&
    position.row < grid.height
  );
}

function neighbors(grid: LogicalGrid, position: GridPosition): GridPosition[] {
  return [
    { column: position.column + 1, row: position.row },
    { column: position.column - 1, row: position.row },
    { column: position.column, row: position.row + 1 },
    { column: position.column, row: position.row - 1 },
  ].filter((candidate) => isInsideGrid(grid, candidate));
}

/** Cardinal BFS retained for the authored D007 safe/short balance contract. */
export function distancesFrom(
  grid: LogicalGrid,
  start: GridPosition,
  avoidHazards = false,
): ReadonlyArray<number | undefined> {
  const distances: Array<number | undefined> = Array(
    grid.width * grid.height,
  ).fill(undefined);
  const startIndex = gridIndex(grid, start);

  if (
    !isInsideGrid(grid, start) ||
    grid.blocked[startIndex] === true ||
    (avoidHazards && grid.hazardous[startIndex] === true)
  ) {
    return distances;
  }

  distances[startIndex] = 0;
  const queue: GridPosition[] = [start];
  let cursor = 0;

  while (cursor < queue.length) {
    const position = queue[cursor++];
    if (position === undefined) break;
    const distance = distances[gridIndex(grid, position)];
    if (distance === undefined) continue;

    for (const neighbor of neighbors(grid, position)) {
      const index = gridIndex(grid, neighbor);
      if (
        distances[index] !== undefined ||
        grid.blocked[index] === true ||
        (avoidHazards && grid.hazardous[index] === true)
      ) {
        continue;
      }

      distances[index] = distance + 1;
      queue.push(neighbor);
    }
  }

  return distances;
}

interface NavigationEdge {
  readonly to: number;
  readonly distance: number;
}

interface NavigationGraph {
  readonly allowed: ReadonlyArray<boolean>;
  readonly allowedIndices: ReadonlyArray<number>;
  readonly edges: ReadonlyArray<ReadonlyArray<NavigationEdge>>;
  readonly distancesByStart: Map<number, ReadonlyArray<number | undefined>>;
}

interface NavigationGraphVariants {
  withHazards?: NavigationGraph;
  withoutHazards?: NavigationGraph;
}

const navigationGraphs = new WeakMap<LogicalGrid, NavigationGraphVariants>();

function createNavigationGraph(
  grid: LogicalGrid,
  avoidHazards: boolean,
): NavigationGraph {
  const cellCount = grid.width * grid.height;
  const isAllowedIndex = (index: number) =>
    grid.blocked[index] !== true &&
    (!avoidHazards || grid.hazardous[index] !== true);
  const positions: GridPosition[] = Array.from(
    { length: cellCount },
    (_, index) => ({
      column: index % grid.width,
      row: Math.floor(index / grid.width),
    }),
  );
  const allowed = positions.map((_, index) => isAllowedIndex(index));
  const allowedIndices = positions
    .map((_, index) => index)
    .filter(isAllowedIndex);
  const edges: NavigationEdge[][] = Array.from({ length: cellCount }, () => []);

  for (
    let leftOffset = 0;
    leftOffset < allowedIndices.length;
    leftOffset += 1
  ) {
    const leftIndex = allowedIndices[leftOffset]!;
    const left = positions[leftIndex]!;
    for (
      let rightOffset = leftOffset + 1;
      rightOffset < allowedIndices.length;
      rightOffset += 1
    ) {
      const rightIndex = allowedIndices[rightOffset]!;
      const right = positions[rightIndex]!;
      if (
        !hasGridLineOfSight(
          left,
          right,
          grid,
          (column, row) => allowed[row * grid.width + column] === true,
        )
      ) {
        continue;
      }
      const distance = Math.hypot(
        right.column - left.column,
        right.row - left.row,
      );
      edges[leftIndex]!.push({ to: rightIndex, distance });
      edges[rightIndex]!.push({ to: leftIndex, distance });
    }
  }

  return {
    allowed,
    allowedIndices,
    edges,
    distancesByStart: new Map(),
  };
}

function navigationGraph(
  grid: LogicalGrid,
  avoidHazards: boolean,
): NavigationGraph {
  let variants = navigationGraphs.get(grid);
  if (variants === undefined) {
    variants = {};
    navigationGraphs.set(grid, variants);
  }
  const cached = avoidHazards ? variants.withoutHazards : variants.withHazards;
  if (cached !== undefined) return cached;

  const created = createNavigationGraph(grid, avoidHazards);
  if (avoidHazards) variants.withoutHazards = created;
  else variants.withHazards = created;
  return created;
}

/**
 * Евклидовы кратчайшие расстояния считаются по тому же консервативному графу
 * видимости, что и свободная runtime-навигация. Касание угла нулевой длины не
 * позволяет обойти blocked или исключённую hazard-клетку. Граф кэшируется:
 * Значение LogicalGrid неизменяемо, а несколько authoring-баз используют его
 * повторно.
 */
export function navigationDistancesFrom(
  grid: LogicalGrid,
  start: GridPosition,
  avoidHazards = false,
): ReadonlyArray<number | undefined> {
  const cellCount = grid.width * grid.height;
  const empty = (): Array<number | undefined> =>
    Array<number | undefined>(cellCount).fill(undefined);
  if (!isInsideGrid(grid, start)) return empty();

  const graph = navigationGraph(grid, avoidHazards);
  const startIndex = gridIndex(grid, start);
  if (graph.allowed[startIndex] !== true) return empty();
  const cached = graph.distancesByStart.get(startIndex);
  if (cached !== undefined) return cached;

  const distances: Array<number | undefined> = empty();
  const visited = Array<boolean>(cellCount).fill(false);
  distances[startIndex] = 0;

  while (true) {
    let currentIndex = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const index of graph.allowedIndices) {
      const distance = distances[index];
      if (
        !visited[index] &&
        distance !== undefined &&
        distance < currentDistance
      ) {
        currentIndex = index;
        currentDistance = distance;
      }
    }
    if (currentIndex < 0) break;
    visited[currentIndex] = true;

    for (const edge of graph.edges[currentIndex]!) {
      if (visited[edge.to]) continue;
      const candidateDistance = currentDistance + edge.distance;
      const previousDistance = distances[edge.to];
      if (
        previousDistance === undefined ||
        candidateDistance < previousDistance
      ) {
        distances[edge.to] = candidateDistance;
      }
    }
  }

  const result = Object.freeze(distances);
  graph.distancesByStart.set(startIndex, result);
  return result;
}

interface FlowEdge {
  readonly to: number;
  readonly reverseIndex: number;
  capacity: number;
}

/** Counts internally vertex-disjoint walkable paths, capped for validation. */
export function safePathMultiplicity(
  grid: LogicalGrid,
  start: GridPosition,
  target: GridPosition,
  limit = 2,
): number {
  const cellCount = grid.width * grid.height;
  const allowed = (index: number) =>
    grid.blocked[index] !== true && grid.hazardous[index] !== true;
  const startIndex = gridIndex(grid, start);
  const targetIndex = gridIndex(grid, target);
  if (
    limit < 1 ||
    !isInsideGrid(grid, start) ||
    !isInsideGrid(grid, target) ||
    !allowed(startIndex) ||
    !allowed(targetIndex)
  ) {
    return 0;
  }
  if (startIndex === targetIndex) return 1;

  const graph: FlowEdge[][] = Array.from({ length: cellCount * 2 }, () => []);
  const addEdge = (from: number, to: number, capacity: number) => {
    const forward: FlowEdge = {
      to,
      reverseIndex: graph[to]!.length,
      capacity,
    };
    const reverse: FlowEdge = {
      to: from,
      reverseIndex: graph[from]!.length,
      capacity: 0,
    };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
  };

  for (let index = 0; index < cellCount; index += 1) {
    if (!allowed(index)) continue;
    const position = {
      column: index % grid.width,
      row: Math.floor(index / grid.width),
    };
    addEdge(
      index * 2,
      index * 2 + 1,
      index === startIndex || index === targetIndex ? limit : 1,
    );
    for (const neighbor of neighbors(grid, position)) {
      const neighborIndex = gridIndex(grid, neighbor);
      if (allowed(neighborIndex)) {
        // Ребро можно использовать только одним маршрутом: иначе единственный
        // прямой переход ошибочно считается несколькими независимыми путями.
        addEdge(index * 2 + 1, neighborIndex * 2, 1);
      }
    }
  }

  const source = startIndex * 2 + 1;
  const sink = targetIndex * 2;
  let flow = 0;
  while (flow < limit) {
    const parentNode = Array<number>(graph.length).fill(-1);
    const parentEdge = Array<number>(graph.length).fill(-1);
    const queue = [source];
    parentNode[source] = source;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      if (node === undefined || parentNode[sink] !== -1) break;
      graph[node]!.forEach((edge, edgeIndex) => {
        if (edge.capacity <= 0 || parentNode[edge.to] !== -1) return;
        parentNode[edge.to] = node;
        parentEdge[edge.to] = edgeIndex;
        queue.push(edge.to);
      });
    }
    if (parentNode[sink] === -1) break;

    let node = sink;
    while (node !== source) {
      const previous = parentNode[node];
      const edgeIndex = parentEdge[node];
      if (previous === undefined || previous < 0 || edgeIndex === undefined) {
        throw new Error('Некорректный residual path');
      }
      const edge = graph[previous]![edgeIndex];
      if (edge === undefined) throw new Error('Некорректный residual edge');
      edge.capacity -= 1;
      const reverse = graph[node]![edge.reverseIndex];
      if (reverse === undefined) throw new Error('Некорректный reverse edge');
      reverse.capacity += 1;
      node = previous;
    }
    flow += 1;
  }
  return flow;
}
