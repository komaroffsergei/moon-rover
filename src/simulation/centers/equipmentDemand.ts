import { uniformInt } from 'pure-rand/distribution/uniformInt';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

import type { EquipmentDemandConfig } from '../../domain';
import { createSeededRandomFromText } from '../../shared/random/seededRandom';

export function createDemandRandom(seed: string): RandomGenerator {
  return createSeededRandomFromText(seed);
}

export function drawEquipmentLoss(
  random: RandomGenerator,
  config: EquipmentDemandConfig,
): number {
  return uniformInt(random, config.lossMin, config.lossMax);
}
