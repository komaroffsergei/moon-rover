import { z } from 'zod';

import type { GridCell, IncidentWeights, SimulationConfig } from '../../domain';

const positiveNumber = z.number().finite().positive();
const nonNegativeNumber = z.number().finite().nonnegative();

const cargoSchema = z
  .object({
    oxygen: nonNegativeNumber,
    food: nonNegativeNumber,
    equipment: nonNegativeNumber,
  })
  .strict();

const cellReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BASE') }).strict(),
  z
    .object({
      kind: z.literal('CENTER'),
      centerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('CELL'),
      column: z.number().int().nonnegative(),
      row: z.number().int().nonnegative(),
    })
    .strict(),
]);

const resourceOverrideSchema = z
  .object({
    initial: positiveNumber.optional(),
    depletionGameMinutes: positiveNumber.optional(),
  })
  .strict();

const centerOverrideSchema = z
  .object({
    id: z.string().min(1),
    oxygen: resourceOverrideSchema.optional(),
    food: resourceOverrideSchema.optional(),
    equipmentInitial: positiveNumber.optional(),
  })
  .strict();

const roverOverrideSchema = z
  .object({
    id: z.string().min(1),
    initialCell: cellReferenceSchema.optional(),
    batteryInitial: nonNegativeNumber.optional(),
    initialCargo: cargoSchema.optional(),
  })
  .strict();

const incidentWeightsSchema = z
  .object({
    dustStorm: nonNegativeNumber,
    meteorite: nonNegativeNumber,
    crater: nonNegativeNumber,
  })
  .strict()
  .refine(
    ({ dustStorm, meteorite, crater }) => dustStorm + meteorite + crater > 0,
    'Incident weights must have a positive total',
  );

const scenarioSchema = z
  .object({
    levelId: z.string().min(1),
    seed: z.string().min(1),
    time: z
      .object({
        fixedStepMilliseconds: positiveNumber,
        gameMinutesPerRealSecond: positiveNumber,
        shiftRealSeconds: positiveNumber,
      })
      .strict(),
    equipmentDemandCenterIds: z.array(z.string().min(1)).optional(),
    centers: z.array(centerOverrideSchema).optional(),
    rovers: z.array(roverOverrideSchema).optional(),
    incident: z
      .object({
        cellChance: z.number().finite().min(0).max(1),
        weights: incidentWeightsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const fixtureCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarios: z.record(z.string().min(1), scenarioSchema),
  })
  .strict();

type CellReference = z.infer<typeof cellReferenceSchema>;
type E2eScenario = z.infer<typeof scenarioSchema>;

function requiredById<T extends { readonly id: string }>(
  entries: readonly T[],
  id: string,
  kind: string,
): T {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new RangeError(`E2E scenario references unknown ${kind}: ${id}`);
  }
  return entry;
}

function resolveCell(
  reference: CellReference,
  config: SimulationConfig,
): GridCell {
  if (reference.kind === 'BASE') return { ...config.baseCell };
  if (reference.kind === 'CENTER') {
    return {
      ...requiredById(config.centers, reference.centerId, 'center').cell,
    };
  }
  return { column: reference.column, row: reference.row };
}

function applyScenario(
  source: SimulationConfig,
  scenario: E2eScenario,
): SimulationConfig {
  const config = structuredClone(source);
  config.seed = scenario.seed;
  config.time = { ...scenario.time };

  if (scenario.equipmentDemandCenterIds !== undefined) {
    config.equipmentDemandCenterIds = [...scenario.equipmentDemandCenterIds];
  }

  for (const override of scenario.centers ?? []) {
    const center = requiredById(config.centers, override.id, 'center');
    if (override.oxygen !== undefined) {
      center.oxygen = { ...center.oxygen, ...override.oxygen };
    }
    if (override.food !== undefined) {
      center.food = { ...center.food, ...override.food };
    }
    if (override.equipmentInitial !== undefined) {
      center.equipmentInitial = override.equipmentInitial;
    }
  }

  for (const override of scenario.rovers ?? []) {
    const rover = requiredById(config.rovers, override.id, 'rover');
    if (override.initialCell !== undefined) {
      rover.initialCell = resolveCell(override.initialCell, config);
    }
    if (override.batteryInitial !== undefined) {
      rover.batteryInitial = override.batteryInitial;
    }
    if (override.initialCargo !== undefined) {
      rover.initialCargo = { ...override.initialCargo };
    }
  }

  if (scenario.incident !== undefined) {
    const weights: IncidentWeights = { ...scenario.incident.weights };
    config.incidentRules = {
      ...config.incidentRules,
      profiles: config.incidentRules.profiles.map((profile) => ({
        ...profile,
        cellChance: scenario.incident?.cellChance ?? profile.cellChance,
        weights: { ...weights },
      })),
    };
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance:
          scenario.incident?.cellChance ?? cell.effectiveCellChance,
      })),
    };
  }

  return config;
}

export function applyNamedE2eScenario({
  config,
  fixtureJson,
  levelId,
  search,
}: {
  readonly config: SimulationConfig;
  readonly fixtureJson: string;
  readonly levelId: string;
  readonly search: string;
}): SimulationConfig {
  const query = new URLSearchParams(search);
  if (query.get('e2e') !== '1') return config;

  const scenarioId = query.get('scenario');
  if (scenarioId === null) return config;

  const catalog = fixtureCatalogSchema.parse(JSON.parse(fixtureJson));
  const scenario = catalog.scenarios[scenarioId];
  if (scenario === undefined) {
    throw new RangeError(`Unknown E2E scenario: ${scenarioId}`);
  }
  if (scenario.levelId !== levelId) {
    throw new RangeError(
      `E2E scenario ${scenarioId} requires ${scenario.levelId}, received ${levelId}`,
    );
  }
  return applyScenario(config, scenario);
}
