import { z } from 'zod';

import { kebabCaseIdSchema, schemaVersionSchema } from './common';
import { isLocalAssetPath } from '../validation/localAssetPath';

const localAssetPathSchema = z
  .string()
  .min(1)
  .refine(isLocalAssetPath, 'Ассет должен использовать локальный путь');

export const themeSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    id: kebabCaseIdSchema,
    backgroundAsset: localAssetPathSchema,
    colors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
    assets: z.record(z.string(), localAssetPathSchema),
  })
  .strict();

export type Theme = z.infer<typeof themeSchema>;
