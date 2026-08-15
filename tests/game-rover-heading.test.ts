import { describe, expect, it } from 'vitest';

import { rotateTowards } from '../src/game/roverHeading';

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number): number {
  return (radiansValue * 180) / Math.PI;
}

function angularDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

describe('rover heading', () => {
  it.each([
    { current: 175, target: -175, expected: 185 },
    { current: -175, target: 175, expected: -185 },
  ])(
    'snaps continuously from $current° to the equivalent $expected°',
    ({ current, target, expected }) => {
      const next = rotateTowards(
        radians(current),
        radians(target),
        radians(20),
      );

      expect(degrees(next)).toBeCloseTo(expected, 12);
      expect(angularDistance(next, radians(target))).toBeCloseTo(0, 12);
      expect(Math.abs(degrees(next) - current)).toBeCloseTo(10, 12);
    },
  );

  it.each([
    { current: 175, target: -175, expected: 178 },
    { current: -175, target: 175, expected: -178 },
  ])(
    'takes a bounded shortest step from $current° toward $target°',
    ({ current, target, expected }) => {
      const beforeDistance = angularDistance(radians(current), radians(target));
      const next = rotateTowards(radians(current), radians(target), radians(3));

      expect(degrees(next)).toBeCloseTo(expected, 12);
      expect(
        degrees(beforeDistance - angularDistance(next, radians(target))),
      ).toBeCloseTo(3, 12);
    },
  );

  it.each([
    { current: 175, target: -175, direction: 1, expected: 185 },
    { current: -175, target: 175, direction: -1, expected: -185 },
  ])(
    'converges from $current° to $target° over 10°, never 350°',
    ({ current: start, target, direction, expected }) => {
      let current = radians(start);
      let travelled = 0;
      const increments: number[] = [];

      for (
        let step = 0;
        step < 10 && angularDistance(current, radians(target)) > 1e-12;
        step += 1
      ) {
        const next = rotateTowards(current, radians(target), radians(3));
        const increment = next - current;
        increments.push(increment);
        travelled += Math.abs(increment);
        current = next;
      }

      expect(increments).toHaveLength(4);
      expect(
        increments.every(
          (increment) =>
            Math.sign(increment) === direction &&
            Math.abs(increment) <= radians(3) + 1e-12,
        ),
      ).toBe(true);
      expect(degrees(travelled)).toBeCloseTo(10, 12);
      expect(degrees(current)).toBeCloseTo(expected, 12);
      expect(angularDistance(current, radians(target))).toBeCloseTo(0, 12);
    },
  );
});
