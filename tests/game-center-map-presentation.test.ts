import { describe, expect, it } from 'vitest';

import type { CenterSnapshot } from '../src/domain';
import { createCenterMapPresentation } from '../src/game/centerMapPresentation';

const center: CenterSnapshot = {
  id: 'center-alpha',
  name: 'Альфа',
  cell: { column: 2, row: 3 },
  status: 'WORKING',
  resources: { oxygen: 70, food: 60, equipment: 50 },
  depletionForecastGameMinutes: 288,
  recoveryRemainingGameMinutes: null,
};

describe('center map presentation', () => {
  it('adds critical text and mm:ss recovery timer instead of relying on color', () => {
    expect(
      createCenterMapPresentation({
        ...center,
        status: 'RECOVERY',
        recoveryRemainingGameMinutes: 30,
      }),
    ).toEqual({
      label: 'Альфа\n! Критично · 00:30',
      tone: 'critical',
    });
  });

  it('marks a lost center with text while leaving normal labels compact', () => {
    expect(createCenterMapPresentation({ ...center, status: 'LOST' })).toEqual({
      label: 'Альфа\n! Центр потерян',
      tone: 'critical',
    });
    expect(createCenterMapPresentation(center)).toEqual({
      label: 'Альфа',
      tone: 'safe',
    });
  });
});
