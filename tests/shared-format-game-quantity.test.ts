import { describe, expect, it } from 'vitest';

import { formatGameQuantity } from '../src/shared/formatGameQuantity';

describe('formatGameQuantity', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [2, '2'],
    [1.26, '1'],
    [2.04, '2'],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(formatGameQuantity(value)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite %s',
    (value) => {
      expect(() => formatGameQuantity(value)).toThrowError(RangeError);
    },
  );
});
