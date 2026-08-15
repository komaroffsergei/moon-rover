import type { IncidentProfiles } from '../schemas/incidents';
import type { TiledMap, TiledTileLayer, TiledTileset } from '../schemas/tiled';
import type { ValidationIssue } from './issues';
import { isLocalAssetPath } from './localAssetPath';

export interface TileSemantics {
  terrainType: 'normal' | 'rough' | 'blocked';
  walkable: boolean;
  movementCost: number;
  hazardProfileId?: string;
}

const TILED_GID_VALUE_MASK = 0x0fffffff;

/** Снимает все transform flags Tiled, сохраняя global tile ID. */
export function decodeTiledGid(rawGid: number): number {
  return rawGid & TILED_GID_VALUE_MASK;
}

function addIssue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function propertyRecord(
  properties:
    | ReadonlyArray<{
        name: string;
        value: string | number | boolean;
      }>
    | undefined,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    (properties ?? []).map(({ name, value }) => [name, value]),
  );
}

function parseTileSemantics(
  tilesetIndex: number,
  tileIndex: number,
  properties:
    | ReadonlyArray<{
        name: string;
        value: string | number | boolean;
      }>
    | undefined,
  incidents: IncidentProfiles | undefined,
  issues: ValidationIssue[],
): TileSemantics | undefined {
  const path = `$.tilesets[${tilesetIndex}].tiles[${tileIndex}].properties`;
  const values = propertyRecord(properties);
  const allowed = new Set([
    'terrainType',
    'walkable',
    'movementCost',
    'hazardProfileId',
  ]);
  const propertyNames = new Set<string>();

  for (const property of properties ?? []) {
    if (propertyNames.has(property.name)) {
      addIssue(
        issues,
        'map.tile-property',
        path,
        `Свойство тайла ${property.name} указано повторно`,
      );
    }
    propertyNames.add(property.name);
  }
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) {
      addIssue(
        issues,
        'map.tile-property',
        path,
        `Неизвестное игровое свойство тайла ${name}`,
      );
    }
  }

  const terrainType = values.terrainType;
  const walkable = values.walkable;
  const movementCost = values.movementCost;
  const hazardProfileId = values.hazardProfileId;
  const validTerrain =
    terrainType === 'normal' ||
    terrainType === 'rough' ||
    terrainType === 'blocked';

  if (!validTerrain || typeof walkable !== 'boolean') {
    addIssue(
      issues,
      'map.tile-property',
      path,
      'Тайлу нужны terrainType и boolean walkable',
    );
    return undefined;
  }
  if (typeof movementCost !== 'number' || movementCost <= 0) {
    addIssue(
      issues,
      'map.tile-property',
      path,
      'movementCost должен быть положительным числом',
    );
    return undefined;
  }
  if ((terrainType === 'blocked') === walkable) {
    addIssue(
      issues,
      'map.tile-property',
      path,
      'terrainType и walkable задают противоречивую проходимость',
    );
  }
  if (hazardProfileId !== undefined && typeof hazardProfileId !== 'string') {
    addIssue(
      issues,
      'map.tile-property',
      path,
      'hazardProfileId должен быть строкой',
    );
    return undefined;
  }
  if (hazardProfileId === 'normal') {
    addIssue(
      issues,
      'map.hazard-profile-kind',
      path,
      'Hazard tile не может ссылаться на normal incident profile',
    );
  }
  if (
    typeof hazardProfileId === 'string' &&
    incidents !== undefined &&
    !incidents.profiles.some(({ id }) => id === hazardProfileId)
  ) {
    addIssue(
      issues,
      'map.hazard-profile-reference',
      path,
      `Профиль инцидентов ${hazardProfileId} не найден`,
    );
  }

  return {
    terrainType,
    walkable,
    movementCost,
    ...(typeof hazardProfileId === 'string' ? { hazardProfileId } : {}),
  };
}

function addEmbeddedTileset(
  tileset: TiledTileset,
  index: number,
  incidents: IncidentProfiles | undefined,
  definitions: Map<number, TileSemantics>,
  issues: ValidationIssue[],
): void {
  const path = `$.tilesets[${index}]`;
  if ((tileset.properties?.length ?? 0) > 0) {
    addIssue(
      issues,
      'map.tileset-property',
      `${path}.properties`,
      'Игровые коэффициенты в свойствах tileset запрещены',
    );
  }
  if (tileset.source !== undefined) {
    addIssue(
      issues,
      'map.external-tileset',
      `${path}.source`,
      'Внешний tileset source запрещён',
    );
    return;
  }
  if (
    tileset.name === undefined ||
    tileset.tilewidth !== 64 ||
    tileset.tileheight !== 64 ||
    tileset.tilecount === undefined ||
    tileset.columns === undefined ||
    tileset.image === undefined ||
    tileset.imagewidth === undefined ||
    tileset.imageheight === undefined ||
    tileset.tiles === undefined
  ) {
    addIssue(
      issues,
      'map.tileset-structure',
      path,
      'Embedded tileset должен содержать геометрию, image и tiles',
    );
    return;
  }
  if (!isLocalAssetPath(tileset.image)) {
    addIssue(
      issues,
      'map.external-asset',
      `${path}.image`,
      'Tileset image должен быть локальным',
    );
  }

  const margin = tileset.margin ?? 0;
  const spacing = tileset.spacing ?? 0;
  const rowCount = Math.ceil(tileset.tilecount / tileset.columns);
  const expectedImageWidth =
    margin * 2 +
    tileset.columns * tileset.tilewidth +
    (tileset.columns - 1) * spacing;
  const expectedImageHeight =
    margin * 2 + rowCount * tileset.tileheight + (rowCount - 1) * spacing;
  if (
    tileset.imagewidth !== expectedImageWidth ||
    tileset.imageheight !== expectedImageHeight
  ) {
    addIssue(
      issues,
      'map.tileset-image-size',
      path,
      `Размер atlas ${tileset.imagewidth}x${tileset.imageheight} не соответствует ` +
        `${tileset.tilecount} тайлам ${tileset.tilewidth}x${tileset.tileheight} ` +
        `(ожидается ${expectedImageWidth}x${expectedImageHeight})`,
    );
  }

  tileset.tiles.forEach((tile, tileIndex) => {
    const semantics = parseTileSemantics(
      index,
      tileIndex,
      tile.properties,
      incidents,
      issues,
    );
    if (semantics === undefined) return;

    const gid = tileset.firstgid + tile.id;
    if (definitions.has(gid)) {
      addIssue(
        issues,
        'map.duplicate-gid',
        `${path}.tiles[${tileIndex}].id`,
        `Global GID ${gid} уже определён другим tileset`,
      );
    } else {
      definitions.set(gid, semantics);
    }
  });
}

export function buildTileDefinitions(
  map: TiledMap,
  incidents: IncidentProfiles | undefined,
  issues: ValidationIssue[],
): ReadonlyMap<number, TileSemantics> {
  const definitions = new Map<number, TileSemantics>();
  map.tilesets.forEach((tileset, index) =>
    addEmbeddedTileset(tileset, index, incidents, definitions, issues),
  );
  return definitions;
}

export function validateTileLayer(
  map: TiledMap,
  layer: TiledTileLayer,
  index: number,
  definitions: ReadonlyMap<number, TileSemantics>,
  issues: ValidationIssue[],
): void {
  const path = `$.layers[${index}]`;
  if (layer.width !== map.width || layer.height !== map.height) {
    addIssue(
      issues,
      'map.layer-size',
      path,
      `${layer.name} должен совпадать с размером карты`,
    );
  }
  if (layer.data.length !== map.width * map.height) {
    addIssue(
      issues,
      'map.layer-data-size',
      `${path}.data`,
      `${layer.name} должен содержать width × height GID`,
    );
  }
  if ((layer.properties?.length ?? 0) > 0) {
    addIssue(
      issues,
      'map.layer-property',
      `${path}.properties`,
      'Игровые коэффициенты в свойствах слоя запрещены',
    );
  }

  layer.data.forEach((rawGid, cellIndex) => {
    const gid = decodeTiledGid(rawGid);
    if (gid === 0) {
      if (layer.name === 'terrain') {
        addIssue(
          issues,
          'map.terrain-empty',
          `${path}.data[${cellIndex}]`,
          'Каждая клетка terrain должна иметь тайл',
        );
      }
      return;
    }

    const semantics = definitions.get(gid);
    if (semantics === undefined) {
      addIssue(
        issues,
        'map.unknown-gid',
        `${path}.data[${cellIndex}]`,
        `GID ${gid} не описан embedded tileset`,
      );
      return;
    }
    if (layer.name === 'hazards' && semantics.hazardProfileId === undefined) {
      addIssue(
        issues,
        'map.hazard-profile-missing',
        `${path}.data[${cellIndex}]`,
        `Hazard GID ${gid} не содержит hazardProfileId`,
      );
    }
    if (layer.name === 'obstacles' && semantics.walkable) {
      addIssue(
        issues,
        'map.obstacle-walkable',
        `${path}.data[${cellIndex}]`,
        `Obstacle GID ${gid} должен быть blocked`,
      );
    }
  });
}
