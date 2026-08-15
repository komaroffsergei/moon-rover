import { xorshift128plus } from 'pure-rand/generator/xorshift128plus';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

export function seedTextToInteger(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

export function seedToInteger(parts: readonly string[]): number {
  return seedTextToInteger(JSON.stringify(parts));
}

export function createSeededRandomFromText(seed: string): RandomGenerator {
  return xorshift128plus(seedTextToInteger(seed));
}

export function createSeededRandom(
  ...parts: readonly string[]
): RandomGenerator {
  return xorshift128plus(seedToInteger(parts));
}
