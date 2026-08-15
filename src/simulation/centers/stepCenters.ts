import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

import { roundGameValue } from '../clock/fixedStepClock';
import type {
  CenterRules,
  ConsumableResource,
  DomainEvent,
  EquipmentDemandConfig,
} from '../../domain';
import type { MutableCenterState, MutableResourceState } from '../types';
import { workingStatus } from './createCenterState';
import { drawEquipmentLoss } from './equipmentDemand';

function depleteResource(
  resource: MutableResourceState,
  deltaGameMinutes: number,
): number {
  const previous = resource.current;
  const loss =
    (resource.capacity / resource.depletionGameMinutes) * deltaGameMinutes;
  const next = Math.max(0, previous - loss);
  resource.current = next < 1e-9 ? 0 : next;
  return previous;
}

function thresholdEvents(
  center: MutableCenterState,
  resourceName: ConsumableResource,
  previous: number,
  currentGameMinute: number,
  rules: CenterRules,
): DomainEvent[] {
  const resource = center[resourceName];
  const events: DomainEvent[] = [];
  for (const threshold of rules.radioThresholds) {
    if (
      previous > threshold &&
      resource.current <= threshold &&
      !resource.emittedThresholds.has(threshold)
    ) {
      resource.emittedThresholds.add(threshold);
      events.push({
        type: 'RESOURCE_THRESHOLD',
        centerId: center.id,
        resource: resourceName,
        threshold,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      });
    }
  }
  return events;
}

function applyDueEquipmentDemands(
  center: MutableCenterState,
  currentGameMinute: number,
  config: EquipmentDemandConfig,
  random: RandomGenerator,
): DomainEvent[] {
  if (center.status === 'RECOVERY' || center.status === 'LOST') return [];
  const events: DomainEvent[] = [];
  if (currentGameMinute < center.nextEquipmentDemandGameMinute) return events;

  const amount = drawEquipmentLoss(random, config);
  center.equipment = Math.max(0, center.equipment - amount);
  events.push({
    type: 'EQUIPMENT_DEMAND',
    centerId: center.id,
    amount,
    cell: { ...center.cell },
    gameMinute: currentGameMinute,
  });
  center.nextEquipmentDemandGameMinute =
    currentGameMinute + config.minimumIntervalGameMinutes;
  return events;
}

function allResourcesPositive(center: MutableCenterState): boolean {
  return (
    center.oxygen.current > 0 && center.food.current > 0 && center.equipment > 0
  );
}

function updateRecovery(
  center: MutableCenterState,
  wasRecovering: boolean,
  deltaGameMinutes: number,
  currentGameMinute: number,
  rules: CenterRules,
): DomainEvent[] {
  if (allResourcesPositive(center)) {
    center.status = workingStatus(center, rules);
    return [];
  }

  if (!wasRecovering) {
    center.status = 'RECOVERY';
    center.recoveryRemainingGameMinutes = rules.recoveryGameMinutes;
    center.emittedRecoveryThresholds = new Set([rules.recoveryGameMinutes]);
    return [
      {
        type: 'CENTER_RECOVERY_STARTED',
        centerId: center.id,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      },
      {
        type: 'RECOVERY_THRESHOLD',
        centerId: center.id,
        remainingGameMinutes: rules.recoveryGameMinutes,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      },
    ];
  }

  const previous = center.recoveryRemainingGameMinutes ?? 0;
  const remaining = roundGameValue(Math.max(0, previous - deltaGameMinutes));
  center.recoveryRemainingGameMinutes = remaining;
  const events: DomainEvent[] = [];
  for (const threshold of rules.recoveryRadioThresholds) {
    if (
      previous > threshold &&
      remaining <= threshold &&
      !center.emittedRecoveryThresholds.has(threshold)
    ) {
      center.emittedRecoveryThresholds.add(threshold);
      events.push({
        type: 'RECOVERY_THRESHOLD',
        centerId: center.id,
        remainingGameMinutes: threshold,
        cell: { ...center.cell },
        gameMinute: currentGameMinute,
      });
    }
  }
  if (remaining === 0) {
    center.status = 'LOST';
    events.push({
      type: 'CENTER_LOST',
      centerId: center.id,
      cell: { ...center.cell },
      gameMinute: currentGameMinute,
    });
  }
  return events;
}

export function stepCenter(
  center: MutableCenterState,
  deltaGameMinutes: number,
  currentGameMinute: number,
  rules: CenterRules,
  demand: EquipmentDemandConfig,
  random: RandomGenerator,
): DomainEvent[] {
  const wasRecovering = center.status === 'RECOVERY';
  const previousOxygen = depleteResource(center.oxygen, deltaGameMinutes);
  const previousFood = depleteResource(center.food, deltaGameMinutes);
  const events = [
    ...applyDueEquipmentDemands(center, currentGameMinute, demand, random),
    ...thresholdEvents(
      center,
      'oxygen',
      previousOxygen,
      currentGameMinute,
      rules,
    ),
    ...thresholdEvents(center, 'food', previousFood, currentGameMinute, rules),
  ];
  events.push(
    ...updateRecovery(
      center,
      wasRecovering,
      deltaGameMinutes,
      currentGameMinute,
      rules,
    ),
  );
  return events;
}
