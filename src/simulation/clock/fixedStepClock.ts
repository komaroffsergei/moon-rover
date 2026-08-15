import type { TimeConfig } from '../../domain';

export interface FixedStepClock {
  accumulatorMilliseconds: number;
  elapsedRealMilliseconds: number;
}

export function createFixedStepClock(): FixedStepClock {
  return { accumulatorMilliseconds: 0, elapsedRealMilliseconds: 0 };
}

export function addRealTime(
  clock: FixedStepClock,
  realMilliseconds: number,
): void {
  if (!Number.isFinite(realMilliseconds) || realMilliseconds < 0) {
    throw new RangeError(
      'realMilliseconds должен быть конечным и неотрицательным',
    );
  }
  clock.accumulatorMilliseconds += realMilliseconds;
}

export function canConsumeFixedStep(
  clock: FixedStepClock,
  time: TimeConfig,
): boolean {
  return clock.accumulatorMilliseconds >= time.fixedStepMilliseconds;
}

export function consumeFixedStep(
  clock: FixedStepClock,
  time: TimeConfig,
): void {
  clock.accumulatorMilliseconds -= time.fixedStepMilliseconds;
  clock.elapsedRealMilliseconds += time.fixedStepMilliseconds;
}

export function gameMinutesAt(
  elapsedRealMilliseconds: number,
  time: TimeConfig,
): number {
  return roundGameValue(
    (elapsedRealMilliseconds / 1_000) * time.gameMinutesPerRealSecond,
  );
}

export function fixedStepGameMinutes(time: TimeConfig): number {
  return gameMinutesAt(time.fixedStepMilliseconds, time);
}

export function roundGameValue(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
