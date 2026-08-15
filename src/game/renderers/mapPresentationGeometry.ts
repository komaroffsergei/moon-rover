import { uniformInt } from 'pure-rand/distribution/uniformInt';

import type { GridCell, NavigationPoint } from '../../domain';
import { createSeededRandom } from '../../shared/random/seededRandom';

export interface MapPresentationPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapPresentationSegment {
  readonly from: MapPresentationPoint;
  readonly to: MapPresentationPoint;
}

export interface TilePresentationMetrics {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

interface RoverHudInput {
  readonly kind: 'courier' | 'repair';
  readonly battery: number;
  readonly batteryCapacity: number;
  readonly cargo: Readonly<{
    oxygen: number;
    food: number;
    equipment: number;
  }>;
  readonly cargoCapacity: number;
}

export interface RoverHudPresentation {
  readonly batteryRatio: number;
  readonly cargoRatios: readonly [number, number, number] | null;
}

interface GridVertex {
  readonly column: number;
  readonly row: number;
}

interface BoundaryEdge {
  readonly start: GridVertex;
  readonly end: GridVertex;
}

const JITTER_PRECISION = 1_000;
const FULL_TURN = Math.PI * 2;

function capacityRatio(value: number, capacity: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(capacity) || capacity <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / capacity));
}

export function createRoverHudPresentation(
  rover: RoverHudInput,
): RoverHudPresentation {
  return {
    batteryRatio: capacityRatio(rover.battery, rover.batteryCapacity),
    cargoRatios:
      rover.kind === 'courier'
        ? [
            capacityRatio(rover.cargo.oxygen, rover.cargoCapacity),
            capacityRatio(rover.cargo.food, rover.cargoCapacity),
            capacityRatio(rover.cargo.equipment, rover.cargoCapacity),
          ]
        : null,
  };
}

export function createRoverGroupOffset(
  index: number,
  count: number,
): MapPresentationPoint {
  if (count <= 1 || index < 0 || index >= count) return { x: 0, y: 0 };
  const radius = count <= 3 ? 22 : count <= 6 ? 34 : 40;
  const angle = -Math.PI / 2 + (index / count) * FULL_TURN;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function createPolygonHatchSegments(
  points: readonly MapPresentationPoint[],
  spacing: number,
): readonly MapPresentationSegment[] {
  if (points.length < 3 || !Number.isFinite(spacing) || spacing <= 0) {
    return [];
  }
  const diagonals = points.map(({ x, y }) => x + y);
  const minimum = Math.min(...diagonals);
  const maximum = Math.max(...diagonals);
  const first = Math.ceil(minimum / spacing) * spacing;
  const segments: MapPresentationSegment[] = [];

  for (let diagonal = first; diagonal < maximum; diagonal += spacing) {
    const intersections: MapPresentationPoint[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!;
      const end = points[(index + 1) % points.length]!;
      const startDiagonal = start.x + start.y;
      const endDiagonal = end.x + end.y;
      const crosses =
        (startDiagonal <= diagonal && endDiagonal > diagonal) ||
        (endDiagonal <= diagonal && startDiagonal > diagonal);
      if (!crosses) continue;
      const ratio = (diagonal - startDiagonal) / (endDiagonal - startDiagonal);
      intersections.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      });
    }
    intersections.sort((left, right) => left.x - right.x || right.y - left.y);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      segments.push({
        from: intersections[index]!,
        to: intersections[index + 1]!,
      });
    }
  }
  return segments;
}

function vertexKey(vertex: GridVertex): string {
  return `${vertex.column}:${vertex.row}`;
}

function normalizedCells(cells: readonly GridCell[]): readonly GridCell[] {
  const unique = new Map(
    cells.map((cell) => [`${cell.column}:${cell.row}`, cell] as const),
  );
  return [...unique.values()].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );
}

function traceBoundaryLoops(
  cells: readonly GridCell[],
): readonly (readonly GridVertex[])[] {
  const normalized = normalizedCells(cells);
  const occupied = new Set(
    normalized.map((cell) => `${cell.column}:${cell.row}`),
  );
  const edges: BoundaryEdge[] = [];
  for (const cell of normalized) {
    const { column, row } = cell;
    if (!occupied.has(`${column}:${row - 1}`)) {
      edges.push({
        start: { column, row },
        end: { column: column + 1, row },
      });
    }
    if (!occupied.has(`${column + 1}:${row}`)) {
      edges.push({
        start: { column: column + 1, row },
        end: { column: column + 1, row: row + 1 },
      });
    }
    if (!occupied.has(`${column}:${row + 1}`)) {
      edges.push({
        start: { column: column + 1, row: row + 1 },
        end: { column, row: row + 1 },
      });
    }
    if (!occupied.has(`${column - 1}:${row}`)) {
      edges.push({
        start: { column, row: row + 1 },
        end: { column, row },
      });
    }
  }

  const edgeIndexesByStart = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = vertexKey(edge.start);
    edgeIndexesByStart.set(key, [
      ...(edgeIndexesByStart.get(key) ?? []),
      index,
    ]);
  });

  const unusedIndexes = new Set(edges.map((_edge, index) => index));
  const loops: GridVertex[][] = [];
  while (unusedIndexes.size > 0) {
    const firstIndex = unusedIndexes.values().next().value as number;
    const firstEdge = edges[firstIndex]!;
    const loop: GridVertex[] = [firstEdge.start];
    unusedIndexes.delete(firstIndex);
    let edge = firstEdge;

    while (vertexKey(edge.end) !== vertexKey(firstEdge.start)) {
      loop.push(edge.end);
      const nextIndex = edgeIndexesByStart
        .get(vertexKey(edge.end))
        ?.find((candidate) => unusedIndexes.has(candidate));
      if (nextIndex === undefined) break;
      unusedIndexes.delete(nextIndex);
      edge = edges[nextIndex]!;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

function smoothClosedLoop(
  points: readonly MapPresentationPoint[],
): readonly MapPresentationPoint[] {
  const result: MapPresentationPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const following = points[(index + 1) % points.length]!;
    result.push({
      x: current.x * 0.75 + following.x * 0.25,
      y: current.y * 0.75 + following.y * 0.25,
    });
    result.push({
      x: current.x * 0.25 + following.x * 0.75,
      y: current.y * 0.25 + following.y * 0.75,
    });
  }
  return result;
}

function randomUnit(random: ReturnType<typeof createSeededRandom>): number {
  return uniformInt(random, 0, JITTER_PRECISION) / JITTER_PRECISION;
}

function signedArea(points: readonly MapPresentationPoint[]): number {
  return points.reduce((area, point, index) => {
    const following = points[(index + 1) % points.length]!;
    return area + point.x * following.y - following.x * point.y;
  }, 0);
}

function displaceAlongOrganicNormals(
  points: readonly MapPresentationPoint[],
  cellSize: number,
  random: ReturnType<typeof createSeededRandom>,
): readonly MapPresentationPoint[] {
  const clockwiseOnScreen = signedArea(points) > 0;
  const broadPhase = randomUnit(random) * FULL_TURN;
  const detailPhase = randomUnit(random) * FULL_TURN;

  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const following = points[(index + 1) % points.length]!;
    const tangentX = following.x - previous.x;
    const tangentY = following.y - previous.y;
    const tangentLength = Math.hypot(tangentX, tangentY) || 1;
    const normalX = clockwiseOnScreen
      ? tangentY / tangentLength
      : -tangentY / tangentLength;
    const normalY = clockwiseOnScreen
      ? -tangentX / tangentLength
      : tangentX / tangentLength;
    const turn = index / points.length;
    const coherentOffset =
      0.08 +
      Math.sin(FULL_TURN * 2 * turn + broadPhase) * 0.36 +
      Math.sin(FULL_TURN * 5 * turn + detailPhase) * 0.2 +
      (randomUnit(random) - 0.5) * 0.12;
    return {
      x: point.x + normalX * coherentOffset * cellSize,
      y: point.y + normalY * coherentOffset * cellSize,
    };
  });
}

export function createOrganicZoneContours(
  cells: readonly GridCell[],
  metrics: TilePresentationMetrics,
  visualSeed: string,
): readonly (readonly MapPresentationPoint[])[] {
  const random = createSeededRandom(
    'map-presentation-organic-contour-v1',
    visualSeed,
  );
  const cellSize = Math.min(metrics.tileWidth, metrics.tileHeight);

  return traceBoundaryLoops(cells).map((loop) => {
    const rounded = smoothClosedLoop(
      loop.map((vertex) => ({
        x: vertex.column * metrics.tileWidth,
        y: vertex.row * metrics.tileHeight,
      })),
    );
    const irregular = displaceAlongOrganicNormals(rounded, cellSize, random);
    return smoothClosedLoop(irregular);
  });
}

function navigationPointPosition(
  point: NavigationPoint,
  metrics: TilePresentationMetrics,
): MapPresentationPoint {
  return {
    x: (point.column + 0.5) * metrics.tileWidth,
    y: (point.row + 0.5) * metrics.tileHeight,
  };
}

function pointToward(
  from: MapPresentationPoint,
  to: MapPresentationPoint,
  distance: number,
): MapPresentationPoint {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return { ...from };
  const ratio = Math.min(1, distance / length);
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
  };
}

export function createRoundedRoutePoints(
  routePoints: readonly NavigationPoint[],
  metrics: TilePresentationMetrics,
): readonly MapPresentationPoint[] {
  const centers = routePoints.map((point) =>
    navigationPointPosition(point, metrics),
  );
  if (centers.length <= 2) return centers;

  const points: MapPresentationPoint[] = [centers[0]!];
  const radius = Math.min(metrics.tileWidth, metrics.tileHeight) * 0.25;
  for (let index = 1; index < centers.length - 1; index += 1) {
    const previous = centers[index - 1]!;
    const corner = centers[index]!;
    const next = centers[index + 1]!;
    const entry = pointToward(corner, previous, radius);
    const exit = pointToward(corner, next, radius);
    points.push(entry);
    for (let sample = 1; sample <= 5; sample += 1) {
      const t = sample / 5;
      const inverse = 1 - t;
      points.push({
        x:
          inverse * inverse * entry.x +
          2 * inverse * t * corner.x +
          t * t * exit.x,
        y:
          inverse * inverse * entry.y +
          2 * inverse * t * corner.y +
          t * t * exit.y,
      });
    }
  }
  points.push(centers.at(-1)!);
  return points;
}
