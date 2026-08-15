import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ASSET_LIMITS,
  BACKGROUND_PATHS,
  inspectRepositoryAssets,
  readImageDimensions,
} from '../scripts/asset-validation';

const temporaryRoots: string[] = [];

async function createAssetFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'moon-courier-assets-'));
  temporaryRoots.push(root);

  for (const path of BACKGROUND_PATHS) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await cp(resolve(path), resolve(root, path));
  }
  await mkdir(resolve(root, 'public/assets/tiles'), { recursive: true });
  await cp(
    resolve('public/assets/tiles/lunar-logical.png'),
    resolve(root, 'public/assets/tiles/lunar-logical.png'),
  );
  await cp(
    resolve('public/assets/objects'),
    resolve(root, 'public/assets/objects'),
    { recursive: true },
  );
  await mkdir(resolve(root, 'contracts/examples'), { recursive: true });
  await writeFile(
    resolve(root, 'contracts/examples/theme.test.json'),
    JSON.stringify({
      backgroundAsset: 'assets/maps/tycho/background.webp',
      assets: { rover: 'assets/objects/rover.png' },
    }),
  );
  return root;
}

function appendWebpChunk(bytes: Buffer, payloadBytes: number): Buffer {
  const header = Buffer.alloc(8);
  header.write('EXIF', 0, 'ascii');
  header.writeUInt32LE(payloadBytes, 4);
  const padding = payloadBytes % 2;
  const result = Buffer.concat([
    bytes,
    header,
    Buffer.alloc(payloadBytes),
    Buffer.alloc(padding),
  ]);
  result.writeUInt32LE(result.byteLength - 8, 4);
  return result;
}

function makeRgbaPng(alpha: number): Buffer {
  const width = 64;
  const height = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4), 255);
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 4);
    scanlines[start] = 0;
    for (let pixel = 0; pixel < width; pixel += 1) {
      scanlines[start + 1 + pixel * 4 + 3] = alpha;
    }
  }
  const chunk = (type: string, payload: Buffer) => {
    const result = Buffer.alloc(12 + payload.length);
    result.writeUInt32BE(payload.length, 0);
    result.write(type, 4, 'ascii');
    payload.copy(result, 8);
    return result;
  };
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe('asset validation', () => {
  it('accepts the five distinct local backgrounds and compact atlases', async () => {
    const report = await inspectRepositoryAssets();

    expect(report.issues).toEqual([]);
    expect(report.backgrounds).toHaveLength(5);
    expect(new Set(report.backgrounds.map(({ sha256 }) => sha256)).size).toBe(
      5,
    );
    expect(
      report.backgrounds.every(
        ({ bytes, width, height }) =>
          bytes <= ASSET_LIMITS.backgroundBytes &&
          width === ASSET_LIMITS.backgroundWidth &&
          ASSET_LIMITS.backgroundHeights.includes(
            height as (typeof ASSET_LIMITS.backgroundHeights)[number],
          ),
      ),
    ).toBe(true);
    expect(report.atlasTiles).toBe(3);
    expect(report.atlasHasTransparency).toBe(true);
    expect(report.atlasBytes).toBeLessThanOrEqual(ASSET_LIMITS.atlasBytes);
    expect(report.objectBytes).toBeLessThanOrEqual(ASSET_LIMITS.objectBytes);
  });

  it('reads the real PNG and WebP dimensions from their binary headers', async () => {
    const atlas = readImageDimensions(
      await readFile('public/assets/tiles/lunar-logical.png'),
    );
    const background = readImageDimensions(
      await readFile('public/assets/maps/tycho/background.webp'),
    );

    expect(atlas).toEqual({ format: 'png', width: 192, height: 64 });
    expect(background).toEqual({
      format: 'webp',
      width: 2_048,
      height: 1_536,
    });
  });

  it('rejects unbudgeted legacy files in the production tile directory', async () => {
    const root = await createAssetFixture();
    await writeFile(
      resolve(root, 'public/assets/tiles/legacy-atlas.png'),
      Buffer.from('unused'),
    );

    const report = await inspectRepositoryAssets(root);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'asset.unexpected-tile-asset',
        path: 'public/assets/tiles/legacy-atlas.png',
      }),
    );
  });

  it('rejects an opaque logical atlas that hides the level background', async () => {
    const root = await createAssetFixture();
    await writeFile(
      resolve(root, 'public/assets/tiles/lunar-logical.png'),
      makeRgbaPng(255),
    );

    const report = await inspectRepositoryAssets(root);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'asset.atlas-transparency' }),
    );
  });

  it('rejects duplicate backgrounds even when every file is local', async () => {
    const root = await createAssetFixture();
    await cp(
      resolve(root, BACKGROUND_PATHS[0]),
      resolve(root, BACKGROUND_PATHS[2]),
    );

    const report = await inspectRepositoryAssets(root);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'asset.background-duplicate' }),
    );
  });

  it('rejects a valid WebP that crosses the per-background byte budget', async () => {
    const root = await createAssetFixture();
    const path = resolve(root, BACKGROUND_PATHS[0]);
    const source = await readFile(path);
    const extraBytes = ASSET_LIMITS.backgroundBytes - source.byteLength + 1;
    await writeFile(path, appendWebpChunk(source, extraBytes));

    const report = await inspectRepositoryAssets(root);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'asset.background-budget',
        path: BACKGROUND_PATHS[0],
      }),
    );
  });

  it('rejects remote, data and parent-directory asset references', async () => {
    const root = await createAssetFixture();
    await writeFile(
      resolve(root, 'contracts/examples/theme.test.json'),
      JSON.stringify({
        backgroundAsset: 'https://cdn.invalid/moon.webp',
        assets: {
          rover: 'data:image/png;base64,AAAA',
          base: '../outside.png',
        },
      }),
    );

    const report = await inspectRepositoryAssets(root);
    expect(
      report.issues.filter(({ code }) => code === 'asset.non-local-reference'),
    ).toHaveLength(3);
  });
});
