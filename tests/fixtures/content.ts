import type {
  Balance,
  IncidentProfiles,
  LevelMeta,
  RadioContent,
  Theme,
  TiledMap,
} from '../../src/content';
import { RADIO_EVENT_CODES } from '../../src/domain';

const properties = (
  values: Record<string, string | number | boolean>,
): Array<{ name: string; type: string; value: string | number | boolean }> =>
  Object.entries(values).map(([name, value]) => ({
    name,
    type:
      typeof value === 'boolean'
        ? 'bool'
        : typeof value === 'number'
          ? 'float'
          : 'string',
    value,
  }));

export function makeValidTiledMap(): TiledMap {
  const width = 5;
  const height = 3;
  const empty = Array<number>(width * height).fill(0);
  const terrain = Array<number>(width * height).fill(1);
  const hazards = [...empty];
  for (const index of [6, 7, 8, 10, 11, 12, 13, 14]) hazards[index] = 2;
  const layerDefaults = { opacity: 1, visible: true, x: 0, y: 0 } as const;

  return {
    type: 'map',
    width,
    height,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tilewidth: 64,
    tileheight: 64,
    layers: [
      {
        ...layerDefaults,
        id: 1,
        name: 'background',
        type: 'imagelayer',
        image: 'assets/maps/test/background.webp',
      },
      {
        ...layerDefaults,
        id: 2,
        name: 'terrain',
        type: 'tilelayer',
        width,
        height,
        data: terrain,
      },
      {
        ...layerDefaults,
        id: 3,
        name: 'hazards',
        type: 'tilelayer',
        width,
        height,
        data: hazards,
      },
      {
        ...layerDefaults,
        id: 4,
        name: 'obstacles',
        type: 'tilelayer',
        width,
        height,
        data: empty,
      },
      {
        ...layerDefaults,
        id: 5,
        name: 'objects',
        type: 'objectgroup',
        objects: [
          {
            id: 1,
            name: 'base',
            class: 'base',
            point: true,
            x: 0,
            y: 64,
            properties: properties({ entityId: 'base' }),
          },
          {
            id: 2,
            name: 'center-risk',
            class: 'center',
            point: true,
            x: 256,
            y: 64,
            properties: properties({ entityId: 'center-risk' }),
          },
          {
            id: 3,
            name: 'center-safe',
            class: 'center',
            point: true,
            x: 256,
            y: 128,
            properties: properties({ entityId: 'center-safe' }),
          },
          {
            id: 4,
            name: 'spawn-one',
            class: 'roverSpawn',
            point: true,
            x: 0,
            y: 64,
            properties: properties({ entityId: 'spawn-one' }),
          },
          {
            id: 5,
            name: 'spawn-two',
            class: 'roverSpawn',
            point: true,
            x: 0,
            y: 64,
            properties: properties({ entityId: 'spawn-two' }),
          },
          {
            id: 6,
            name: 'spawn-repair',
            class: 'repairSpawn',
            point: true,
            x: 0,
            y: 128,
            properties: properties({ entityId: 'spawn-repair' }),
          },
        ],
      },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'logic',
        tilewidth: 64,
        tileheight: 64,
        tilecount: 3,
        columns: 3,
        image: 'assets/tiles/logic.png',
        imagewidth: 192,
        imageheight: 64,
        tiles: [
          {
            id: 0,
            properties: properties({
              terrainType: 'normal',
              walkable: true,
              movementCost: 1,
            }),
          },
          {
            id: 1,
            properties: properties({
              terrainType: 'rough',
              walkable: true,
              movementCost: 1.5,
              hazardProfileId: 'hazard-low',
            }),
          },
          {
            id: 2,
            properties: properties({
              terrainType: 'blocked',
              walkable: false,
              movementCost: 99,
            }),
          },
        ],
      },
    ],
  };
}

export const levelMetaFixture: LevelMeta = {
  schemaVersion: 1,
  ordinal: 1,
  id: 'test-level',
  title: 'Тестовый уровень',
  tiledMap: 'maps/test-level.tmj',
  themeId: 'test-theme',
  balanceProfileId: 'default',
  seed: 'test-seed',
  shiftDurationRealSeconds: 480,
  riskLevel: 'low',
  centers: [
    {
      id: 'center-risk',
      name: 'Риск',
      oxygen: { initial: 80, capacity: 100, depletionGameMinutes: 300 },
      food: { initial: 80, capacity: 100, depletionGameMinutes: 360 },
      equipmentInitial: 80,
    },
    {
      id: 'center-safe',
      name: 'Безопасный',
      oxygen: { initial: 70, capacity: 100, depletionGameMinutes: 300 },
      food: { initial: 70, capacity: 100, depletionGameMinutes: 360 },
      equipmentInitial: 70,
    },
  ],
  facilityLayouts: [
    {
      id: 'test-west',
      baseCell: { column: 0, row: 1 },
      centers: {
        'center-risk': { column: 4, row: 1 },
        'center-safe': { column: 1, row: 0 },
      },
    },
    {
      id: 'test-north',
      baseCell: { column: 0, row: 1 },
      centers: {
        'center-risk': { column: 4, row: 1 },
        'center-safe': { column: 2, row: 0 },
      },
    },
    {
      id: 'test-east',
      baseCell: { column: 4, row: 1 },
      centers: {
        'center-risk': { column: 0, row: 1 },
        'center-safe': { column: 3, row: 0 },
      },
    },
  ],
  rovers: [
    {
      id: 'rover-one',
      name: 'Первый',
      archetypeId: 'standard',
      spawnObjectId: 'spawn-one',
    },
    {
      id: 'rover-two',
      name: 'Второй',
      archetypeId: 'fast',
      spawnObjectId: 'spawn-two',
    },
    {
      id: 'rover-repair',
      name: 'Ремонтный',
      archetypeId: 'repair',
      spawnObjectId: 'spawn-repair',
    },
  ],
  riskChoiceCenters: ['center-risk'],
  seededEquipmentDemandCenterIds: ['center-risk'],
};

export const balanceFixture: Balance = {
  schemaVersion: 1,
  time: {
    gameMinutesPerRealSecond: 1,
    fixedStepMilliseconds: 100,
    shiftRealSeconds: 480,
  },
  center: {
    warningThreshold: 20,
    recoveryGameMinutes: 30,
    radioThresholds: [50, 25, 10, 5, 1],
    recoveryRadioThresholds: [20, 10, 5, 1],
    equipmentCapacity: 100,
    equipmentDemand: {
      firstEligibleGameMinute: 30,
      minimumIntervalGameMinutes: 45,
      lossMin: 20,
      lossMax: 40,
    },
  },
  routing: {
    eventCooldownCells: 3,
    routeWeights: { movementCost: 1, incidentRisk: 10 },
  },
  incidents: {
    normalCellChance: 0.0075,
    hazardCellChanceMin: 0.08,
    hazardCellChanceMax: 0.16,
  },
  rescue: {
    repairGameMinutes: 5,
    craterRescueGameMinutes: 3,
  },
  roverArchetypes: [
    {
      id: 'fast',
      cargoCapacity: 40,
      batteryCapacity: 90,
      gameMinutesPerNormalCell: 1.5,
      batteryCostMultiplier: 1,
    },
    {
      id: 'standard',
      cargoCapacity: 60,
      batteryCapacity: 100,
      gameMinutesPerNormalCell: 2,
      batteryCostMultiplier: 1,
    },
    {
      id: 'heavy',
      cargoCapacity: 90,
      batteryCapacity: 120,
      gameMinutesPerNormalCell: 2.5,
      batteryCostMultiplier: 1.1,
    },
    {
      id: 'repair',
      cargoCapacity: 0,
      batteryCapacity: 100,
      gameMinutesPerNormalCell: 2,
      batteryCostMultiplier: 1,
    },
  ],
};

export const incidentsFixture: IncidentProfiles = {
  schemaVersion: 1,
  rules: {
    dustStormGameMinutes: 10,
    selfRepairGameMinutes: 10,
  },
  profiles: [
    {
      id: 'normal',
      cellChance: 0.0075,
      weights: { dustStorm: 55, meteorite: 15, crater: 30 },
    },
    {
      id: 'hazard-low',
      cellChance: 0.08,
      weights: { dustStorm: 50, meteorite: 20, crater: 30 },
    },
  ],
};

export const radioFixture: RadioContent = {
  schemaVersion: 1,
  historyLimit: 100,
  messages: Object.fromEntries(
    RADIO_EVENT_CODES.map((eventCode) => [
      eventCode,
      {
        category: 'INFO' as const,
        priority: 0 as const,
        templates: [`Проверка ${eventCode}.`],
      },
    ]),
  ) as RadioContent['messages'],
};

export const themeFixture: Theme = {
  schemaVersion: 1,
  id: 'test-theme',
  backgroundAsset: 'assets/maps/test/background.webp',
  colors: { grid: '#71808A' },
  assets: { rover: 'assets/objects/rover.webp' },
};

export function makeBundleFixture() {
  return {
    levelMeta: structuredClone(levelMetaFixture),
    balance: structuredClone(balanceFixture),
    balanceProfileId: 'default',
    incidents: structuredClone(incidentsFixture),
    radio: structuredClone(radioFixture),
    theme: structuredClone(themeFixture),
    map: makeValidTiledMap(),
  };
}
