import { describe, expect, it } from 'vitest';

import fixtureCatalog from './fixtures/e2e-scenarios.json';
import { applyNamedE2eScenario } from '../src/app/testing/e2eSimulationScenario';
import type { CenterDefinition, RoverDefinition } from '../src/domain';
import { createSimulationEngine } from '../src/simulation';
import { makeSimulationConfig } from './fixtures/simulation';

const centers: readonly CenterDefinition[] = [
  {
    id: 'helios',
    name: 'Центр Гелиос',
    cell: { column: 13, row: 5 },
    oxygen: { initial: 90, capacity: 100, depletionGameMinutes: 480 },
    food: { initial: 90, capacity: 100, depletionGameMinutes: 480 },
    equipmentInitial: 100,
    equipmentCapacity: 100,
  },
  {
    id: 'aristarchus',
    name: 'Центр Аристарх',
    cell: { column: 13, row: 4 },
    oxygen: { initial: 90, capacity: 100, depletionGameMinutes: 480 },
    food: { initial: 90, capacity: 100, depletionGameMinutes: 480 },
    equipmentInitial: 100,
    equipmentCapacity: 100,
  },
  {
    id: 'kepler',
    name: 'Центр Кеплер',
    cell: { column: 3, row: 1 },
    oxygen: { initial: 84, capacity: 100, depletionGameMinutes: 420 },
    food: { initial: 84, capacity: 100, depletionGameMinutes: 420 },
    equipmentInitial: 80,
    equipmentCapacity: 100,
  },
];

const rovers: readonly RoverDefinition[] = [
  {
    id: 'gagarin',
    name: 'Гагарин',
    archetypeId: 'standard',
    kind: 'courier',
    initialCell: { column: 1, row: 5 },
    cargoCapacity: 60,
    batteryCapacity: 100,
    batteryInitial: 100,
    gameMinutesPerNormalCell: 2,
    batteryCostMultiplier: 1,
    initialCargo: { oxygen: 0, food: 0, equipment: 0 },
  },
  {
    id: 'tereshkova',
    name: 'Терешкова',
    archetypeId: 'fast',
    kind: 'courier',
    initialCell: { column: 1, row: 5 },
    cargoCapacity: 40,
    batteryCapacity: 90,
    batteryInitial: 90,
    gameMinutesPerNormalCell: 1.5,
    batteryCostMultiplier: 1,
    initialCargo: { oxygen: 0, food: 0, equipment: 0 },
  },
  {
    id: 'korolev',
    name: 'Королёв',
    archetypeId: 'repair',
    kind: 'repair',
    initialCell: { column: 1, row: 5 },
    cargoCapacity: 0,
    batteryCapacity: 100,
    batteryInitial: 100,
    gameMinutesPerNormalCell: 2,
    batteryCostMultiplier: 1,
    initialCargo: { oxygen: 0, food: 0, equipment: 0 },
  },
];

function productionConfig() {
  return makeSimulationConfig({
    baseCell: { column: 1, row: 5 },
    centers: structuredClone(centers),
    equipmentDemandCenterIds: ['helios', 'aristarchus'],
    rovers: structuredClone(rovers),
    routingMap: {
      width: 32,
      height: 24,
      cells: Array.from({ length: 32 * 24 }, () => ({
        walkable: true,
        movementCost: 1,
        effectiveCellChance: 0.0075,
        incidentProfileId: 'normal',
      })),
    },
  });
}

const fixtureJson = JSON.stringify(fixtureCatalog);
const scenarioIds = Object.keys(
  fixtureCatalog.scenarios,
) as (keyof typeof fixtureCatalog.scenarios)[];

describe('E2E simulation scenarios', () => {
  it.each(scenarioIds)(
    'validates the named %s fixture through SimulationEngine',
    (scenario) => {
      const config = applyNamedE2eScenario({
        config: productionConfig(),
        fixtureJson,
        levelId: 'shackleton-rift',
        search: `?e2e=1&scenario=${scenario}`,
      });

      expect(config.seed).toBe(fixtureCatalog.scenarios[scenario]?.seed);
      expect(() => createSimulationEngine(config)).not.toThrow();
    },
  );

  it('leaves production coefficients untouched without the explicit E2E flag', () => {
    const config = productionConfig();
    expect(
      applyNamedE2eScenario({
        config,
        fixtureJson,
        levelId: 'shackleton-rift',
        search: '?scenario=victory-away',
      }),
    ).toBe(config);
  });

  it('rejects an unknown named fixture instead of accepting arbitrary input', () => {
    expect(() =>
      applyNamedE2eScenario({
        config: productionConfig(),
        fixtureJson,
        levelId: 'shackleton-rift',
        search: '?e2e=1&scenario=not-declared',
      }),
    ).toThrow('Unknown E2E scenario: not-declared');
  });
});
