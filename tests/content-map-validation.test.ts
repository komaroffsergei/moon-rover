import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ContentValidationError,
  loadContentBundle,
  loadTiledMap,
  parseJsonText,
  validateHazardZones,
  validateTiledMap,
  type TiledMap,
} from '../src/content';
import {
  commonContentSources,
  getRuntimeLevelSource,
} from '../src/content/levels/catalog';
import {
  incidentsFixture,
  levelMetaFixture,
  makeBundleFixture,
  makeValidTiledMap,
} from './fixtures/content';
import {
  navigationDistancesFrom,
  safePathMultiplicity,
} from '../src/content/validation/grid';

function expectIssue(action: () => unknown, code: string, path?: string): void {
  try {
    action();
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ContentValidationError);
    expect((error as ContentValidationError).issues).toContainEqual(
      expect.objectContaining({
        code,
        ...(path === undefined ? {} : { path }),
      }),
    );
  }
}

function tileLayer(map: TiledMap, name: string) {
  const layer = map.layers.find(
    (candidate) => candidate.name === name && candidate.type === 'tilelayer',
  );
  if (layer?.type !== 'tilelayer') {
    throw new Error(`Missing tile layer ${name}`);
  }
  return layer;
}

async function readExample(fileName: string): Promise<unknown> {
  const path = resolve('contracts/examples', fileName);
  return parseJsonText(await readFile(path, 'utf8'), path);
}

describe('Tiled validation', () => {
  it('uses Euclidean line of sight without cutting a blocked corner', () => {
    const open = {
      width: 3,
      height: 3,
      blocked: Array<boolean>(9).fill(false),
      hazardous: Array<boolean>(9).fill(false),
    };
    expect(navigationDistancesFrom(open, { column: 0, row: 0 })[8]).toBeCloseTo(
      Math.sqrt(8),
    );

    const corner = {
      width: 2,
      height: 2,
      blocked: [false, true, false, false],
      hazardous: Array<boolean>(4).fill(false),
    };
    expect(navigationDistancesFrom(corner, { column: 0, row: 0 })[3]).toBe(2);

    const sealedCorner = {
      ...corner,
      blocked: [false, true, true, false],
    };
    expect(
      navigationDistancesFrom(sealedCorner, { column: 0, row: 0 })[3],
    ).toBeUndefined();
  });

  it('excludes hazards from conservative navigation visibility on demand', () => {
    const grid = {
      width: 3,
      height: 2,
      blocked: Array<boolean>(6).fill(false),
      hazardous: [false, true, false, false, false, false],
    };

    expect(navigationDistancesFrom(grid, { column: 0, row: 0 })[2]).toBe(2);
    expect(navigationDistancesFrom(grid, { column: 0, row: 0 }, true)[2]).toBe(
      4,
    );
  });

  it('counts two internally independent safe approaches', () => {
    const open = {
      width: 3,
      height: 3,
      blocked: Array<boolean>(9).fill(false),
      hazardous: Array<boolean>(9).fill(false),
    };
    expect(
      safePathMultiplicity(open, { column: 0, row: 1 }, { column: 2, row: 1 }),
    ).toBe(2);

    open.blocked[0] = true;
    open.blocked[2] = true;
    open.blocked[6] = true;
    open.blocked[8] = true;
    expect(
      safePathMultiplicity(open, { column: 0, row: 1 }, { column: 2, row: 1 }),
    ).toBe(1);
  });

  it('does not duplicate a trivial route or the only direct edge', () => {
    const direct = {
      width: 2,
      height: 1,
      blocked: [false, false],
      hazardous: [false, false],
    };

    expect(
      safePathMultiplicity(
        direct,
        { column: 0, row: 0 },
        { column: 0, row: 0 },
      ),
    ).toBe(1);
    expect(
      safePathMultiplicity(
        direct,
        { column: 0, row: 0 },
        { column: 1, row: 0 },
      ),
    ).toBe(1);
  });

  it('reports map.safe-approaches when every safe route has one bottleneck', () => {
    const issues = validateTiledMap(makeValidTiledMap(), {
      incidents: incidentsFixture,
      levelMeta: { ...levelMetaFixture, ordinal: 2 },
    });

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'map.safe-approaches',
        path: '$.levelMeta.centers',
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'map.direct-safe-center',
        path: '$.levelMeta.centers',
      }),
    );
  });

  it('loads the coherent Shackleton bundle and references existing local assets', async () => {
    const result = loadContentBundle({
      balance: await readExample('balance.default.json'),
      balanceProfileId: 'default',
      incidents: await readExample('incidents.default.json'),
      levelMeta: await readExample('level-02-shackleton.json'),
      map: await readExample('shackleton-rift.tmj'),
      radio: await readExample('radio.ru.json'),
      theme: await readExample('theme.realistic-dark.json'),
    });

    expect(result.levelMeta.tiledMap).toBe('shackleton-rift.tmj');
    const objectLayer = result.map.layers.find(
      (layer) => layer.name === 'objects' && layer.type === 'objectgroup',
    );
    if (objectLayer?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    const entityIds = objectLayer.objects.flatMap((object) =>
      (object.properties ?? [])
        .filter(({ name }) => name === 'entityId')
        .map(({ value }) => value),
    );
    expect(entityIds.sort()).toEqual([
      'aristarchus',
      'base',
      'helios',
      'kepler',
      'spawn-gagarin',
      'spawn-korolev',
      'spawn-tereshkova',
    ]);

    const assetPaths = [
      result.theme.backgroundAsset,
      ...Object.values(result.theme.assets),
      ...result.map.layers.flatMap((layer) =>
        layer.type === 'imagelayer' ? [layer.image] : [],
      ),
      ...result.map.tilesets.flatMap((tileset) =>
        tileset.image === undefined ? [] : [tileset.image],
      ),
    ];
    await Promise.all(
      [...new Set(assetPaths)].map((assetPath) =>
        access(resolve('public', assetPath)),
      ),
    );
  });

  it('loads a cross-document bundle with a 1.5 safe/short risk ratio', () => {
    const result = loadContentBundle(makeBundleFixture());
    expect(result.levelMeta.id).toBe('test-level');
    expect(result.map.width).toBe(5);
  });

  it('rejects a theme background that differs from the Tiled background layer', () => {
    const bundle = makeBundleFixture();
    bundle.theme.backgroundAsset = 'assets/maps/test/other-background.webp';

    expectIssue(
      () => loadContentBundle(bundle),
      'content.background-asset-reference',
      '$.theme.backgroundAsset',
    );
  });

  it('rejects an external tileset source', () => {
    const map = makeValidTiledMap();
    map.tilesets[0] = { firstgid: 1, source: 'logic.tsx' };

    expectIssue(
      () => loadTiledMap(map),
      'map.external-tileset',
      '$.tilesets[0].source',
    );
  });

  it('rejects atlas dimensions inconsistent with tile geometry', () => {
    const map = makeValidTiledMap();
    map.tilesets[0]!.imagewidth = 193;

    expectIssue(
      () => loadTiledMap(map),
      'map.tileset-image-size',
      '$.tilesets[0]',
    );
  });

  it('rejects a required layer with the wrong type', () => {
    const map = makeValidTiledMap();
    map.layers[2] = {
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      id: 3,
      name: 'hazards',
      type: 'imagelayer',
      image: 'assets/maps/test/hazards.webp',
    };

    expectIssue(() => loadTiledMap(map), 'map.layer-type', '$.layers[2].type');
  });

  it.each([
    ['background', 'offsetx', 32],
    ['terrain', 'x', 1],
    ['objects', 'parallaxx', 0.5],
  ] as const)(
    'rejects transform %s.%s on a required gameplay layer',
    (layerName, field, value) => {
      const map = makeValidTiledMap();
      const layerIndex = map.layers.findIndex(
        (layer) => layer.name === layerName,
      );
      const layer = map.layers[layerIndex];
      if (layer === undefined) throw new Error(`Missing layer ${layerName}`);
      Object.assign(layer, { [field]: value });

      expectIssue(
        () => loadTiledMap(map),
        'map.layer-transform',
        `$.layers[${layerIndex}].${field}`,
      );
    },
  );

  it.each([
    ['hazards', 'visible', false, 'map.layer-hidden'],
    ['terrain', 'visible', 'yes', 'schema.invalid'],
    ['obstacles', 'opacity', 0, 'map.layer-opacity'],
  ] as const)(
    'rejects unreadable required layer %s with %s=%s',
    (layerName, field, value, code) => {
      const map = makeValidTiledMap();
      const layerIndex = map.layers.findIndex(
        (layer) => layer.name === layerName,
      );
      const layer = map.layers[layerIndex];
      if (layer === undefined) throw new Error(`Missing layer ${layerName}`);
      Object.assign(layer, { [field]: value });

      expectIssue(
        () => loadTiledMap(map),
        code,
        `$.layers[${layerIndex}].${field}`,
      );
    },
  );

  it('rejects a center isolated by blocked cells', () => {
    const bundle = makeBundleFixture();
    const obstacles = tileLayer(bundle.map, 'obstacles');
    obstacles.data[3] = 3;
    obstacles.data[8] = 3;
    obstacles.data[13] = 3;

    expectIssue(
      () => loadContentBundle(bundle),
      'map.unreachable',
      '$.layers[4].objects[1]',
    );
  });

  it('rejects an object placed on a blocked cell', () => {
    const map = makeValidTiledMap();
    tileLayer(map, 'obstacles').data[14] = 3;

    expectIssue(
      () => loadTiledMap(map),
      'map.object-blocked',
      '$.layers[4].objects[2]',
    );
  });

  it('rejects a map entity absent from level meta', () => {
    const bundle = makeBundleFixture();
    bundle.levelMeta.centers[0]!.id = 'another-center';
    bundle.levelMeta.riskChoiceCenters[0] = 'another-center';
    bundle.levelMeta.seededEquipmentDemandCenterIds[0] = 'another-center';
    for (const layout of bundle.levelMeta.facilityLayouts) {
      layout.centers['another-center'] = layout.centers['center-risk']!;
      delete layout.centers['center-risk'];
    }

    expectIssue(() => loadContentBundle(bundle), 'map.center-reference');
  });

  it('rejects a risk choice without a hazardous shortcut', () => {
    const bundle = makeBundleFixture();
    tileLayer(bundle.map, 'hazards').data.fill(0);

    expectIssue(() => loadContentBundle(bundle), 'map.risk-shortcut');
  });

  it('rejects duplicate entity IDs with the second object path', () => {
    const map = makeValidTiledMap();
    const objects = map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects[2]!.properties = [
      { name: 'entityId', type: 'string', value: 'center-risk' },
    ];

    expectIssue(
      () => loadTiledMap(map),
      'map.duplicate-entity-id',
      '$.layers[4].objects[2].properties',
    );
  });

  it('rejects a center placed on the base cell', () => {
    const map = makeValidTiledMap();
    const objects = map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects[1]!.x = objects.objects[0]!.x;
    objects.objects[1]!.y = objects.objects[0]!.y;

    expectIssue(
      () => loadTiledMap(map),
      'map.base-center-overlap',
      '$.layers[4].objects[1]',
    );
  });

  it('rejects two centers placed on the same cell', () => {
    const map = makeValidTiledMap();
    const objects = map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects[2]!.x = objects.objects[1]!.x;
    objects.objects[2]!.y = objects.objects[1]!.y;

    expectIssue(
      () => loadTiledMap(map),
      'map.center-overlap',
      '$.layers[4].objects[2]',
    );
  });

  it('rejects a base-center overlap introduced into a production bundle', () => {
    const source = getRuntimeLevelSource('shackleton-rift');
    const map = parseJsonText(source.mapText, source.mapFileName) as TiledMap;
    const objects = map.layers.find(
      (layer) => layer.name === 'objects' && layer.type === 'objectgroup',
    );
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing production objects layer');
    }
    const base = objects.objects.find(
      ({ class: objectClass }) => objectClass === 'base',
    );
    const centerIndex = objects.objects.findIndex(
      ({ class: objectClass }) => objectClass === 'center',
    );
    const center = objects.objects[centerIndex];
    if (base === undefined || center === undefined || centerIndex < 0) {
      throw new Error('Missing production base or center');
    }
    center.x = base.x;
    center.y = base.y;

    expectIssue(
      () =>
        loadContentBundle({
          ...commonContentSources,
          levelMeta: source.levelMeta,
          map,
          theme: source.theme,
        }),
      'map.base-center-overlap',
      `$.layers[${map.layers.indexOf(objects)}].objects[${centerIndex}]`,
    );
  });

  it('reports an unknown terrain GID at the exact data cell', () => {
    const map = makeValidTiledMap();
    tileLayer(map, 'terrain').data[6] = 99;

    expectIssue(
      () => loadTiledMap(map),
      'map.unknown-gid',
      '$.layers[1].data[6]',
    );
  });

  it('rejects an external background URL', () => {
    const map = makeValidTiledMap();
    const background = map.layers[0];
    if (background?.type !== 'imagelayer') {
      throw new Error('Missing background layer');
    }
    background.image = 'https://example.test/background.webp';

    expectIssue(
      () => loadTiledMap(map),
      'map.background-asset',
      '$.layers[0].image',
    );
  });

  it('does not accept legacy object.type as a domain class', () => {
    const map = makeValidTiledMap();
    const objects = map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects[1]!.type = 'center';

    expectIssue(
      () => loadTiledMap(map),
      'map.object-legacy-type',
      '$.layers[4].objects[1].type',
    );
  });

  it('rejects an isolated walkable island without an object', () => {
    const map = makeValidTiledMap();
    const obstacles = tileLayer(map, 'obstacles');
    obstacles.data[1] = 3;
    obstacles.data[3] = 3;
    obstacles.data[7] = 3;

    expectIssue(
      () => loadTiledMap(map),
      'map.isolated-cell',
      '$.layers[1].data[2]',
    );
  });

  it('rejects a risk detour outside the 1.4–1.9 ratio', () => {
    const bundle = makeBundleFixture();
    const objects = bundle.map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects[1]!.x = 128;
    const hazards = tileLayer(bundle.map, 'hazards');
    hazards.data.fill(0);
    hazards.data[6] = 2;

    expectIssue(() => loadContentBundle(bundle), 'map.risk-ratio');
  });

  it('rejects a risk choice without any safe path', () => {
    const bundle = makeBundleFixture();
    const obstacles = tileLayer(bundle.map, 'obstacles');
    obstacles.data[1] = 3;
    obstacles.data[11] = 3;

    expectIssue(() => loadContentBundle(bundle), 'map.risk-safe-path');
  });

  it('rejects gameplay properties on tilesets and image layers', () => {
    const tilesetMap = makeValidTiledMap();
    tilesetMap.tilesets[0]!.properties = [
      { name: 'damage', type: 'int', value: 10 },
    ];
    expectIssue(() => loadTiledMap(tilesetMap), 'map.tileset-property');

    const backgroundMap = makeValidTiledMap();
    const background = backgroundMap.layers[0];
    if (background?.type !== 'imagelayer') {
      throw new Error('Missing background layer');
    }
    background.properties = [
      { name: 'script', type: 'string', value: 'forbidden' },
    ];
    expectIssue(() => loadTiledMap(backgroundMap), 'map.layer-property');
  });

  it('rejects an unknown balance profile reference', () => {
    const bundle = makeBundleFixture();
    bundle.levelMeta.balanceProfileId = 'missing-profile';

    expectIssue(
      () => loadContentBundle(bundle),
      'content.balance-reference',
      '$.levelMeta.balanceProfileId',
    );
  });

  it('rejects a missing required layer', () => {
    const map = makeValidTiledMap();
    map.layers.splice(2, 1);

    expectIssue(() => loadTiledMap(map), 'map.layer-missing', '$.layers');
  });

  it('rejects required layers in the wrong order', () => {
    const map = makeValidTiledMap();
    [map.layers[1], map.layers[2]] = [map.layers[2]!, map.layers[1]!];

    expectIssue(() => loadTiledMap(map), 'map.layer-order', '$.layers');
  });

  it('rejects a tile layer with a mismatched size', () => {
    const map = makeValidTiledMap();
    tileLayer(map, 'terrain').width = 4;

    expectIssue(() => loadTiledMap(map), 'map.layer-size', '$.layers[1]');
  });

  it('rejects an unknown hazard profile reference', () => {
    const bundle = makeBundleFixture();
    const tiles = bundle.map.tilesets[0]?.tiles;
    const hazardTile = tiles?.[1];
    const property = hazardTile?.properties?.find(
      ({ name }) => name === 'hazardProfileId',
    );
    if (property === undefined) throw new Error('Missing hazard profile');
    property.value = 'unknown-profile';

    expectIssue(
      () => loadContentBundle(bundle),
      'map.hazard-profile-reference',
    );
  });

  it('rejects the normal incident profile on a hazard tile', () => {
    const bundle = makeBundleFixture();
    const hazardTile = bundle.map.tilesets[0]?.tiles?.[1];
    const property = hazardTile?.properties?.find(
      ({ name }) => name === 'hazardProfileId',
    );
    if (property === undefined) throw new Error('Missing hazard profile');
    property.value = 'normal';

    expectIssue(() => loadContentBundle(bundle), 'map.hazard-profile-kind');
  });

  it('rejects a missing repair spawn with an exact objects path', () => {
    const map = makeValidTiledMap();
    const objects = map.layers[4];
    if (objects?.type !== 'objectgroup') {
      throw new Error('Missing objects layer');
    }
    objects.objects.pop();

    expectIssue(
      () => loadTiledMap(map),
      'map.object-count',
      '$.layers[4].objects',
    );
  });

  it('rejects scattered and missing large hazard zones for final levels', () => {
    const grid = {
      width: 8,
      height: 5,
      blocked: Array<boolean>(40).fill(false),
      hazardous: Array<boolean>(40).fill(false),
    };
    grid.hazardous[0] = true;
    expect(validateHazardZones(grid, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'map.hazard-zone-size' }),
        expect.objectContaining({ code: 'map.hazard-zone-large-missing' }),
      ]),
    );
  });

  it('requires at least three independent hazard zones on level five', () => {
    const grid = {
      width: 12,
      height: 8,
      blocked: Array<boolean>(96).fill(false),
      hazardous: Array<boolean>(96).fill(false),
    };
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        grid.hazardous[row * grid.width + column] = true;
      }
    }
    for (let row = 5; row < 8; row += 1) {
      for (let column = 8; column < 11; column += 1) {
        grid.hazardous[row * grid.width + column] = true;
      }
    }

    expect(validateHazardZones(grid, 5)).toContainEqual(
      expect.objectContaining({ code: 'map.hazard-zone-count' }),
    );
  });

  it('rejects an invalid decorations tile layer', () => {
    const map = makeValidTiledMap();
    map.layers.push({
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      id: 6,
      name: 'decorations',
      type: 'tilelayer',
      width: 1,
      height: 1,
      data: [99],
    });

    expectIssue(() => loadTiledMap(map), 'map.layer-size', '$.layers[5]');
  });

  it('rejects polygon navigation payload on a point object', () => {
    const map = makeValidTiledMap() as TiledMap & {
      layers: Array<Record<string, unknown>>;
    };
    const objects = map.layers[4];
    const values = objects?.objects as Array<Record<string, unknown>>;
    values[1]!.polygon = [
      { x: 0, y: 0 },
      { x: 64, y: 0 },
    ];

    expectIssue(
      () => loadTiledMap(map),
      'map.object-shape',
      '$.layers[4].objects[1].polygon',
    );
  });

  it('rejects scripts and properties on an object decorations layer', () => {
    const map = makeValidTiledMap() as TiledMap & {
      script?: string;
    };
    map.script = 'run()';
    map.layers.push({
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      id: 6,
      name: 'decorations',
      type: 'objectgroup',
      objects: [
        {
          id: 7,
          name: 'marker',
          x: 64,
          y: 64,
          properties: [{ name: 'damage', type: 'int', value: 99 }],
        },
      ],
      properties: [{ name: 'speed', type: 'int', value: 10 }],
    });

    expectIssue(() => loadTiledMap(map), 'map.script', '$.script');
    delete map.script;
    expectIssue(
      () => loadTiledMap(map),
      'map.layer-property',
      '$.layers[5].properties',
    );
    delete map.layers[5]!.properties;
    expectIssue(
      () => loadTiledMap(map),
      'map.object-property',
      '$.layers[5].objects[0].properties',
    );
  });
});
