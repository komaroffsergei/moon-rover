import { z } from 'zod';

import { balanceSchema, type Balance } from '../schemas/balance';
import {
  incidentProfilesSchema,
  type IncidentProfiles,
} from '../schemas/incidents';
import { levelMetaSchema, type LevelMeta } from '../schemas/levelMeta';
import { radioContentSchema, type RadioContent } from '../schemas/radio';
import { themeSchema, type Theme } from '../schemas/theme';
import { tiledMapSchema, type TiledMap } from '../schemas/tiled';
import {
  ContentValidationError,
  type ValidationIssue,
  zodIssues,
} from '../validation/issues';
import {
  validateTiledMap,
  type TiledValidationReferences,
} from '../validation/validateTiledMap';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVersioned<T>(
  source: string,
  schema: z.ZodType<T>,
  input: unknown,
): T {
  if (
    isRecord(input) &&
    'schemaVersion' in input &&
    input.schemaVersion !== 1
  ) {
    throw new ContentValidationError(source, [
      {
        code: 'schema.unsupported-version',
        path: '$.schemaVersion',
        message: `Поддерживается schemaVersion=1, получено ${String(input.schemaVersion)}`,
      },
    ]);
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContentValidationError(source, zodIssues(result.error));
  }
  return result.data;
}

export function parseJsonText(text: string, source = 'JSON'): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ContentValidationError(source, [
      {
        code: 'json.invalid',
        path: '$',
        message:
          error instanceof Error ? error.message : 'Некорректный JSON-документ',
      },
    ]);
  }
}

export const loadBalance = (input: unknown): Balance =>
  parseVersioned('balance', balanceSchema, input);

export const loadIncidentProfiles = (input: unknown): IncidentProfiles =>
  parseVersioned('incident-profiles', incidentProfilesSchema, input);

export const loadLevelMeta = (input: unknown): LevelMeta =>
  parseVersioned('level-meta', levelMetaSchema, input);

export const loadRadioContent = (input: unknown): RadioContent =>
  parseVersioned('radio', radioContentSchema, input);

export const loadTheme = (input: unknown): Theme =>
  parseVersioned('theme', themeSchema, input);

export function loadTiledMap(
  input: unknown,
  references: TiledValidationReferences = {},
): TiledMap {
  const result = tiledMapSchema.safeParse(input);
  if (!result.success) {
    throw new ContentValidationError('tiled-map', zodIssues(result.error));
  }

  const issues = validateTiledMap(result.data, references);
  if (issues.length > 0) {
    throw new ContentValidationError('tiled-map', issues);
  }
  return result.data;
}

export interface ContentBundleInput {
  balance: unknown;
  balanceProfileId: string;
  incidents: unknown;
  levelMeta: unknown;
  map: unknown;
  radio: unknown;
  theme: unknown;
}

export interface ContentBundle {
  balance: Balance;
  incidents: IncidentProfiles;
  levelMeta: LevelMeta;
  map: TiledMap;
  radio: RadioContent;
  theme: Theme;
}

function bundleReferenceIssues(
  bundle: ContentBundle,
  balanceProfileId: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const normalProfile = bundle.incidents.profiles.find(
    ({ id }) => id === 'normal',
  );
  if (
    normalProfile !== undefined &&
    normalProfile.cellChance !== bundle.balance.incidents.normalCellChance
  ) {
    issues.push({
      code: 'content.normal-incident-chance',
      path: '$.incidents.profiles',
      message:
        'Chance профиля normal должен совпадать с balance normalCellChance',
    });
  }
  bundle.incidents.profiles.forEach((profile, index) => {
    if (
      profile.id !== 'normal' &&
      (profile.cellChance < bundle.balance.incidents.hazardCellChanceMin ||
        profile.cellChance > bundle.balance.incidents.hazardCellChanceMax)
    ) {
      issues.push({
        code: 'content.hazard-incident-chance',
        path: `$.incidents.profiles[${index}].cellChance`,
        message: `Chance профиля ${profile.id} вне balance hazard range`,
      });
    }
  });
  if (bundle.levelMeta.themeId !== bundle.theme.id) {
    issues.push({
      code: 'content.theme-reference',
      path: '$.levelMeta.themeId',
      message: `Theme ${bundle.levelMeta.themeId} не совпадает с ${bundle.theme.id}`,
    });
  }
  const background = bundle.map.layers.find(
    (layer) => layer.name === 'background' && layer.type === 'imagelayer',
  );
  if (
    background?.type === 'imagelayer' &&
    bundle.theme.backgroundAsset !== background.image
  ) {
    issues.push({
      code: 'content.background-asset-reference',
      path: '$.theme.backgroundAsset',
      message: `Theme background ${bundle.theme.backgroundAsset} не совпадает с Tiled background ${background.image}`,
    });
  }
  if (bundle.levelMeta.balanceProfileId !== balanceProfileId) {
    issues.push({
      code: 'content.balance-reference',
      path: '$.levelMeta.balanceProfileId',
      message: `Balance profile ${bundle.levelMeta.balanceProfileId} не совпадает с загруженным ${balanceProfileId}`,
    });
  }

  const archetypes = new Set(
    bundle.balance.roverArchetypes.map(({ id }) => id),
  );
  bundle.levelMeta.rovers.forEach((rover, index) => {
    if (!archetypes.has(rover.archetypeId)) {
      issues.push({
        code: 'content.archetype-reference',
        path: `$.levelMeta.rovers[${index}].archetypeId`,
        message: `Archetype ${rover.archetypeId} отсутствует в balance`,
      });
    }
  });
  return issues;
}

export function loadContentBundle(input: ContentBundleInput): ContentBundle {
  const withoutMap = {
    balance: loadBalance(input.balance),
    incidents: loadIncidentProfiles(input.incidents),
    levelMeta: loadLevelMeta(input.levelMeta),
    radio: loadRadioContent(input.radio),
    theme: loadTheme(input.theme),
  };
  const map = loadTiledMap(input.map, {
    incidents: withoutMap.incidents,
    levelMeta: withoutMap.levelMeta,
    levelOrdinal: withoutMap.levelMeta.ordinal,
    validateZoneDesign: true,
  });
  const bundle = { ...withoutMap, map };
  const referenceIssues = bundleReferenceIssues(bundle, input.balanceProfileId);
  if (referenceIssues.length > 0) {
    throw new ContentValidationError('content-bundle', referenceIssues);
  }
  return bundle;
}
