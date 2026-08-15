import type { WorldPoint } from '../input/mapGeometry';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface WorldBounds extends ViewportSize {
  readonly x: number;
  readonly y: number;
}

export interface ZoomRange {
  readonly min: number;
  readonly max: number;
}

export interface CameraState {
  readonly center: WorldPoint;
  readonly zoom: number;
}

export interface CameraConstraints {
  readonly viewport: ViewportSize;
  readonly world: WorldBounds;
  readonly zoom: ZoomRange;
}

function assertPositiveSize(label: string, size: ViewportSize): void {
  if (
    !Number.isFinite(size.width) ||
    size.width <= 0 ||
    !Number.isFinite(size.height) ||
    size.height <= 0
  ) {
    throw new RangeError(`${label} должен иметь положительный конечный размер`);
  }
}

function assertWorldBounds(bounds: WorldBounds): void {
  assertPositiveSize('World bounds', bounds);
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    throw new RangeError('Начало world bounds должно быть конечным');
  }
}

function assertZoomRange(range: ZoomRange): void {
  if (
    !Number.isFinite(range.min) ||
    range.min <= 0 ||
    !Number.isFinite(range.max) ||
    range.max < range.min
  ) {
    throw new RangeError('Диапазон zoom должен быть конечным и положительным');
  }
}

function assertCameraState(state: CameraState): void {
  if (
    !Number.isFinite(state.center.x) ||
    !Number.isFinite(state.center.y) ||
    !Number.isFinite(state.zoom)
  ) {
    throw new RangeError('Camera state должен содержать конечные значения');
  }
}

function assertConstraints(constraints: CameraConstraints): void {
  assertPositiveSize('Viewport', constraints.viewport);
  assertWorldBounds(constraints.world);
  assertZoomRange(constraints.zoom);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampCenterAxis(
  center: number,
  worldStart: number,
  worldSize: number,
  viewportSize: number,
  zoom: number,
): number {
  const visibleWorldSize = viewportSize / zoom;
  if (!Number.isFinite(visibleWorldSize) || visibleWorldSize >= worldSize) {
    return worldStart + worldSize / 2;
  }

  const halfVisibleWorldSize = visibleWorldSize / 2;
  return clamp(
    center,
    worldStart + halfVisibleWorldSize,
    worldStart + worldSize - halfVisibleWorldSize,
  );
}

export function containFitZoom(
  viewport: ViewportSize,
  world: ViewportSize,
): number {
  assertPositiveSize('Viewport', viewport);
  assertPositiveSize('World', world);

  const zoom = Math.min(
    viewport.width / world.width,
    viewport.height / world.height,
  );
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError('Contain-fit zoom должен быть положительным');
  }
  return zoom;
}

export function clampCameraState(
  state: CameraState,
  constraints: CameraConstraints,
): CameraState {
  assertCameraState(state);
  assertConstraints(constraints);

  const zoom = clamp(state.zoom, constraints.zoom.min, constraints.zoom.max);
  return {
    center: {
      x: clampCenterAxis(
        state.center.x,
        constraints.world.x,
        constraints.world.width,
        constraints.viewport.width,
        zoom,
      ),
      y: clampCenterAxis(
        state.center.y,
        constraints.world.y,
        constraints.world.height,
        constraints.viewport.height,
        zoom,
      ),
    },
    zoom,
  };
}

export function zoomAtPointer(
  state: CameraState,
  pointer: WorldPoint,
  requestedZoom: number,
  constraints: CameraConstraints,
): CameraState {
  if (
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y) ||
    !Number.isFinite(requestedZoom)
  ) {
    throw new RangeError('Pointer и requested zoom должны быть конечными');
  }

  const current = clampCameraState(state, constraints);
  const zoom = clamp(requestedZoom, constraints.zoom.min, constraints.zoom.max);
  const pointerOffsetX = pointer.x - constraints.viewport.width / 2;
  const pointerOffsetY = pointer.y - constraints.viewport.height / 2;
  const anchor = {
    x: current.center.x + pointerOffsetX / current.zoom,
    y: current.center.y + pointerOffsetY / current.zoom,
  };

  return clampCameraState(
    {
      center: {
        x: anchor.x - pointerOffsetX / zoom,
        y: anchor.y - pointerOffsetY / zoom,
      },
      zoom,
    },
    constraints,
  );
}

export function resizeCameraPreservingCenter(
  state: CameraState,
  nextConstraints: CameraConstraints,
): CameraState {
  return clampCameraState(
    {
      center: { ...state.center },
      zoom: state.zoom,
    },
    nextConstraints,
  );
}
