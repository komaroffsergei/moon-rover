import { z } from 'zod';

import {
  addUniqueIdCheck,
  kebabCaseIdSchema,
  schemaVersionSchema,
} from './common';

const roverArchetypeSchema = z
  .object({
    id: kebabCaseIdSchema,
    cargoCapacity: z.number().min(0),
    batteryCapacity: z.number().min(1),
    gameMinutesPerNormalCell: z.number().min(0.5),
    batteryCostMultiplier: z.number().min(0.1),
  })
  .strict();

export const balanceSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    time: z
      .object({
        gameMinutesPerRealSecond: z.literal(1),
        fixedStepMilliseconds: z.literal(100),
        shiftRealSeconds: z.literal(480),
      })
      .strict(),
    center: z
      .object({
        warningThreshold: z.literal(20),
        recoveryGameMinutes: z.literal(30),
        radioThresholds: z.tuple([
          z.literal(50),
          z.literal(25),
          z.literal(10),
          z.literal(5),
          z.literal(1),
        ]),
        recoveryRadioThresholds: z.tuple([
          z.literal(20),
          z.literal(10),
          z.literal(5),
          z.literal(1),
        ]),
        equipmentCapacity: z.literal(100),
        equipmentDemand: z
          .object({
            firstEligibleGameMinute: z.literal(30),
            minimumIntervalGameMinutes: z.literal(45),
            lossMin: z.literal(20),
            lossMax: z.literal(40),
          })
          .strict(),
      })
      .strict(),
    routing: z
      .object({
        eventCooldownCells: z.literal(3),
        routeWeights: z
          .object({
            movementCost: z.number().positive(),
            incidentRisk: z.number().min(0),
          })
          .strict(),
      })
      .strict(),
    incidents: z
      .object({
        normalCellChance: z.number().min(0.005).max(0.01),
        hazardCellChanceMin: z.number().min(0.08).max(0.16),
        hazardCellChanceMax: z.number().min(0.08).max(0.16),
      })
      .strict(),
    rescue: z
      .object({
        repairGameMinutes: z.literal(5),
        craterRescueGameMinutes: z.literal(3),
      })
      .strict(),
    roverArchetypes: z
      .array(roverArchetypeSchema)
      .min(4)
      .superRefine(addUniqueIdCheck),
  })
  .strict();

export type Balance = z.infer<typeof balanceSchema>;
