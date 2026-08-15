import type { DomainEvent, ShiftPhase, TimeConfig } from '../../domain';
import type { MutableCenterState } from '../types';
import { gameMinutesAt } from '../clock/fixedStepClock';

export interface OutcomeResult {
  phase: ShiftPhase;
  event?: DomainEvent;
}

export function evaluateOutcome(
  currentPhase: ShiftPhase,
  elapsedRealMilliseconds: number,
  centers: readonly MutableCenterState[],
  time: TimeConfig,
): OutcomeResult {
  const gameMinute = gameMinutesAt(elapsedRealMilliseconds, time);
  if (centers.some(({ status }) => status === 'LOST')) {
    return {
      phase: 'DEFEAT',
      event: { type: 'SHIFT_ENDED', outcome: 'DEFEAT', gameMinute },
    };
  }

  if (elapsedRealMilliseconds < time.shiftRealSeconds * 1_000) {
    return { phase: currentPhase };
  }

  const operational = centers.every(({ status }) =>
    ['WORKING', 'WARNING'].includes(status),
  );
  const outcome = operational ? 'VICTORY' : 'DEFEAT';
  return {
    phase: outcome,
    event: { type: 'SHIFT_ENDED', outcome, gameMinute },
  };
}
