import {
  createSimulationConfigFromContent,
  loadContentBundle,
  parseJsonText,
  selectFacilityPlacement,
  type ContentBundle,
  type FacilityPlacement,
  type TiledMap,
  type TiledObject,
  type TiledTileLayer,
} from '../content';
import {
  commonContentSources,
  DEFAULT_RUNTIME_LEVEL_ID,
  getRuntimeLevelSource,
  runtimeLevelSources,
  type RuntimeLevelId,
  type RuntimeRiskLevel,
} from '../content/levels/catalog';
import type {
  MapObjectSource,
  MapTileLayerName,
  PhaserMapSource,
} from '../game/mapSource';
import { createSimulationEngine } from '../simulation';
import { createMapGameController } from './createMapGameController';
import { applyNamedE2eScenario } from './testing/e2eSimulationScenario';

export interface RuntimeLevelInfo {
  readonly id: RuntimeLevelId;
  readonly ordinal: number;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly riskLevel: RuntimeRiskLevel;
  readonly riskChoiceCenterCount: number;
  readonly shiftDurationRealSeconds: number;
  readonly centerCount: number;
  readonly roverCount: number;
  readonly courierCount: number;
  readonly previewAsset: string;
}

export type { RuntimeLevelId } from '../content/levels/catalog';

export interface RuntimeMapOptions {
  readonly authoringLayoutId?: string;
}

const REQUIRED_TILE_LAYERS: readonly MapTileLayerName[] = [
  'terrain',
  'hazards',
  'obstacles',
];

const SUPPORTED_OBJECT_CLASSES = new Set<MapObjectSource['className']>([
  'base',
  'center',
  'roverSpawn',
  'repairSpawn',
]);

function publicAssetPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function requiredThemeValue(
  values: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = values[key];
  if (!value) throw new Error(`Validated theme не содержит ${key}`);
  return value;
}

function propertyString(object: TiledObject, name: string): string | null {
  const value = object.properties?.find(
    (property) => property.name === name,
  )?.value;
  return typeof value === 'string' ? value : null;
}

function requiredTileLayer(map: TiledMap, name: MapTileLayerName) {
  const layer = map.layers.find(
    (candidate): candidate is TiledTileLayer =>
      candidate.type === 'tilelayer' && candidate.name === name,
  );
  if (!layer) {
    throw new Error(`Validated map не содержит слой ${name}`);
  }
  return layer;
}

function createObjects(
  map: TiledMap,
  placement: FacilityPlacement,
): readonly MapObjectSource[] {
  const layer = map.layers.find(
    (candidate) =>
      candidate.type === 'objectgroup' && candidate.name === 'objects',
  );
  if (layer?.type !== 'objectgroup') {
    throw new Error('Validated map не содержит objects layer');
  }

  return layer.objects.map((object) => {
    if (
      !object.class ||
      !SUPPORTED_OBJECT_CLASSES.has(
        object.class as MapObjectSource['className'],
      )
    ) {
      throw new Error(
        `Неподдерживаемый класс map object: ${String(object.class)}`,
      );
    }
    const entityId = propertyString(object, 'entityId');
    const placementCell =
      object.class === 'center' && entityId !== null
        ? placement.centers[entityId]
        : object.class === 'base' ||
            object.class === 'roverSpawn' ||
            object.class === 'repairSpawn'
          ? placement.baseCell
          : undefined;
    if (object.class === 'center' && placementCell === undefined) {
      throw new Error(`Validated placement не содержит center ${entityId}`);
    }
    return {
      id: object.id,
      name: object.name,
      className: object.class as MapObjectSource['className'],
      entityId,
      cell: placementCell
        ? { ...placementCell }
        : {
            column: object.x / map.tilewidth,
            row: object.y / map.tileheight,
          },
    };
  });
}

function createPhaserMapSource(
  bundle: ContentBundle,
  placement: FacilityPlacement,
): PhaserMapSource {
  const { map, theme } = bundle;
  const background = map.layers.find(
    (layer) => layer.type === 'imagelayer' && layer.name === 'background',
  );
  if (background?.type !== 'imagelayer') {
    throw new Error('Validated map не содержит background image layer');
  }
  const tileset = map.tilesets[0];
  if (
    !tileset?.image ||
    !tileset.columns ||
    !tileset.imagewidth ||
    !tileset.imageheight ||
    !tileset.tilecount ||
    !tileset.name ||
    !tileset.tilewidth ||
    !tileset.tileheight
  ) {
    throw new Error('Validated map не содержит встроенный atlas tileset');
  }
  return {
    id: bundle.levelMeta.id,
    tiledJson: structuredClone(map),
    tilesetName: tileset.name,
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    firstGid: tileset.firstgid,
    layers: REQUIRED_TILE_LAYERS.map((name) => {
      const layer = requiredTileLayer(map, name);
      return {
        name,
        data: [...layer.data],
        opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
      };
    }),
    objects: createObjects(map, placement),
    assets: {
      background: publicAssetPath(background.image),
      tileAtlas: publicAssetPath(tileset.image),
      tileFrameWidth: tileset.tilewidth,
      tileFrameHeight: tileset.tileheight,
      tileMargin: tileset.margin ?? 0,
      tileSpacing: tileset.spacing ?? 0,
      base: publicAssetPath(requiredThemeValue(theme.assets, 'base')),
      center: publicAssetPath(requiredThemeValue(theme.assets, 'center')),
      rover: publicAssetPath(requiredThemeValue(theme.assets, 'rover')),
      repairRover: publicAssetPath(
        requiredThemeValue(theme.assets, 'repairRover'),
      ),
      roverWheel: publicAssetPath(
        requiredThemeValue(theme.assets, 'roverWheel'),
      ),
    },
    palette: {
      grid: requiredThemeValue(theme.colors, 'grid'),
      hazard: requiredThemeValue(theme.colors, 'hazard'),
      hazardEdge: requiredThemeValue(theme.colors, 'hazardEdge'),
      route: requiredThemeValue(theme.colors, 'route'),
      safe: requiredThemeValue(theme.colors, 'safe'),
      warning: requiredThemeValue(theme.colors, 'warning'),
    },
  };
}

function loadRuntimeBundle(levelId: RuntimeLevelId): ContentBundle {
  const cached = runtimeBundleCache.get(levelId);
  if (cached !== undefined) return cached;
  const source = getRuntimeLevelSource(levelId);
  const bundle = loadContentBundle({
    ...commonContentSources,
    levelMeta: source.levelMeta,
    map: parseJsonText(source.mapText, source.mapFileName),
    theme: source.theme,
  });
  if (
    bundle.levelMeta.id !== source.id ||
    bundle.levelMeta.ordinal !== source.ordinal ||
    bundle.levelMeta.riskLevel !== source.riskLevel ||
    bundle.levelMeta.tiledMap !== source.mapFileName
  ) {
    throw new Error(`Каталог уровня ${source.id} не совпадает с metadata`);
  }
  runtimeBundleCache.set(levelId, bundle);
  return bundle;
}

// Production sources are immutable module assets. Reusing their validated
// bundle also lets procedural placement reuse its LOS visibility cache while
// every call below still creates an isolated simulation/controller session.
const runtimeBundleCache = new Map<RuntimeLevelId, ContentBundle>();

function createLevelInfo(bundle: ContentBundle): RuntimeLevelInfo {
  return Object.freeze({
    id: bundle.levelMeta.id as RuntimeLevelId,
    ordinal: bundle.levelMeta.ordinal,
    title: bundle.levelMeta.title,
    description: bundle.levelMeta.description ?? '',
    objective: 'Не допустить истощения центров',
    riskLevel: bundle.levelMeta.riskLevel,
    riskChoiceCenterCount: bundle.levelMeta.riskChoiceCenters.length,
    shiftDurationRealSeconds: bundle.levelMeta.shiftDurationRealSeconds,
    centerCount: bundle.levelMeta.centers.length,
    roverCount: bundle.levelMeta.rovers.length,
    courierCount: bundle.levelMeta.rovers.filter(
      ({ archetypeId }) => archetypeId !== 'repair',
    ).length,
    previewAsset: publicAssetPath(bundle.theme.backgroundAsset),
  });
}

const runtimeLevels = Object.freeze(
  runtimeLevelSources.map(({ id }) => createLevelInfo(loadRuntimeBundle(id))),
);

export function listRuntimeLevels(): readonly RuntimeLevelInfo[] {
  return runtimeLevels;
}

export function createRuntimeMap(
  levelId: RuntimeLevelId = DEFAULT_RUNTIME_LEVEL_ID,
  placementSeed = 'runtime-preview-placement',
  options: RuntimeMapOptions = {},
) {
  const bundle = loadRuntimeBundle(levelId);
  const placement = selectFacilityPlacement(bundle, placementSeed, options);
  const contentConfig = createSimulationConfigFromContent(bundle, placement);
  const simulationConfig =
    import.meta.env.MODE === 'e2e'
      ? applyNamedE2eScenario({
          config: contentConfig,
          fixtureJson: import.meta.env.VITE_E2E_FIXTURES_JSON,
          levelId,
          search: window.location.search,
        })
      : contentConfig;
  const simulation = createSimulationEngine(simulationConfig);

  return {
    controller: createMapGameController({
      simulation,
      routingMap: simulationConfig.routingMap,
      baseCell: simulationConfig.baseCell,
      centerDefinitions: simulationConfig.centers,
    }),
    level: createLevelInfo(bundle),
    map: createPhaserMapSource(bundle, placement),
  };
}
