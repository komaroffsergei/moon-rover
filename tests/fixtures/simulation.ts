import type {
  Cargo,
  CenterDefinition,
  GridCell,
  RadioCatalog,
  RoutingMap,
  RoverDefinition,
  SimulationConfig,
  SimulationEngine,
} from '../../src/simulation';
import { RADIO_EVENT_CODES } from '../../src/simulation';

export const baseCell: GridCell = { column: 0, row: 0 };

export const standardRoutingMap: RoutingMap = {
  width: 5,
  height: 3,
  cells: Array.from({ length: 15 }, () => ({
    walkable: true,
    movementCost: 1,
    effectiveCellChance: 0.0075,
    incidentProfileId: 'normal',
  })),
};

export const standardCenter: CenterDefinition = {
  id: 'center-one',
  name: 'Центр Один',
  cell: baseCell,
  oxygen: {
    initial: 100,
    capacity: 100,
    depletionGameMinutes: 480,
  },
  food: {
    initial: 100,
    capacity: 100,
    depletionGameMinutes: 480,
  },
  equipmentInitial: 100,
  equipmentCapacity: 100,
};

export const standardRover: RoverDefinition = {
  id: 'rover-one',
  name: 'Ровер Один',
  archetypeId: 'test-courier',
  kind: 'courier',
  initialCell: baseCell,
  cargoCapacity: 300,
  batteryCapacity: 100,
  batteryInitial: 100,
  gameMinutesPerNormalCell: 2,
  batteryCostMultiplier: 1,
  initialCargo: { oxygen: 0, food: 0, equipment: 0 },
};

export const standardRadioCatalog: RadioCatalog = {
  historyLimit: 100,
  messages: Object.fromEntries(
    RADIO_EVENT_CODES.map((eventCode) => [
      eventCode,
      {
        category: 'INFO' as const,
        priority: 0 as const,
        templates: [`Test ${eventCode}`],
      },
    ]),
  ) as unknown as RadioCatalog['messages'],
};

export function setAndUnload(
  engine: SimulationEngine,
  cargo: Cargo,
  roverId = standardRover.id,
  centerId = standardCenter.id,
) {
  const load = engine.dispatch({ type: 'SET_ROVER_CARGO', roverId, cargo });
  if (!load.ok) throw new Error(`Не удалось загрузить rover: ${load.code}`);
  return engine.dispatch({ type: 'UNLOAD_ROVER_CARGO', roverId, centerId });
}

export function makeSimulationConfig(
  overrides: Partial<SimulationConfig> = {},
): SimulationConfig {
  return {
    seed: 'simulation-test-seed',
    time: {
      fixedStepMilliseconds: 100,
      gameMinutesPerRealSecond: 1,
      shiftRealSeconds: 480,
    },
    routeWeights: { movementCost: 1, incidentRisk: 10 },
    centerRules: {
      warningThreshold: 20,
      recoveryGameMinutes: 30,
      radioThresholds: [50, 25, 10, 5, 1],
      recoveryRadioThresholds: [20, 10, 5, 1],
    },
    equipmentDemand: {
      firstEligibleGameMinute: 30,
      minimumIntervalGameMinutes: 45,
      lossMin: 20,
      lossMax: 40,
    },
    incidentRules: {
      eventCooldownCells: 3,
      dustStormGameMinutes: 10,
      selfRepairGameMinutes: 10,
      profiles: [
        {
          id: 'normal',
          cellChance: 0.0075,
          weights: { dustStorm: 1, meteorite: 0, crater: 0 },
        },
      ],
    },
    rescueRules: {
      repairGameMinutes: 5,
      craterRescueGameMinutes: 3,
    },
    radioCatalog: structuredClone(standardRadioCatalog),
    routingMap: structuredClone(standardRoutingMap),
    baseCell,
    centers: [structuredClone(standardCenter)],
    rovers: [structuredClone(standardRover)],
    ...overrides,
  };
}
