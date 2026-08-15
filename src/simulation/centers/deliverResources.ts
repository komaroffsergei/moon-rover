import type { Cargo, CenterRules, DomainEvent } from '../../domain';
import type { MutableCenterState, MutableResourceState } from '../types';
import { workingStatus } from './createCenterState';

export interface DeliveryResult {
  transferred: Cargo;
  remainder: Cargo;
  events: readonly DomainEvent[];
}

function rearmThresholds(
  resource: MutableResourceState,
  rules: CenterRules,
): void {
  for (const threshold of rules.radioThresholds) {
    if (resource.current > threshold) {
      resource.emittedThresholds.delete(threshold);
    }
  }
}

function transfer(available: number, free: number): number {
  return Math.max(0, Math.min(available, free));
}

export function deliverResources(
  center: MutableCenterState,
  cargo: Cargo,
  currentGameMinute: number,
  rules: CenterRules,
): DeliveryResult {
  const transferred = {
    oxygen: transfer(
      cargo.oxygen,
      center.oxygen.capacity - center.oxygen.current,
    ),
    food: transfer(cargo.food, center.food.capacity - center.food.current),
    equipment: transfer(
      cargo.equipment,
      center.equipmentCapacity - center.equipment,
    ),
  };
  center.oxygen.current += transferred.oxygen;
  center.food.current += transferred.food;
  center.equipment += transferred.equipment;
  if (transferred.oxygen > 0) rearmThresholds(center.oxygen, rules);
  if (transferred.food > 0) rearmThresholds(center.food, rules);

  const remainder = {
    oxygen: cargo.oxygen - transferred.oxygen,
    food: cargo.food - transferred.food,
    equipment: cargo.equipment - transferred.equipment,
  };
  const wasRecovering = center.status === 'RECOVERY';
  const allPositive =
    center.oxygen.current > 0 &&
    center.food.current > 0 &&
    center.equipment > 0;
  const events: DomainEvent[] = [];
  if (allPositive) {
    center.status = workingStatus(center, rules);
    center.recoveryRemainingGameMinutes = null;
    center.emittedRecoveryThresholds.clear();
    if (wasRecovering) {
      events.push({
        type: 'CENTER_RESTORED',
        centerId: center.id,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      });
    }
  }
  return { transferred, remainder, events };
}
