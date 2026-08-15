import {
  createSimulationConfigFromContent,
  loadContentBundle,
  parseJsonText,
  selectFacilityPlacement,
  type ContentBundle,
  type FacilityPlacement,
  type TiledMap,
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
import type { MapTileLayerName, PhaserMapSource } from '../game/mapSource';
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
  'hazards',
  'obstacles',
];

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
  return {
    id: bundle.levelMeta.id,
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    baseCell: { ...placement.baseCell },
    backgroundLayer: {
      x: background.x ?? 0,
      y: background.y ?? 0,
      opacity: typeof background.opacity === 'number' ? background.opacity : 1,
      visible: background.visible !== false,
    },
    layers: REQUIRED_TILE_LAYERS.map((name) => {
      const layer = requiredTileLayer(map, name);
      return {
        name,
        data: [...layer.data],
        opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
      };
    }),
    assets: {
      background: publicAssetPath(background.image),
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

// Исходники production неизменяемы. Кэш валидированного bundle повторно
// использует LOS-граф, но каждый вызов ниже создаёт отдельную сессию симуляции.
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
      baseCell: simulationConfig.baseCell,
      centerDefinitions: simulationConfig.centers,
    }),
    level: createLevelInfo(bundle),
    map: createPhaserMapSource(bundle, placement),
  };
}
