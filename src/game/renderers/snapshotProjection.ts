import type { NavigationPoint, RoverSnapshot } from '../../domain';
import {
  cellCenter,
  navigationPointWorldPosition,
  type TileMetrics,
  type WorldPoint,
} from '../input/mapGeometry';

type RoverPositionSnapshot = Pick<RoverSnapshot, 'cell' | 'movement'> & {
  readonly position?: NavigationPoint;
};

function normalizedProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function roverWorldPosition(
  rover: RoverPositionSnapshot,
  metrics: TileMetrics,
): WorldPoint {
  if (rover.position !== undefined) {
    return navigationPointWorldPosition(rover.position, metrics);
  }
  if (rover.movement === null) {
    return cellCenter(rover.cell, metrics);
  }

  const from = cellCenter(rover.movement.from, metrics);
  const to = cellCenter(rover.movement.to, metrics);
  const progress = normalizedProgress(rover.movement.progress);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}
