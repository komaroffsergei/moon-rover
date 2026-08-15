import type { RuntimeLevelId } from './createRuntimeMap';
import { E2E_GOLDEN_PLACEMENT_SEEDS } from './testing/e2eFacilityPlacement';

export interface RandomValuesSource {
  getRandomValues(values: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer>;
}

/**
 * Создаёт независимый seed размещения для каждой production-сессии, но
 * сохраняет координатный E2E-режим воспроизводимым.
 */
export function createPlacementSeed(
  levelId: RuntimeLevelId,
  mode: string = import.meta.env.MODE,
  randomValues: RandomValuesSource = globalThis.crypto,
): string {
  if (mode === 'e2e') return E2E_GOLDEN_PLACEMENT_SEEDS[levelId];

  const values = randomValues.getRandomValues(new Uint32Array(4));
  return Array.from(values, (value) =>
    value.toString(16).padStart(8, '0'),
  ).join('');
}
