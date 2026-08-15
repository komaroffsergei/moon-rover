import type { GridCell, NavigationPoint } from '../../domain';

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

export interface TileMetrics {
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export interface MapGridMetrics extends TileMetrics {
  readonly columns: number;
  readonly rows: number;
}

function hasPositiveFiniteTiles(metrics: TileMetrics): boolean {
  return (
    Number.isFinite(metrics.tileWidth) &&
    metrics.tileWidth > 0 &&
    Number.isFinite(metrics.tileHeight) &&
    metrics.tileHeight > 0
  );
}

function hasValidGrid(metrics: MapGridMetrics): boolean {
  return (
    hasPositiveFiniteTiles(metrics) &&
    Number.isInteger(metrics.columns) &&
    metrics.columns > 0 &&
    Number.isInteger(metrics.rows) &&
    metrics.rows > 0
  );
}

export function worldToGridCell(
  point: WorldPoint,
  metrics: MapGridMetrics,
): GridCell | null {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !hasValidGrid(metrics)
  ) {
    return null;
  }

  const pixelWidth = metrics.columns * metrics.tileWidth;
  const pixelHeight = metrics.rows * metrics.tileHeight;
  if (
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(pixelHeight) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= pixelWidth ||
    point.y >= pixelHeight
  ) {
    return null;
  }

  return {
    column: Math.floor(point.x / metrics.tileWidth),
    row: Math.floor(point.y / metrics.tileHeight),
  };
}

export function cellCenter(cell: GridCell, metrics: TileMetrics): WorldPoint {
  if (!hasPositiveFiniteTiles(metrics)) {
    throw new RangeError('Размер клетки должен быть положительным и конечным');
  }
  if (
    !Number.isInteger(cell.column) ||
    cell.column < 0 ||
    !Number.isInteger(cell.row) ||
    cell.row < 0
  ) {
    throw new RangeError(
      'GridCell должен содержать неотрицательные целые числа',
    );
  }

  const center = {
    x: (cell.column + 0.5) * metrics.tileWidth,
    y: (cell.row + 0.5) * metrics.tileHeight,
  };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    throw new RangeError('Центр GridCell должен иметь конечные координаты');
  }
  return center;
}

export function navigationPointWorldPosition(
  point: NavigationPoint,
  metrics: TileMetrics,
): WorldPoint {
  if (!hasPositiveFiniteTiles(metrics)) {
    throw new RangeError('Размер клетки должен быть положительным и конечным');
  }
  if (!Number.isFinite(point.column) || !Number.isFinite(point.row)) {
    throw new RangeError(
      'NavigationPoint должен содержать конечные координаты',
    );
  }
  return {
    x: (point.column + 0.5) * metrics.tileWidth,
    y: (point.row + 0.5) * metrics.tileHeight,
  };
}
