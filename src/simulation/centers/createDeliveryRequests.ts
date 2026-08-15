import type { DomainEvent } from '../../domain';
import type { MutableCenterState } from '../types';

/** Публикует одну начальную задачу по самому большому дефициту каждого центра. */
export function createInitialDeliveryRequests(
  centers: readonly MutableCenterState[],
): readonly DomainEvent[] {
  return centers.flatMap((center) => {
    const needs = [
      {
        resource: 'oxygen' as const,
        amount: center.oxygen.capacity - center.oxygen.current,
      },
      {
        resource: 'food' as const,
        amount: center.food.capacity - center.food.current,
      },
      {
        resource: 'equipment' as const,
        amount: center.equipmentCapacity - center.equipment,
      },
    ].sort((left, right) => right.amount - left.amount);
    const need = needs[0];
    if (need === undefined || need.amount <= 0) return [];
    return [
      {
        type: 'CENTER_DELIVERY_REQUESTED' as const,
        centerId: center.id,
        resource: need.resource,
        amount: Math.ceil(need.amount),
        cell: { ...center.cell },
        gameMinute: 0,
      },
    ];
  });
}
