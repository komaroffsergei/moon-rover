import { describe, expect, it, vi } from 'vitest';

import {
  createPlacementSeed,
  type RandomValuesSource,
} from '../src/app/createPlacementSeed';
import { E2E_GOLDEN_PLACEMENT_SEEDS } from '../src/app/testing/e2eFacilityPlacement';

describe('placement session seed', () => {
  it('draws fresh Web Crypto values for consecutive production sessions', () => {
    const values = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ];
    const randomValues: RandomValuesSource = {
      getRandomValues(target) {
        const next = values.shift();
        if (next === undefined) throw new Error('Unexpected random draw');
        target.set(next);
        return target;
      },
    };

    const first = createPlacementSeed(
      'shackleton-rift',
      'production',
      randomValues,
    );
    const second = createPlacementSeed(
      'shackleton-rift',
      'production',
      randomValues,
    );

    expect(first).toBe('00000001000000020000000300000004');
    expect(second).toBe('00000005000000060000000700000008');
    expect(second).not.toBe(first);
  });

  it('keeps E2E placement deterministic without consuming Web Crypto', () => {
    const randomValues = {
      getRandomValues: vi.fn(() => {
        throw new Error('E2E must not consume Web Crypto');
      }),
    } as unknown as RandomValuesSource;

    expect(createPlacementSeed('tycho-crater', 'e2e', randomValues)).toBe(
      E2E_GOLDEN_PLACEMENT_SEEDS['tycho-crater'],
    );
    expect(randomValues.getRandomValues).not.toHaveBeenCalled();
  });
});
