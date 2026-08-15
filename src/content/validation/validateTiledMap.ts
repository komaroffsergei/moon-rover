import type { IncidentProfiles } from '../schemas/incidents';
import type { LevelMeta } from '../schemas/levelMeta';
import type { TiledMap } from '../schemas/tiled';
import type { ValidationIssue } from './issues';
import { validateHazardZones } from './validateHazardZones';
import { validateTiledStructure } from './validateTiledStructure';
import { validateTiledWorld } from './validateTiledWorld';

export interface TiledValidationReferences {
  incidents?: IncidentProfiles;
  levelMeta?: LevelMeta;
  levelOrdinal?: number;
  validateZoneDesign?: boolean;
}

export function validateTiledMap(
  map: TiledMap,
  references: TiledValidationReferences = {},
): ValidationIssue[] {
  const result = validateTiledStructure(map, references.incidents);
  if (result.model === undefined) return result.issues;

  return [
    ...result.issues,
    ...validateTiledWorld(result.model, references.levelMeta),
    ...(references.validateZoneDesign === true
      ? validateHazardZones(
          result.model.grid,
          references.levelOrdinal,
          result.model.hazardLayerIndex,
        )
      : []),
  ];
}
