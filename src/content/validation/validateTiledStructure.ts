import type { IncidentProfiles } from '../schemas/incidents';
import type { TiledLayer, TiledMap, TiledObjectLayer } from '../schemas/tiled';
import type { LogicalGrid } from './grid';
import type { ValidationIssue } from './issues';
import { isLocalAssetPath } from './localAssetPath';
import { buildTileDefinitions, validateTileLayer } from './validateTiledTiles';

export interface TiledValidationModel {
  grid: LogicalGrid;
  objectLayer: TiledObjectLayer;
  objectLayerIndex: number;
  hazardLayerIndex: number;
  terrainLayerIndex: number;
}

const requiredLayers = [
  ['background', 'imagelayer'],
  ['terrain', 'tilelayer'],
  ['hazards', 'tilelayer'],
  ['obstacles', 'tilelayer'],
  ['objects', 'objectgroup'],
] as const;

function addIssue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function scriptField(value: object): string | undefined {
  return Object.keys(value).find((key) => /script/i.test(key));
}

function rejectScriptField(
  value: object,
  path: string,
  issues: ValidationIssue[],
): void {
  const field = scriptField(value);
  if (field !== undefined) {
    addIssue(
      issues,
      'map.script',
      `${path}.${field}`,
      'Скрипты в Tiled запрещены',
    );
  }
}

function validateRequiredLayerPresentation(
  layer: TiledLayer,
  index: number,
  issues: ValidationIssue[],
): void {
  const path = `$.layers[${index}]`;
  const fields = layer as Record<string, unknown>;
  if (fields.visible !== undefined && fields.visible !== true) {
    addIssue(
      issues,
      'map.layer-hidden',
      `${path}.visible`,
      `Обязательный слой ${layer.name} должен быть видимым`,
    );
  }
  if (
    fields.opacity !== undefined &&
    (typeof fields.opacity !== 'number' ||
      !Number.isFinite(fields.opacity) ||
      fields.opacity <= 0 ||
      fields.opacity > 1)
  ) {
    addIssue(
      issues,
      'map.layer-opacity',
      `${path}.opacity`,
      `Opacity обязательного слоя ${layer.name} должен быть в диапазоне (0, 1]`,
    );
  }

  for (const field of ['x', 'y', 'offsetx', 'offsety', 'startx', 'starty']) {
    if (fields[field] !== undefined && fields[field] !== 0) {
      addIssue(
        issues,
        'map.layer-transform',
        `${path}.${field}`,
        `Обязательный слой ${layer.name} не должен смещать логическую сетку`,
      );
    }
  }
  for (const field of ['parallaxx', 'parallaxy']) {
    if (fields[field] !== undefined && fields[field] !== 1) {
      addIssue(
        issues,
        'map.layer-transform',
        `${path}.${field}`,
        `Обязательный слой ${layer.name} не должен использовать parallax`,
      );
    }
  }
}

function layerAt(
  map: TiledMap,
  name: string,
  type: TiledLayer['type'],
  issues: ValidationIssue[],
): { layer: TiledLayer; index: number } | undefined {
  const matches = map.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.name === name);
  if (matches.length === 0) {
    addIssue(
      issues,
      'map.layer-missing',
      '$.layers',
      `Обязательный слой ${name} отсутствует`,
    );
    return undefined;
  }
  if (matches.length > 1) {
    addIssue(
      issues,
      'map.duplicate-layer',
      `$.layers[${matches[1]?.index ?? 0}].name`,
      `Слой ${name} указан повторно`,
    );
  }

  const match = matches[0];
  if (match === undefined || match.layer.type !== type) {
    addIssue(
      issues,
      'map.layer-type',
      `$.layers[${match?.index ?? 0}].type`,
      `Слой ${name} должен иметь type=${type}`,
    );
    return undefined;
  }
  return match;
}

function validateHeader(map: TiledMap, issues: ValidationIssue[]): void {
  const checks: Array<[boolean, string, string]> = [
    [
      map.orientation === 'orthogonal',
      '$.orientation',
      'orientation=orthogonal',
    ],
    [
      map.renderorder === 'right-down',
      '$.renderorder',
      'renderorder=right-down',
    ],
    [map.infinite === false, '$.infinite', 'Карта должна быть finite'],
    [map.tilewidth === 64, '$.tilewidth', 'tilewidth должен быть 64'],
    [map.tileheight === 64, '$.tileheight', 'tileheight должен быть 64'],
  ];
  for (const [valid, path, message] of checks) {
    if (!valid) addIssue(issues, 'map.header', path, message);
  }
  if ((map.properties?.length ?? 0) > 0) {
    addIssue(
      issues,
      'map.map-property',
      '$.properties',
      'Игровые коэффициенты в свойствах map запрещены',
    );
  }
}

function validateLayerCatalog(
  map: TiledMap,
  issues: ValidationIssue[],
): Array<{ layer: TiledLayer; index: number } | undefined> {
  const allowedNames = new Set([
    ...requiredLayers.map(([name]) => name),
    'decorations',
  ]);
  const firstLayerIndexById = new Map<number, number>();
  rejectScriptField(map, '$', issues);
  map.layers.forEach((layer, index) => {
    rejectScriptField(layer, `$.layers[${index}]`, issues);
    if (layer.type === 'objectgroup') {
      layer.objects.forEach((object, objectIndex) =>
        rejectScriptField(
          object,
          `$.layers[${index}].objects[${objectIndex}]`,
          issues,
        ),
      );
    }
    if (!allowedNames.has(layer.name)) {
      addIssue(
        issues,
        'map.unknown-layer',
        `$.layers[${index}].name`,
        `Неизвестный слой ${layer.name}`,
      );
    }
    const firstIndex = firstLayerIndexById.get(layer.id);
    if (firstIndex === undefined) firstLayerIndexById.set(layer.id, index);
    else {
      addIssue(
        issues,
        'map.duplicate-layer-id',
        `$.layers[${index}].id`,
        `Layer id уже используется в layer ${firstIndex}`,
      );
    }
  });

  const located = requiredLayers.map(([name, type]) =>
    layerAt(map, name, type, issues),
  );
  located.forEach((item) => {
    if (item !== undefined) {
      validateRequiredLayerPresentation(item.layer, item.index, issues);
    }
  });
  const indices = located.map((item) => item?.index ?? -1);
  if (indices.every((index) => index >= 0)) {
    for (let index = 1; index < indices.length; index += 1) {
      if ((indices[index - 1] ?? 0) >= (indices[index] ?? 0)) {
        addIssue(
          issues,
          'map.layer-order',
          '$.layers',
          'Обязательные слои должны идти в контрактном порядке',
        );
        break;
      }
    }
  }

  const decorations = map.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.name === 'decorations');
  if (decorations.length > 1) {
    addIssue(
      issues,
      'map.duplicate-layer',
      `$.layers[${decorations[1]?.index ?? 0}].name`,
      'Слой decorations указан повторно',
    );
  }
  const decoration = decorations[0];
  if (
    decoration !== undefined &&
    !['tilelayer', 'objectgroup'].includes(decoration.layer.type)
  ) {
    addIssue(
      issues,
      'map.layer-type',
      `$.layers[${decoration.index}].type`,
      'decorations может быть только tilelayer или objectgroup',
    );
  }
  const objects = located[4];
  if (
    decoration !== undefined &&
    objects !== undefined &&
    decoration.index < objects.index
  ) {
    addIssue(
      issues,
      'map.layer-order',
      `$.layers[${decoration.index}]`,
      'decorations должен находиться над objects',
    );
  }
  return located;
}

export function validateTiledStructure(
  map: TiledMap,
  incidents?: IncidentProfiles,
): { issues: ValidationIssue[]; model?: TiledValidationModel } {
  const issues: ValidationIssue[] = [];
  validateHeader(map, issues);
  const located = validateLayerCatalog(map, issues);

  const background = located[0];
  if (
    background?.layer.type === 'imagelayer' &&
    (background.layer.properties?.length ?? 0) > 0
  ) {
    addIssue(
      issues,
      'map.layer-property',
      `$.layers[${background.index}].properties`,
      'Игровые коэффициенты в свойствах background запрещены',
    );
  }
  if (
    background?.layer.type === 'imagelayer' &&
    (!isLocalAssetPath(background.layer.image) ||
      !/\.webp$/i.test(background.layer.image))
  ) {
    addIssue(
      issues,
      'map.background-asset',
      `$.layers[${background.index}].image`,
      'Background должен быть локальным WebP',
    );
  }

  const definitions = buildTileDefinitions(map, incidents, issues);
  map.tilesets.forEach((tileset, tilesetIndex) => {
    rejectScriptField(tileset, `$.tilesets[${tilesetIndex}]`, issues);
    tileset.tiles?.forEach((tile, tileIndex) =>
      rejectScriptField(
        tile,
        `$.tilesets[${tilesetIndex}].tiles[${tileIndex}]`,
        issues,
      ),
    );
  });
  for (const item of located.slice(1, 4)) {
    if (item?.layer.type === 'tilelayer') {
      validateTileLayer(map, item.layer, item.index, definitions, issues);
    }
  }
  const decoration = map.layers
    .map((layer, index) => ({ layer, index }))
    .find(({ layer }) => layer.name === 'decorations');
  if (decoration?.layer.type === 'tilelayer') {
    validateTileLayer(
      map,
      decoration.layer,
      decoration.index,
      definitions,
      issues,
    );
  }
  if (
    decoration?.layer.type === 'objectgroup' &&
    (decoration.layer.properties?.length ?? 0) > 0
  ) {
    addIssue(
      issues,
      'map.layer-property',
      `$.layers[${decoration.index}].properties`,
      'Игровые коэффициенты в properties decorations запрещены',
    );
  }
  if (decoration?.layer.type === 'objectgroup') {
    decoration.layer.objects.forEach((object, objectIndex) => {
      if ((object.properties?.length ?? 0) > 0) {
        addIssue(
          issues,
          'map.object-property',
          `$.layers[${decoration.index}].objects[${objectIndex}].properties`,
          'Неописанные properties декоративных объектов запрещены',
        );
      }
    });
  }

  const terrain = located[1];
  const hazards = located[2];
  const obstacles = located[3];
  const objects = located[4];
  if (
    terrain?.layer.type !== 'tilelayer' ||
    hazards?.layer.type !== 'tilelayer' ||
    obstacles?.layer.type !== 'tilelayer' ||
    objects?.layer.type !== 'objectgroup' ||
    terrain.layer.data.length !== map.width * map.height ||
    hazards.layer.data.length !== map.width * map.height ||
    obstacles.layer.data.length !== map.width * map.height
  ) {
    return { issues };
  }

  const obstacleData = obstacles.layer.data;
  const blocked = terrain.layer.data.map((rawGid, index) => {
    const semantics = definitions.get(rawGid & 0x0fffffff);
    return semantics?.walkable !== true || obstacleData[index] !== 0;
  });
  const hazardous = hazards.layer.data.map((gid) => gid !== 0);
  return {
    issues,
    model: {
      grid: { width: map.width, height: map.height, blocked, hazardous },
      objectLayer: objects.layer,
      objectLayerIndex: objects.index,
      hazardLayerIndex: hazards.index,
      terrainLayerIndex: terrain.index,
    },
  };
}
