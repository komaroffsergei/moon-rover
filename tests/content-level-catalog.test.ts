import { describe, expect, it } from 'vitest';

import {
  createSimulationConfigFromContent,
  loadContentBundle,
  parseJsonText,
  selectFacilityPlacement,
} from '../src/content';
import {
  commonContentSources,
  getRuntimeLevelSource,
  runtimeLevelSources,
  type RuntimeLevelId,
} from '../src/content/levels/catalog';
import {
  distancesFrom,
  gridIndex,
  safePathMultiplicity,
  type GridPosition,
} from '../src/content/validation/grid';
import { hazardZoneSizes } from '../src/content/validation/validateHazardZones';
import { validateTiledStructure } from '../src/content/validation/validateTiledStructure';

interface ExpectedLevel {
  readonly id: RuntimeLevelId;
  readonly ordinal: 1 | 2 | 3 | 4 | 5;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme' | 'maximum';
  readonly dimensions: readonly [number, number];
  readonly base: readonly [number, number];
  readonly centers: Readonly<Record<string, readonly [number, number]>>;
  readonly courierCount: number;
  readonly hazardCount: number;
  readonly hazardZoneSizes: readonly number[];
  readonly obstacleCount: number;
  readonly riskChoiceCenterIds: readonly string[];
  readonly riskRatios: Readonly<Record<string, number>>;
  readonly backgroundAsset: string;
  readonly directSafeCenterId: string;
  readonly twoApproachCenterId?: string;
}

interface RawLevelCatalogFields {
  readonly ordinal: number;
  readonly riskLevel: string;
  readonly riskChoiceCenters: readonly string[];
  readonly seededEquipmentDemandCenterIds: readonly string[];
}

const expectedLevels: readonly ExpectedLevel[] = [
  {
    id: 'tycho-crater',
    ordinal: 1,
    riskLevel: 'low',
    dimensions: [12, 8],
    base: [1, 4],
    centers: { selene: [9, 4], atlas: [3, 1] },
    courierCount: 2,
    hazardCount: 9,
    hazardZoneSizes: [9],
    obstacleCount: 10,
    riskChoiceCenterIds: ['selene'],
    riskRatios: { selene: 12 / 8 },
    backgroundAsset: '/assets/maps/tycho/background.webp',
    directSafeCenterId: 'atlas',
  },
  {
    id: 'shackleton-rift',
    ordinal: 2,
    riskLevel: 'medium',
    dimensions: [16, 10],
    base: [1, 5],
    centers: { helios: [13, 5], aristarchus: [13, 4], kepler: [3, 1] },
    courierCount: 2,
    hazardCount: 24,
    hazardZoneSizes: [24],
    obstacleCount: 10,
    riskChoiceCenterIds: ['helios', 'aristarchus'],
    riskRatios: { helios: 18 / 12, aristarchus: 19 / 13 },
    backgroundAsset: '/assets/maps/shackleton/background.webp',
    directSafeCenterId: 'kepler',
    twoApproachCenterId: 'kepler',
  },
  {
    id: 'tranquility-sea',
    ordinal: 3,
    riskLevel: 'high',
    dimensions: [18, 13],
    base: [9, 11],
    centers: { vostok: [9, 1], zarya: [8, 1], mir: [10, 1], luna: [16, 11] },
    courierCount: 3,
    hazardCount: 21,
    hazardZoneSizes: [21],
    obstacleCount: 10,
    riskChoiceCenterIds: ['vostok', 'zarya', 'mir'],
    riskRatios: { vostok: 18 / 10, zarya: 17 / 11, mir: 17 / 11 },
    backgroundAsset: '/assets/maps/tranquility/background.webp',
    directSafeCenterId: 'luna',
    twoApproachCenterId: 'luna',
  },
  {
    id: 'south-pole',
    ordinal: 4,
    riskLevel: 'extreme',
    dimensions: [20, 14],
    base: [1, 6],
    centers: {
      cabeus: [17, 6],
      malapert: [17, 5],
      'de-gerlache': [17, 7],
      nobile: [4, 12],
      amundsen: [4, 1],
    },
    courierCount: 4,
    hazardCount: 27,
    hazardZoneSizes: [27],
    obstacleCount: 13,
    riskChoiceCenterIds: ['cabeus', 'malapert', 'de-gerlache'],
    riskRatios: {
      cabeus: 26 / 16,
      malapert: 25 / 17,
      'de-gerlache': 25 / 17,
    },
    backgroundAsset: '/assets/maps/south-pole/background.webp',
    directSafeCenterId: 'nobile',
    twoApproachCenterId: 'nobile',
  },
  {
    id: 'aitken-labyrinth',
    ordinal: 5,
    riskLevel: 'maximum',
    dimensions: [20, 14],
    base: [1, 6],
    centers: {
      cabeus: [17, 6],
      malapert: [17, 5],
      'de-gerlache': [17, 7],
      nobile: [4, 12],
      amundsen: [4, 1],
      shoemaker: [18, 12],
    },
    courierCount: 5,
    hazardCount: 45,
    hazardZoneSizes: [9, 27, 9],
    obstacleCount: 13,
    riskChoiceCenterIds: ['cabeus', 'malapert', 'de-gerlache'],
    riskRatios: {
      cabeus: 26 / 16,
      malapert: 25 / 17,
      'de-gerlache': 25 / 17,
    },
    backgroundAsset: '/assets/maps/aitken/background.webp',
    directSafeCenterId: 'nobile',
    twoApproachCenterId: 'nobile',
  },
];

function objectEntityId(
  properties:
    | ReadonlyArray<{
        readonly name: string;
        readonly value: string | number | boolean;
      }>
    | undefined,
): string | undefined {
  const value = properties?.find(({ name }) => name === 'entityId')?.value;
  return typeof value === 'string' ? value : undefined;
}

function gridPositionOf(
  positions: ReadonlyMap<string | undefined, readonly number[]>,
  entityId: string,
): GridPosition {
  const position = positions.get(entityId);
  if (position === undefined) throw new Error(`Missing object ${entityId}`);
  const [column, row] = position;
  if (column === undefined || row === undefined) {
    throw new Error(`Invalid object position ${entityId}`);
  }
  return { column, row };
}

describe('five-level content catalog', () => {
  it('keeps a stable progression order', () => {
    expect(runtimeLevelSources.map(({ id }) => id)).toEqual(
      expectedLevels.map(({ id }) => id),
    );
  });

  it.each(expectedLevels)(
    'loads and validates $id as a complete content bundle',
    (expected) => {
      const source = getRuntimeLevelSource(expected.id);
      const rawLevel = source.levelMeta as RawLevelCatalogFields;
      const bundle = loadContentBundle({
        ...commonContentSources,
        levelMeta: source.levelMeta,
        map: parseJsonText(source.mapText, source.mapFileName),
        theme: source.theme,
      });
      const simulationConfig = createSimulationConfigFromContent(
        bundle,
        selectFacilityPlacement(bundle, 'catalog-test'),
      );

      expect(source.ordinal).toBe(expected.ordinal);
      expect(source.riskLevel).toBe(expected.riskLevel);
      expect(bundle.balance.routing.routeWeights).toEqual({
        movementCost: 1,
        incidentRisk: 10,
      });
      expect(simulationConfig.routeWeights).toEqual(
        bundle.balance.routing.routeWeights,
      );
      expect(rawLevel).toMatchObject({
        ordinal: expected.ordinal,
        riskLevel: expected.riskLevel,
        riskChoiceCenters: expected.riskChoiceCenterIds,
      });
      expect(rawLevel.seededEquipmentDemandCenterIds).toHaveLength(
        expected.ordinal,
      );
      expect([bundle.map.width, bundle.map.height]).toEqual(
        expected.dimensions,
      );
      expect(bundle.theme).toMatchObject({
        backgroundAsset: expected.backgroundAsset,
        assets: {
          base: '/assets/objects/base.png',
          center: '/assets/objects/center.png',
          rover: '/assets/objects/rover.png',
          repairRover: '/assets/objects/repair-rover.png',
          roverWheel: '/assets/objects/rover-wheel.webp',
        },
      });
      expect(bundle.map.tilesets).toEqual([
        expect.objectContaining({
          name: 'lunar-logical',
          image: '/assets/tiles/lunar-logical.png',
          tilecount: 3,
          columns: 3,
          imagewidth: 192,
          imageheight: 64,
        }),
      ]);
      expect(
        bundle.levelMeta.rovers.filter(
          ({ archetypeId }) => archetypeId !== 'repair',
        ),
      ).toHaveLength(expected.courierCount);
      expect(
        bundle.levelMeta.rovers.filter(
          ({ archetypeId }) => archetypeId === 'repair',
        ),
      ).toHaveLength(1);

      const hazards = bundle.map.layers.find(
        (layer) => layer.type === 'tilelayer' && layer.name === 'hazards',
      );
      expect(hazards?.type).toBe('tilelayer');
      if (hazards?.type !== 'tilelayer') throw new Error('hazards missing');
      expect(hazards.data.filter((gid) => gid === 2)).toHaveLength(
        expected.hazardCount,
      );
      const obstacles = bundle.map.layers.find(
        (layer) => layer.type === 'tilelayer' && layer.name === 'obstacles',
      );
      expect(obstacles?.type).toBe('tilelayer');
      if (obstacles?.type !== 'tilelayer') throw new Error('obstacles missing');
      expect(obstacles.data.filter((gid) => gid === 3)).toHaveLength(
        expected.obstacleCount,
      );

      const objects = bundle.map.layers.find(
        (layer) => layer.type === 'objectgroup' && layer.name === 'objects',
      );
      expect(objects?.type).toBe('objectgroup');
      if (objects?.type !== 'objectgroup') throw new Error('objects missing');

      const positions = new Map(
        objects.objects.map((object) => [
          objectEntityId(object.properties),
          [object.x / 64, object.y / 64],
        ]),
      );
      expect(positions.get('base')).toEqual(expected.base);
      for (const [centerId, position] of Object.entries(expected.centers)) {
        expect(positions.get(centerId)).toEqual(position);
      }

      const structure = validateTiledStructure(bundle.map, bundle.incidents);
      expect(structure.issues).toEqual([]);
      if (structure.model === undefined) {
        throw new Error(`Missing validation model for ${expected.id}`);
      }

      const base = gridPositionOf(positions, 'base');
      const unrestricted = distancesFrom(structure.model.grid, base);
      const safe = distancesFrom(structure.model.grid, base, true);

      for (const centerId of expected.riskChoiceCenterIds) {
        const center = gridPositionOf(positions, centerId);
        const centerIndex = gridIndex(structure.model.grid, center);
        const shortDistance = unrestricted[centerIndex];
        const safeDistance = safe[centerIndex];
        expect(shortDistance).toBeDefined();
        expect(safeDistance).toBeDefined();
        if (shortDistance === undefined || safeDistance === undefined) {
          throw new Error(`Missing risk path evidence for ${centerId}`);
        }
        const ratio = safeDistance / shortDistance;
        expect(ratio).toBeGreaterThanOrEqual(1.4);
        expect(ratio).toBeLessThanOrEqual(1.9);
        expect(ratio).toBeCloseTo(expected.riskRatios[centerId]!, 8);
      }

      const directSafeCenter = gridPositionOf(
        positions,
        expected.directSafeCenterId,
      );
      const directSafeIndex = gridIndex(structure.model.grid, directSafeCenter);
      expect(expected.riskChoiceCenterIds).not.toContain(
        expected.directSafeCenterId,
      );
      expect(safe[directSafeIndex]).toBe(unrestricted[directSafeIndex]);

      expect(hazardZoneSizes(structure.model.grid)).toEqual(
        expected.hazardZoneSizes,
      );

      if (expected.ordinal >= 2) {
        const riskShare =
          expected.riskChoiceCenterIds.length / bundle.levelMeta.centers.length;
        expect(riskShare).toBeGreaterThanOrEqual(
          expected.ordinal === 5 ? 0.5 : 0.6,
        );
        expect(riskShare).toBeLessThanOrEqual(0.75);
        expect(
          Math.max(...hazardZoneSizes(structure.model.grid)),
        ).toBeGreaterThanOrEqual(20);

        const twoApproachCenter = gridPositionOf(
          positions,
          expected.twoApproachCenterId!,
        );
        expect(
          safePathMultiplicity(structure.model.grid, base, twoApproachCenter),
        ).toBe(2);
      }
    },
  );
});
