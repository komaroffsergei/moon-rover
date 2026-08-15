import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator';

import type { IncidentKind, IncidentProfileDefinition } from '../../domain';
import { createSeededRandom } from '../../shared/random/seededRandom';

export interface IncidentRandomStreams {
  trigger: RandomGenerator;
  kind: RandomGenerator;
}

export function createIncidentRandomStreams(
  seed: string,
  roverId: string,
): IncidentRandomStreams {
  return {
    trigger: createSeededRandom(seed, 'incident-trigger', roverId),
    kind: createSeededRandom(seed, 'incident-kind', roverId),
  };
}

export function drawIncident(
  random: IncidentRandomStreams,
  profile: IncidentProfileDefinition,
): IncidentKind | null {
  if (uniformFloat64(random.trigger) >= profile.cellChance) return null;

  const entries = [
    ['dustStorm', profile.weights.dustStorm],
    ['meteorite', profile.weights.meteorite],
    ['crater', profile.weights.crater],
  ] as const;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const draw = uniformFloat64(random.kind) * total;
  let boundary = 0;
  for (const [kind, weight] of entries) {
    boundary += weight;
    if (draw < boundary) return kind;
  }
  return 'crater';
}
