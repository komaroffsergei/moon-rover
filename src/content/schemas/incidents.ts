import { z } from 'zod';

import {
  addUniqueIdCheck,
  kebabCaseIdSchema,
  schemaVersionSchema,
} from './common';

const incidentProfileSchema = z
  .object({
    id: kebabCaseIdSchema,
    cellChance: z.number().min(0).max(1),
    weights: z
      .object({
        dustStorm: z.number().min(0),
        meteorite: z.number().min(0),
        crater: z.number().min(0),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ weights }) => {
      const total = weights.dustStorm + weights.meteorite + weights.crater;
      return Number.isFinite(total) && total > 0;
    },
    { message: 'Сумма weights должна быть положительной', path: ['weights'] },
  );

export const incidentProfilesSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    rules: z
      .object({
        dustStormGameMinutes: z.literal(10),
        selfRepairGameMinutes: z.literal(10),
      })
      .strict(),
    profiles: z
      .array(incidentProfileSchema)
      .min(1)
      .superRefine(addUniqueIdCheck)
      .refine((profiles) => profiles.some(({ id }) => id === 'normal'), {
        message: 'Нужен обязательный profile normal',
      }),
  })
  .strict();

export type IncidentProfiles = z.infer<typeof incidentProfilesSchema>;
