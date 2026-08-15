import { z } from 'zod';

import {
  addUniqueIdCheck,
  kebabCaseIdSchema,
  schemaVersionSchema,
} from './common';

const resourceSchema = z
  .object({
    initial: z.number().gt(0).max(100),
    capacity: z.literal(100),
    depletionGameMinutes: z.number().min(180).max(480),
  })
  .strict();

const centerSchema = z
  .object({
    id: kebabCaseIdSchema,
    name: z.string(),
    oxygen: resourceSchema,
    food: resourceSchema,
    equipmentInitial: z.number().gt(0).max(100),
  })
  .strict();

const roverSchema = z
  .object({
    id: kebabCaseIdSchema,
    name: z.string(),
    archetypeId: z.enum(['fast', 'standard', 'heavy', 'repair']),
    spawnObjectId: kebabCaseIdSchema,
  })
  .strict();

const facilityCellSchema = z
  .object({
    column: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
  })
  .strict();

const facilityLayoutSchema = z
  .object({
    id: kebabCaseIdSchema,
    baseCell: facilityCellSchema,
    centers: z.record(kebabCaseIdSchema, facilityCellSchema),
  })
  .strict();

const levelBalanceByOrdinal = [
  undefined,
  {
    centerCount: 2,
    courierCount: 2,
    repairCount: 1,
    riskLevel: 'low',
    riskChoiceCenterCount: 1,
  },
  {
    centerCount: 3,
    courierCount: 2,
    repairCount: 1,
    riskLevel: 'medium',
    riskChoiceCenterCount: 2,
  },
  {
    centerCount: 4,
    courierCount: 3,
    repairCount: 1,
    riskLevel: 'high',
    riskChoiceCenterCount: 3,
  },
  {
    centerCount: 5,
    courierCount: 4,
    repairCount: 1,
    riskLevel: 'extreme',
    riskChoiceCenterCount: 3,
  },
  {
    centerCount: 6,
    courierCount: 5,
    repairCount: 1,
    riskLevel: 'maximum',
    riskChoiceCenterCount: 3,
  },
] as const;

export const levelMetaSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    ordinal: z.number().int().min(1).max(5),
    id: kebabCaseIdSchema,
    title: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    tiledMap: z.string().regex(/\.tmj$/),
    themeId: kebabCaseIdSchema,
    balanceProfileId: kebabCaseIdSchema,
    seed: z.string().min(1),
    shiftDurationRealSeconds: z.literal(480),
    riskLevel: z.enum(['low', 'medium', 'high', 'extreme', 'maximum']),
    centers: z.array(centerSchema).min(2).max(6).superRefine(addUniqueIdCheck),
    facilityLayouts: z
      .array(facilityLayoutSchema)
      .min(3)
      .max(12)
      .superRefine(addUniqueIdCheck),
    rovers: z.array(roverSchema).min(3).max(9).superRefine(addUniqueIdCheck),
    riskChoiceCenters: z.array(kebabCaseIdSchema),
    seededEquipmentDemandCenterIds: z.array(kebabCaseIdSchema).min(1).max(5),
  })
  .strict()
  .superRefine((level, context) => {
    const balance = levelBalanceByOrdinal[level.ordinal];
    if (balance === undefined) return;

    if (level.centers.length !== balance.centerCount) {
      context.addIssue({
        code: 'custom',
        message: `Для уровня ${level.ordinal} требуется ${balance.centerCount} центров`,
        path: ['centers'],
      });
    }

    const courierCount = level.rovers.filter(
      ({ archetypeId }) => archetypeId !== 'repair',
    ).length;
    if (courierCount !== balance.courierCount) {
      context.addIssue({
        code: 'custom',
        message: `Для уровня ${level.ordinal} требуется ${balance.courierCount} курьеров`,
        path: ['rovers'],
      });
    }

    const repairCount = level.rovers.filter(
      ({ archetypeId }) => archetypeId === 'repair',
    ).length;
    if (repairCount !== balance.repairCount) {
      context.addIssue({
        code: 'custom',
        message: 'На уровне должен быть ровно один ремонтный ровер',
        path: ['rovers'],
      });
    }

    if (level.riskLevel !== balance.riskLevel) {
      context.addIssue({
        code: 'custom',
        message: `Уровню ${level.ordinal} соответствует риск ${balance.riskLevel}`,
        path: ['riskLevel'],
      });
    }

    if (level.riskChoiceCenters.length !== balance.riskChoiceCenterCount) {
      context.addIssue({
        code: 'custom',
        message: `Для уровня ${level.ordinal} требуется ${balance.riskChoiceCenterCount} risk-choice центров`,
        path: ['riskChoiceCenters'],
      });
    }

    const spawnIds = new Map<string, number>();
    level.rovers.forEach((rover, index) => {
      const firstIndex = spawnIds.get(rover.spawnObjectId);
      if (firstIndex === undefined) {
        spawnIds.set(rover.spawnObjectId, index);
      } else {
        context.addIssue({
          code: 'custom',
          message: `spawnObjectId уже используется ровером ${firstIndex}`,
          path: ['rovers', index, 'spawnObjectId'],
        });
      }
    });

    const centerIds = new Set(level.centers.map(({ id }) => id));
    level.facilityLayouts.forEach((layout, layoutIndex) => {
      const layoutCenterIds = Object.keys(layout.centers);
      for (const centerId of centerIds) {
        if (!(centerId in layout.centers)) {
          context.addIssue({
            code: 'custom',
            message: `Раскладка ${layout.id} не содержит center ${centerId}`,
            path: ['facilityLayouts', layoutIndex, 'centers'],
          });
        }
      }
      layoutCenterIds.forEach((centerId) => {
        if (!centerIds.has(centerId)) {
          context.addIssue({
            code: 'custom',
            message: `Раскладка ${layout.id} содержит неизвестный center ${centerId}`,
            path: ['facilityLayouts', layoutIndex, 'centers', centerId],
          });
        }
      });

      const occupied = new Map<string, string>();
      const cells = [
        ['base', layout.baseCell] as const,
        ...Object.entries(layout.centers),
      ];
      cells.forEach(([entityId, cell]) => {
        const key = `${cell.column}:${cell.row}`;
        const firstEntityId = occupied.get(key);
        if (firstEntityId !== undefined) {
          context.addIssue({
            code: 'custom',
            message: `${entityId} совпадает с ${firstEntityId} в раскладке ${layout.id}`,
            path: ['facilityLayouts', layoutIndex],
          });
        } else {
          occupied.set(key, entityId);
        }
      });
    });

    const riskIds = new Set<string>();
    level.riskChoiceCenters.forEach((id, index) => {
      if (riskIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Risk-choice центр ${id} указан повторно`,
          path: ['riskChoiceCenters', index],
        });
      }
      riskIds.add(id);

      if (!centerIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Risk-choice центр ${id} отсутствует в centers`,
          path: ['riskChoiceCenters', index],
        });
      }
    });

    if (level.seededEquipmentDemandCenterIds.length !== level.ordinal) {
      context.addIssue({
        code: 'custom',
        message: `Для уровня ${level.ordinal} требуется ${level.ordinal} equipment demand центров`,
        path: ['seededEquipmentDemandCenterIds'],
      });
    }

    const equipmentDemandIds = new Set<string>();
    level.seededEquipmentDemandCenterIds.forEach((id, index) => {
      if (equipmentDemandIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Equipment demand центр ${id} указан повторно`,
          path: ['seededEquipmentDemandCenterIds', index],
        });
      }
      equipmentDemandIds.add(id);

      if (!centerIds.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Equipment demand центр ${id} отсутствует в centers`,
          path: ['seededEquipmentDemandCenterIds', index],
        });
      }
    });
  });

export type LevelMeta = z.infer<typeof levelMetaSchema>;
export type FacilityLayout = LevelMeta['facilityLayouts'][number];
