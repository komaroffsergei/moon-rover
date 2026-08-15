import { describe, expect, it } from 'vitest';

import { createCenterUiMetrics } from '../src/app/createDispatcherView';
import type { CenterSnapshot } from '../src/domain';
import { standardCenter } from './fixtures/simulation';

describe('dispatcher read model', () => {
  it('projects exact resource percentages and the simulation-owned forecast', () => {
    const definition = structuredClone(standardCenter);
    const snapshot: CenterSnapshot = {
      id: definition.id,
      name: definition.name,
      cell: definition.cell,
      status: 'WARNING',
      resources: { oxygen: 50, food: 25, equipment: 75 },
      depletionForecastGameMinutes: 123.4,
      recoveryRemainingGameMinutes: null,
    };
    const before = structuredClone(snapshot);

    expect(createCenterUiMetrics(snapshot, definition)).toEqual({
      centerId: definition.id,
      oxygenPercent: 50,
      foodPercent: 25,
      equipmentPercent: 75,
      depletionForecastGameMinutes: 123.4,
    });
    expect(snapshot).toEqual(before);
  });

  it('clamps panel percentages while preserving a zero forecast', () => {
    const definition = structuredClone(standardCenter);
    const snapshot: CenterSnapshot = {
      id: definition.id,
      name: definition.name,
      cell: definition.cell,
      status: 'RECOVERY',
      resources: { oxygen: 0, food: 110, equipment: -5 },
      depletionForecastGameMinutes: 0,
      recoveryRemainingGameMinutes: 30,
    };

    expect(createCenterUiMetrics(snapshot, definition)).toEqual({
      centerId: definition.id,
      oxygenPercent: 0,
      foodPercent: 100,
      equipmentPercent: 0,
      depletionForecastGameMinutes: 0,
    });
  });
});
