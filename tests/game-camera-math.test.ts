import { describe, expect, it } from 'vitest';

import {
  clampCameraState,
  containFitZoom,
  resizeCameraPreservingCenter,
  zoomAtPointer,
  type CameraConstraints,
  type CameraState,
} from '../src/game/camera/cameraMath';

const constraints: CameraConstraints = {
  viewport: { width: 500, height: 500 },
  world: { x: 0, y: 0, width: 1_000, height: 1_000 },
  zoom: { min: 0.5, max: 4 },
};

function worldUnderPointer(
  state: CameraState,
  pointer: { x: number; y: number },
  viewport: { width: number; height: number },
) {
  return {
    x: state.center.x + (pointer.x - viewport.width / 2) / state.zoom,
    y: state.center.y + (pointer.y - viewport.height / 2) / state.zoom,
  };
}

describe('camera math', () => {
  it('calculates a contain-fit zoom for both limiting axes', () => {
    expect(
      containFitZoom(
        { width: 800, height: 600 },
        { width: 1_024, height: 512 },
      ),
    ).toBeCloseTo(0.78125);
    expect(
      containFitZoom(
        { width: 800, height: 600 },
        { width: 400, height: 1_200 },
      ),
    ).toBeCloseTo(0.5);
  });

  it('rejects invalid viewport and world sizes', () => {
    expect(() =>
      containFitZoom(
        { width: 0, height: 600 },
        { width: 1_000, height: 1_000 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      containFitZoom(
        { width: 800, height: 600 },
        { width: Number.NaN, height: 1_000 },
      ),
    ).toThrow(RangeError);
  });

  it('clamps zoom and center to the visible world rectangle', () => {
    expect(
      clampCameraState(
        { center: { x: -100, y: 2_000 }, zoom: 10 },
        constraints,
      ),
    ).toEqual({
      center: { x: 62.5, y: 937.5 },
      zoom: 4,
    });
  });

  it('locks an axis to world center when the viewport is larger', () => {
    expect(
      clampCameraState(
        { center: { x: 800, y: 400 }, zoom: 0.5 },
        {
          viewport: { width: 800, height: 600 },
          world: { x: 100, y: 200, width: 1_000, height: 500 },
          zoom: { min: 0.5, max: 2 },
        },
      ),
    ).toEqual({
      center: { x: 600, y: 450 },
      zoom: 0.5,
    });
  });

  it('keeps the same world point under the pointer while zooming', () => {
    const state: CameraState = { center: { x: 500, y: 500 }, zoom: 1 };
    const pointer = { x: 400, y: 100 };
    const before = worldUnderPointer(state, pointer, constraints.viewport);
    const afterState = zoomAtPointer(state, pointer, 2, constraints);
    const after = worldUnderPointer(afterState, pointer, constraints.viewport);

    expect(afterState).toEqual({
      center: { x: 575, y: 425 },
      zoom: 2,
    });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps requested pointer zoom and the resulting center', () => {
    expect(
      zoomAtPointer(
        { center: { x: 125, y: 125 }, zoom: 2 },
        { x: 0, y: 0 },
        100,
        constraints,
      ),
    ).toEqual({
      center: { x: 62.5, y: 62.5 },
      zoom: 4,
    });
  });

  it('preserves the world center on resize when it remains valid', () => {
    const state: CameraState = { center: { x: 700, y: 600 }, zoom: 2 };
    expect(
      resizeCameraPreservingCenter(state, {
        ...constraints,
        viewport: { width: 600, height: 400 },
      }),
    ).toEqual(state);
  });

  it('preserves first, then clamps zoom and center for a larger viewport', () => {
    const fitZoom = containFitZoom(
      { width: 1_600, height: 900 },
      { width: 1_000, height: 500 },
    );
    expect(
      resizeCameraPreservingCenter(
        { center: { x: 900, y: 450 }, zoom: 1 },
        {
          viewport: { width: 1_600, height: 900 },
          world: { x: 0, y: 0, width: 1_000, height: 500 },
          zoom: { min: fitZoom, max: 4 },
        },
      ),
    ).toEqual({
      center: { x: 500, y: 250 },
      zoom: 1.6,
    });
  });

  it('rejects non-finite camera and pointer values', () => {
    expect(() =>
      clampCameraState(
        { center: { x: Number.NaN, y: 0 }, zoom: 1 },
        constraints,
      ),
    ).toThrow(RangeError);
    expect(() =>
      zoomAtPointer(
        { center: { x: 500, y: 500 }, zoom: 1 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        2,
        constraints,
      ),
    ).toThrow(RangeError);
  });
});
