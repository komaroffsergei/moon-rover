export interface GridPointLike {
  readonly column: number;
  readonly row: number;
}

export interface GridDimensions {
  readonly width: number;
  readonly height: number;
}

export interface GridSegmentIntersection {
  readonly cell: GridPointLike;
  readonly startRatio: number;
  readonly endRatio: number;
  readonly distance: number;
}

const GEOMETRY_EPSILON = 1e-10;

function assertPoint(name: string, point: GridPointLike): void {
  if (!Number.isFinite(point.column) || !Number.isFinite(point.row)) {
    throw new RangeError(`${name} должен содержать конечные координаты`);
  }
}

function assertDimensions(dimensions: GridDimensions): void {
  if (
    !Number.isInteger(dimensions.width) ||
    dimensions.width <= 0 ||
    !Number.isInteger(dimensions.height) ||
    dimensions.height <= 0
  ) {
    throw new RangeError('Размеры сетки должны быть положительными целыми');
  }
}

function clipAxis(
  start: number,
  delta: number,
  minimum: number,
  maximum: number,
  currentStart: number,
  currentEnd: number,
): readonly [number, number] | null {
  if (Math.abs(delta) <= GEOMETRY_EPSILON) {
    return start < minimum - GEOMETRY_EPSILON ||
      start > maximum + GEOMETRY_EPSILON
      ? null
      : [currentStart, currentEnd];
  }

  const first = (minimum - start) / delta;
  const second = (maximum - start) / delta;
  const entry = Math.min(first, second);
  const exit = Math.max(first, second);
  const clippedStart = Math.max(currentStart, entry);
  const clippedEnd = Math.min(currentEnd, exit);
  return clippedStart > clippedEnd + GEOMETRY_EPSILON
    ? null
    : [clippedStart, clippedEnd];
}

/**
 * Возвращает консервативный supercover отрезка. Касание угла включает обе
 * соседние клетки с нулевой длиной, поэтому blocked-угол нельзя срезать.
 */
export function traceGridSegment(
  from: GridPointLike,
  to: GridPointLike,
  dimensions: GridDimensions,
): readonly GridSegmentIntersection[] {
  assertPoint('Начало отрезка', from);
  assertPoint('Конец отрезка', to);
  assertDimensions(dimensions);

  const deltaColumn = to.column - from.column;
  const deltaRow = to.row - from.row;
  const segmentDistance = Math.hypot(deltaColumn, deltaRow);
  const minimumColumn = Math.max(
    0,
    Math.ceil(Math.min(from.column, to.column) - 0.5 - GEOMETRY_EPSILON),
  );
  const maximumColumn = Math.min(
    dimensions.width - 1,
    Math.floor(Math.max(from.column, to.column) + 0.5 + GEOMETRY_EPSILON),
  );
  const minimumRow = Math.max(
    0,
    Math.ceil(Math.min(from.row, to.row) - 0.5 - GEOMETRY_EPSILON),
  );
  const maximumRow = Math.min(
    dimensions.height - 1,
    Math.floor(Math.max(from.row, to.row) + 0.5 + GEOMETRY_EPSILON),
  );
  const intersections: Array<GridSegmentIntersection & { index: number }> = [];

  for (let row = minimumRow; row <= maximumRow; row += 1) {
    for (let column = minimumColumn; column <= maximumColumn; column += 1) {
      let range: readonly [number, number] | null = [0, 1];
      range = clipAxis(
        from.column,
        deltaColumn,
        column - 0.5,
        column + 0.5,
        range[0],
        range[1],
      );
      if (range === null) continue;
      range = clipAxis(
        from.row,
        deltaRow,
        row - 0.5,
        row + 0.5,
        range[0],
        range[1],
      );
      if (range === null) continue;

      const startRatio = Math.min(1, Math.max(0, range[0]));
      const endRatio = Math.min(1, Math.max(0, range[1]));
      if (startRatio > endRatio + GEOMETRY_EPSILON) continue;
      intersections.push({
        cell: Object.freeze({ column, row }),
        startRatio,
        endRatio,
        distance: Math.max(0, endRatio - startRatio) * segmentDistance,
        index: row * dimensions.width + column,
      });
    }
  }

  intersections.sort(
    (left, right) =>
      left.startRatio - right.startRatio ||
      left.endRatio - right.endRatio ||
      left.index - right.index,
  );

  return Object.freeze(
    intersections.map((intersection) =>
      Object.freeze({
        cell: intersection.cell,
        startRatio: intersection.startRatio,
        endRatio: intersection.endRatio,
        distance: intersection.distance,
      }),
    ),
  );
}

export function hasGridLineOfSight(
  from: GridPointLike,
  to: GridPointLike,
  dimensions: GridDimensions,
  isWalkable: (column: number, row: number) => boolean,
): boolean {
  const intersections = traceGridSegment(from, to, dimensions);
  return (
    intersections.length > 0 &&
    intersections.every(({ cell }) => isWalkable(cell.column, cell.row))
  );
}
