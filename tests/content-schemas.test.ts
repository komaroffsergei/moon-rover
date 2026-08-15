import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ContentValidationError,
  loadBalance,
  loadIncidentProfiles,
  loadLevelMeta,
  loadRadioContent,
  loadTheme,
  loadTiledMap,
  parseJsonText,
} from '../src/content';

async function readExample(fileName: string): Promise<unknown> {
  const path = resolve('contracts/examples', fileName);
  return parseJsonText(await readFile(path, 'utf8'), path);
}

describe('content schemas', () => {
  it.each([
    ['balance.default.json', loadBalance],
    ['incidents.default.json', loadIncidentProfiles],
    ['level-02-shackleton.json', loadLevelMeta],
    ['radio.ru.json', loadRadioContent],
    ['theme.realistic-dark.json', loadTheme],
    ['shackleton-rift.tmj', loadTiledMap],
  ] as const)('loads contract example %s', async (fileName, load) => {
    const input = await readExample(fileName);
    expect(() => load(input)).not.toThrow();
  });

  it('normalizes omitted Tiled layer defaults before Phaser consumes the map', async () => {
    const input = await readExample('shackleton-rift.tmj');
    const map = loadTiledMap(input);

    expect(map.layers[0]).toMatchObject({
      name: 'background',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    });
    expect(map.layers[1]).toMatchObject({
      name: 'terrain',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
    });
  });

  it('reports an unsupported schema major with a stable code and path', async () => {
    const input = await readExample('level-02-shackleton.json');
    const invalid = { ...(input as Record<string, unknown>), schemaVersion: 2 };

    try {
      loadLevelMeta(invalid);
      expect.unreachable('loader must reject schemaVersion=2');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.unsupported-version',
          path: '$.schemaVersion',
        }),
      );
    }
  });

  it('validates level-owned seeded equipment demand centers', async () => {
    const cases = [
      {
        path: '$.ordinal',
        mutate(input: Record<string, unknown>) {
          input.ordinal = 0;
        },
      },
      {
        path: '$.riskLevel',
        mutate(input: Record<string, unknown>) {
          input.riskLevel = 'unknown';
        },
      },
      {
        path: '$.seededEquipmentDemandCenterIds',
        mutate(input: Record<string, unknown>) {
          input.seededEquipmentDemandCenterIds = ['helios'];
        },
      },
      {
        path: '$.seededEquipmentDemandCenterIds[1]',
        mutate(input: Record<string, unknown>) {
          input.seededEquipmentDemandCenterIds = ['helios', 'helios'];
        },
      },
      {
        path: '$.seededEquipmentDemandCenterIds[1]',
        mutate(input: Record<string, unknown>) {
          input.seededEquipmentDemandCenterIds = ['helios', 'missing-center'];
        },
      },
    ];

    for (const { path, mutate } of cases) {
      const input = (await readExample('level-02-shackleton.json')) as Record<
        string,
        unknown
      >;
      mutate(input);

      try {
        loadLevelMeta(input);
        expect.unreachable(`loader must reject ${path}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentValidationError);
        expect((error as ContentValidationError).issues).toContainEqual(
          expect.objectContaining({ code: 'schema.invalid', path }),
        );
      }
    }
  });

  it('rejects level metadata that diverges from the ordinal balance table', async () => {
    const cases = [
      {
        path: '$.centers',
        mutate(input: Record<string, unknown>) {
          const centers = input.centers as Array<Record<string, unknown>>;
          input.centers = [centers[0]!, centers[2]!];
        },
      },
      {
        path: '$.rovers',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[0]!.archetypeId = 'repair';
        },
      },
      {
        path: '$.rovers',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[2]!.archetypeId = 'standard';
        },
      },
      {
        path: '$.riskLevel',
        mutate(input: Record<string, unknown>) {
          input.riskLevel = 'high';
        },
      },
      {
        path: '$.riskChoiceCenters',
        mutate(input: Record<string, unknown>) {
          input.riskChoiceCenters = ['helios'];
        },
      },
    ];

    for (const { path, mutate } of cases) {
      const input = (await readExample('level-02-shackleton.json')) as Record<
        string,
        unknown
      >;
      mutate(input);

      try {
        loadLevelMeta(input);
        expect.unreachable(`loader must reject ${path}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentValidationError);
        expect((error as ContentValidationError).issues).toContainEqual(
          expect.objectContaining({ code: 'schema.invalid', path }),
        );
      }
    }
  });

  it('keeps Zod level ID and list constraints aligned with JSON Schema', async () => {
    const cases = [
      {
        path: '$.themeId',
        mutate(input: Record<string, unknown>) {
          input.themeId = 'Realistic Dark';
        },
      },
      {
        path: '$.balanceProfileId',
        mutate(input: Record<string, unknown>) {
          input.balanceProfileId = 'Default_Profile';
        },
      },
      {
        path: '$.centers[0].id',
        mutate(input: Record<string, unknown>) {
          const centers = input.centers as Array<Record<string, unknown>>;
          centers[0]!.id = 'Helios';
        },
      },
      {
        path: '$.rovers[0].id',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[0]!.id = 'Gagarin_1';
        },
      },
      {
        path: '$.rovers[0].spawnObjectId',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[0]!.spawnObjectId = 'Spawn Gagarin';
        },
      },
      {
        path: '$.riskChoiceCenters[0]',
        mutate(input: Record<string, unknown>) {
          input.riskChoiceCenters = ['Helios', 'aristarchus'];
        },
      },
      {
        path: '$.riskChoiceCenters[1]',
        mutate(input: Record<string, unknown>) {
          input.riskChoiceCenters = ['helios', 'helios'];
        },
      },
      {
        path: '$.riskChoiceCenters[0]',
        mutate(input: Record<string, unknown>) {
          input.riskChoiceCenters = ['missing-center', 'aristarchus'];
        },
      },
      {
        path: '$.centers',
        mutate(input: Record<string, unknown>) {
          const centers = input.centers as Array<Record<string, unknown>>;
          input.centers = [centers[0]!];
        },
      },
      {
        path: '$.rovers',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          input.rovers = rovers.slice(0, 2);
        },
      },
      {
        path: '$.riskChoiceCenters',
        mutate(input: Record<string, unknown>) {
          input.riskChoiceCenters = [];
        },
      },
      {
        path: '$.seededEquipmentDemandCenterIds',
        mutate(input: Record<string, unknown>) {
          input.seededEquipmentDemandCenterIds = [];
        },
      },
      {
        path: '$.centers[1].id',
        mutate(input: Record<string, unknown>) {
          const centers = input.centers as Array<Record<string, unknown>>;
          centers[1]!.id = centers[0]!.id;
        },
      },
      {
        path: '$.rovers[1].id',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[1]!.id = rovers[0]!.id;
        },
      },
      {
        path: '$.rovers[1].spawnObjectId',
        mutate(input: Record<string, unknown>) {
          const rovers = input.rovers as Array<Record<string, unknown>>;
          rovers[1]!.spawnObjectId = rovers[0]!.spawnObjectId;
        },
      },
    ];

    for (const { path, mutate } of cases) {
      const input = (await readExample('level-02-shackleton.json')) as Record<
        string,
        unknown
      >;
      mutate(input);

      try {
        loadLevelMeta(input);
        expect.unreachable(`loader must reject ${path}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentValidationError);
        expect((error as ContentValidationError).issues).toContainEqual(
          expect.objectContaining({ code: 'schema.invalid', path }),
        );
      }
    }
  });

  it('publishes level-owned seeded demand fields in JSON Schema', async () => {
    const schema = parseJsonText(
      await readFile(resolve('contracts/level-meta.schema.json'), 'utf8'),
    );

    expect(schema).toMatchObject({
      required: expect.arrayContaining([
        'ordinal',
        'riskLevel',
        'seededEquipmentDemandCenterIds',
      ]),
      properties: {
        ordinal: { type: 'integer', minimum: 1, maximum: 5 },
        id: {
          type: 'string',
          pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        },
        themeId: {
          type: 'string',
          pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        },
        balanceProfileId: {
          type: 'string',
          pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
        },
        riskLevel: {
          enum: ['low', 'medium', 'high', 'extreme', 'maximum'],
        },
        centers: {
          minItems: 2,
          maxItems: 6,
          uniqueItems: true,
        },
        rovers: {
          minItems: 3,
          maxItems: 9,
          uniqueItems: true,
        },
        riskChoiceCenters: {
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          items: {
            type: 'string',
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
          },
        },
        seededEquipmentDemandCenterIds: {
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: {
            type: 'string',
            pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
          },
        },
      },
      $defs: {
        center: {
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            },
          },
        },
        rover: {
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            },
            spawnObjectId: {
              type: 'string',
              pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
            },
          },
        },
      },
    });

    const branches = (
      schema as {
        allOf: Array<{
          if: { properties: { ordinal: { const: number } } };
        }>;
      }
    ).allOf;
    expect(branches).toHaveLength(5);
    const requirements = [
      {
        ordinal: 1,
        centerCount: 2,
        roverCount: 3,
        riskLevel: 'low',
        riskChoiceCount: 1,
      },
      {
        ordinal: 2,
        centerCount: 3,
        roverCount: 3,
        riskLevel: 'medium',
        riskChoiceCount: 2,
      },
      {
        ordinal: 3,
        centerCount: 4,
        roverCount: 4,
        riskLevel: 'high',
        riskChoiceCount: 3,
      },
      {
        ordinal: 4,
        centerCount: 5,
        roverCount: 5,
        riskLevel: 'extreme',
        riskChoiceCount: 3,
      },
      {
        ordinal: 5,
        centerCount: 6,
        roverCount: 6,
        riskLevel: 'maximum',
        riskChoiceCount: 3,
      },
    ] as const;

    for (const requirement of requirements) {
      const branch = branches.find(
        (candidate) =>
          candidate.if.properties.ordinal.const === requirement.ordinal,
      );
      expect(branch).toMatchObject({
        then: {
          properties: {
            centers: {
              minItems: requirement.centerCount,
              maxItems: requirement.centerCount,
            },
            rovers: {
              minItems: requirement.roverCount,
              maxItems: requirement.roverCount,
              contains: {
                properties: { archetypeId: { const: 'repair' } },
              },
              minContains: 1,
              maxContains: 1,
            },
            riskLevel: { const: requirement.riskLevel },
            riskChoiceCenters: {
              minItems: requirement.riskChoiceCount,
              maxItems: requirement.riskChoiceCount,
            },
            seededEquipmentDemandCenterIds: {
              minItems: requirement.ordinal,
              maxItems: requirement.ordinal,
            },
          },
        },
      });
    }
  });

  it('reports a nested JSON path for an invalid field', async () => {
    const input = await readExample('balance.default.json');
    const invalid = structuredClone(input) as {
      time: { fixedStepMilliseconds: number };
    };
    invalid.time.fixedStepMilliseconds = 101;

    try {
      loadBalance(invalid);
      expect.unreachable('loader must reject a non-contract fixed step');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.time.fixedStepMilliseconds',
        }),
      );
    }
  });

  it('rejects simulation coefficients outside the balance contract', async () => {
    const input = (await readExample('balance.default.json')) as {
      center: { equipmentDemand: { lossMin: number } };
    };
    input.center.equipmentDemand.lossMin = 19;

    try {
      loadBalance(input);
      expect.unreachable('loader must reject an out-of-contract demand loss');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.center.equipmentDemand.lossMin',
        }),
      );
    }
  });

  it.each([
    {
      path: '$.routing.routeWeights.movementCost',
      value: 0,
      key: 'movementCost' as const,
    },
    {
      path: '$.routing.routeWeights.incidentRisk',
      value: -1,
      key: 'incidentRisk' as const,
    },
  ])('rejects invalid route weight at $path', async ({ path, value, key }) => {
    const input = (await readExample('balance.default.json')) as {
      routing: {
        routeWeights: { movementCost: number; incidentRisk: number };
      };
    };
    input.routing.routeWeights[key] = value;

    try {
      loadBalance(input);
      expect.unreachable(`loader must reject ${path}`);
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({ code: 'schema.invalid', path }),
      );
    }
  });

  it('publishes route weights in JSON Schema', async () => {
    const schema = parseJsonText(
      await readFile(resolve('contracts/balance.schema.json'), 'utf8'),
    );

    expect(schema).toMatchObject({
      properties: {
        routing: {
          required: ['eventCooldownCells', 'routeWeights'],
          properties: {
            routeWeights: {
              required: ['movementCost', 'incidentRisk'],
              properties: {
                movementCost: { type: 'number', exclusiveMinimum: 0 },
                incidentRisk: { type: 'number', minimum: 0 },
              },
            },
          },
        },
      },
    });
  });

  it('requires the fixed rescue timing rules', async () => {
    const cases = [
      {
        path: '$.rescue',
        mutate(input: Record<string, unknown>) {
          delete input.rescue;
        },
      },
      {
        path: '$.rescue.repairGameMinutes',
        mutate(input: Record<string, unknown>) {
          (input.rescue as { repairGameMinutes: number }).repairGameMinutes = 4;
        },
      },
      {
        path: '$.rescue.craterRescueGameMinutes',
        mutate(input: Record<string, unknown>) {
          (
            input.rescue as { craterRescueGameMinutes: number }
          ).craterRescueGameMinutes = 2;
        },
      },
    ];

    for (const { path, mutate } of cases) {
      const input = (await readExample('balance.default.json')) as Record<
        string,
        unknown
      >;
      mutate(input);
      try {
        loadBalance(input);
        expect.unreachable(`loader must reject ${path}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ContentValidationError);
        expect((error as ContentValidationError).issues).toContainEqual(
          expect.objectContaining({ code: 'schema.invalid', path }),
        );
      }
    }
  });

  it('publishes the rescue timings in JSON Schema', async () => {
    const schema = parseJsonText(
      await readFile(resolve('contracts/balance.schema.json'), 'utf8'),
    );

    expect(schema).toMatchObject({
      required: expect.arrayContaining(['rescue']),
      properties: {
        rescue: {
          required: ['repairGameMinutes', 'craterRescueGameMinutes'],
          properties: {
            repairGameMinutes: { const: 5 },
            craterRescueGameMinutes: { const: 3 },
          },
        },
      },
    });
  });

  it('reports malformed JSON before schema validation', () => {
    expect(() => parseJsonText('{', 'broken.json')).toThrowError(
      ContentValidationError,
    );

    try {
      parseJsonText('{', 'broken.json');
    } catch (error) {
      expect((error as ContentValidationError).issues).toEqual([
        expect.objectContaining({ code: 'json.invalid', path: '$' }),
      ]);
    }
  });

  it('rejects a theme asset encoded as a data URI', async () => {
    const input = (await readExample('theme.realistic-dark.json')) as {
      backgroundAsset: string;
    };
    input.backgroundAsset = 'data:image/webp;base64,AAAA';

    expect(() => loadTheme(input)).toThrowError(ContentValidationError);
  });

  it('requires the fixed incident timing rules', async () => {
    const missingRules = (await readExample(
      'incidents.default.json',
    )) as Record<string, unknown>;
    delete missingRules.rules;

    try {
      loadIncidentProfiles(missingRules);
      expect.unreachable('loader must require incident rules');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.rules',
        }),
      );
    }

    const wrongDuration = (await readExample('incidents.default.json')) as {
      rules: { dustStormGameMinutes: number };
    };
    wrongDuration.rules.dustStormGameMinutes = 9;
    try {
      loadIncidentProfiles(wrongDuration);
      expect.unreachable('loader must require a ten-minute dust storm');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.rules.dustStormGameMinutes',
        }),
      );
    }
  });

  it('requires the normal incident profile', async () => {
    const input = (await readExample('incidents.default.json')) as {
      profiles: Array<{ id: string }>;
    };
    input.profiles = input.profiles.filter(({ id }) => id !== 'normal');

    try {
      loadIncidentProfiles(input);
      expect.unreachable('loader must require profile id=normal');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.profiles',
        }),
      );
    }
  });

  it('rejects an incident profile with zero total weight', async () => {
    const input = (await readExample('incidents.default.json')) as {
      profiles: Array<{
        weights: { dustStorm: number; meteorite: number; crater: number };
      }>;
    };
    input.profiles[0]!.weights = {
      dustStorm: 0,
      meteorite: 0,
      crater: 0,
    };

    try {
      loadIncidentProfiles(input);
      expect.unreachable('loader must reject zero-sum incident weights');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      expect((error as ContentValidationError).issues).toContainEqual(
        expect.objectContaining({
          code: 'schema.invalid',
          path: '$.profiles[0].weights',
        }),
      );
    }
  });

  it('rejects an incident profile whose finite weights overflow in total', async () => {
    const input = (await readExample('incidents.default.json')) as {
      profiles: Array<{
        weights: { dustStorm: number; meteorite: number; crater: number };
      }>;
    };
    input.profiles[0]!.weights = {
      dustStorm: Number.MAX_VALUE,
      meteorite: Number.MAX_VALUE,
      crater: Number.MAX_VALUE,
    };

    expect(() => loadIncidentProfiles(input)).toThrowError(
      ContentValidationError,
    );
  });

  it('publishes the core incident invariants in JSON Schema', async () => {
    const schema = parseJsonText(
      await readFile(resolve('contracts/incidents.schema.json'), 'utf8'),
    );

    expect(schema).toMatchObject({
      properties: {
        profiles: {
          minItems: 1,
          uniqueItems: true,
          contains: { properties: { id: { const: 'normal' } } },
          items: {
            properties: {
              id: { pattern: expect.any(String) },
              weights: { anyOf: expect.any(Array) },
            },
          },
        },
      },
    });
  });
});
