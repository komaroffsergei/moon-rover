import type { RoutingMap } from '../domain';
import type { IncidentProfiles } from './schemas/incidents';
import type { TiledMap, TiledTileLayer } from './schemas/tiled';
import {
  buildTileDefinitions,
  decodeTiledGid,
} from './validation/validateTiledTiles';

interface RoutingMapContent {
  map: TiledMap;
  incidents: IncidentProfiles;
  normalCellChance: number;
}

function requiredTileLayer(map: TiledMap, name: string): TiledTileLayer {
  const layer = map.layers.find(
    (candidate) => candidate.type === 'tilelayer' && candidate.name === name,
  );
  if (layer?.type !== 'tilelayer') {
    throw new Error(`Validated map не содержит ${name} layer`);
  }
  return layer;
}

export function createRoutingMapFromContent({
  map,
  incidents,
  normalCellChance,
}: RoutingMapContent): RoutingMap {
  const issues: Array<{ code: string; path: string; message: string }> = [];
  const definitions = buildTileDefinitions(map, incidents, issues);
  if (issues.length > 0) {
    throw new Error('Validated map содержит некорректные tile definitions');
  }

  const terrain = requiredTileLayer(map, 'terrain');
  const obstacles = requiredTileLayer(map, 'obstacles');
  const hazards = requiredTileLayer(map, 'hazards');
  const normalProfile = incidents.profiles.find(({ id }) => id === 'normal');
  if (normalProfile === undefined) {
    throw new Error('Validated incidents не содержит normal profile');
  }
  const cellCount = map.width * map.height;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const terrainGid = decodeTiledGid(terrain.data[index]!);
    const obstacleGid = decodeTiledGid(obstacles.data[index]!);
    const hazardGid = decodeTiledGid(hazards.data[index]!);
    const terrainSemantics = definitions.get(terrainGid);
    if (terrainSemantics === undefined) {
      throw new Error(`Validated terrain не содержит GID для клетки ${index}`);
    }

    let incidentProfileId = normalProfile.id;
    let effectiveCellChance = normalCellChance;
    if (hazardGid !== 0) {
      const hazardProfileId = definitions.get(hazardGid)?.hazardProfileId;
      const profile = incidents.profiles.find(
        ({ id }) => id === hazardProfileId,
      );
      if (profile === undefined) {
        throw new Error(
          `Validated hazard не содержит профиль для клетки ${index}`,
        );
      }
      incidentProfileId = profile.id;
      effectiveCellChance = profile.cellChance;
    }

    return {
      walkable: terrainSemantics.walkable && obstacleGid === 0,
      movementCost: terrainSemantics.movementCost,
      effectiveCellChance,
      incidentProfileId,
    };
  });

  return { width: map.width, height: map.height, cells };
}
