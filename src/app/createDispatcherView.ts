import type { CenterDefinition, CenterSnapshot } from '../domain';
import type { MapCenterUiMetrics } from '../game/mapGamePort';

function percentage(current: number, capacity: number): number {
  return Math.min(100, Math.max(0, (current / capacity) * 100));
}

/**
 * Проецирует validated center definition и snapshot в готовые UI-метрики.
 * React не знает depletion coefficients и не воспроизводит simulation rules.
 */
export function createCenterUiMetrics(
  snapshot: CenterSnapshot,
  definition: CenterDefinition,
): MapCenterUiMetrics {
  if (snapshot.id !== definition.id) {
    throw new Error(
      `Center snapshot ${snapshot.id} не соответствует definition ${definition.id}`,
    );
  }

  return Object.freeze({
    centerId: snapshot.id,
    oxygenPercent: percentage(
      snapshot.resources.oxygen,
      definition.oxygen.capacity,
    ),
    foodPercent: percentage(snapshot.resources.food, definition.food.capacity),
    equipmentPercent: percentage(
      snapshot.resources.equipment,
      definition.equipmentCapacity,
    ),
    depletionForecastGameMinutes: snapshot.depletionForecastGameMinutes,
  });
}
