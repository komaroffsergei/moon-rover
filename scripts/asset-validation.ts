import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { gzipSync, inflateSync } from 'node:zlib';

export const ASSET_LIMITS = {
  backgroundBytes: 600_000,
  backgroundWidth: 2_048,
  backgroundHeights: [1_024, 1_536] as const,
  atlasBytes: 512 * 1_024,
  atlasTileCount: 16,
  objectBytes: 1_000_000,
  textureDimension: 4_096,
  initialLoadBytes: 6_000_000,
  logicalTileSize: 64,
} as const;

export const BACKGROUND_PATHS = [
  'public/assets/maps/tycho/background.webp',
  'public/assets/maps/shackleton/background.webp',
  'public/assets/maps/tranquility/background.webp',
  'public/assets/maps/south-pole/background.webp',
  'public/assets/maps/aitken/background.webp',
] as const;

const ATLAS_PATH = 'public/assets/tiles/lunar-logical.png';
const TILE_DIRECTORY = 'public/assets/tiles';
const OBJECT_DIRECTORY = 'public/assets/objects';

export interface AssetIssue {
  code: string;
  path: string;
  message: string;
}

export interface ImageDimensions {
  format: 'png' | 'webp';
  width: number;
  height: number;
}

export interface AssetValidationReport {
  backgrounds: Array<{
    path: string;
    bytes: number;
    width: number;
    height: number;
    sha256: string;
  }>;
  atlasBytes: number;
  atlasHasTransparency: boolean;
  atlasTiles: number;
  objectBytes: number;
  initialLoadBytes: Record<string, number>;
  issues: AssetIssue[];
}

function pngDimensions(bytes: Buffer): ImageDimensions | undefined {
  const signature = '89504e470d0a1a0a';
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) {
    return undefined;
  }
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('PNG does not start with an IHDR chunk');
  }
  return {
    format: 'png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

export function pngHasTransparentPixels(bytes: Buffer): boolean {
  const dimensions = pngDimensions(bytes);
  if (
    dimensions === undefined ||
    bytes[24] !== 8 ||
    bytes[25] !== 6 ||
    bytes[28] !== 0
  ) {
    return false;
  }

  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const payloadStart = offset + 8;
    const next = payloadStart + length + 4;
    if (next > bytes.length) throw new Error(`PNG ${type} chunk is truncated`);
    if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(payloadStart, payloadStart + length));
    }
    offset = next;
  }
  if (idatChunks.length === 0) throw new Error('PNG has no IDAT chunk');

  const decoded = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = dimensions.width * bytesPerPixel;
  let previous = Buffer.alloc(stride);
  let cursor = 0;
  let hasTransparency = false;

  for (let row = 0; row < dimensions.height; row += 1) {
    const filter = decoded[cursor];
    cursor += 1;
    if (
      filter === undefined ||
      filter > 4 ||
      cursor + stride > decoded.length
    ) {
      throw new Error('PNG scanline data is malformed');
    }
    const current = Buffer.allocUnsafe(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = decoded[cursor + index] ?? 0;
      const left = index >= bytesPerPixel ? (current[index - 4] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= bytesPerPixel ? (previous[index - 4] ?? 0) : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paethPredictor(left, up, upLeft);
      current[index] = (raw + predictor) & 0xff;
    }
    for (let alpha = 3; alpha < stride; alpha += bytesPerPixel) {
      if (current[alpha] !== 255) hasTransparency = true;
    }
    cursor += stride;
    previous = current;
  }
  return hasTransparency;
}

function webpDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return undefined;
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error('WebP RIFF size does not match the file size');
  }

  let dimensions: ImageDimensions | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const next = payload + chunkSize + (chunkSize % 2);
    if (next > bytes.length) {
      throw new Error(`WebP ${chunkType} chunk exceeds the file size`);
    }

    if (chunkType === 'VP8X' && chunkSize >= 10) {
      dimensions = {
        format: 'webp',
        width: 1 + bytes.readUIntLE(payload + 4, 3),
        height: 1 + bytes.readUIntLE(payload + 7, 3),
      };
    } else if (chunkType === 'VP8L' && chunkSize >= 5) {
      if (bytes[payload] !== 0x2f) {
        throw new Error('WebP VP8L signature is invalid');
      }
      const b1 = bytes[payload + 1] ?? 0;
      const b2 = bytes[payload + 2] ?? 0;
      const b3 = bytes[payload + 3] ?? 0;
      const b4 = bytes[payload + 4] ?? 0;
      dimensions = {
        format: 'webp',
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
      };
    } else if (
      chunkType === 'VP8 ' &&
      chunkSize >= 10 &&
      bytes.subarray(payload + 3, payload + 6).toString('hex') === '9d012a'
    ) {
      dimensions = {
        format: 'webp',
        width: bytes.readUInt16LE(payload + 6) & 0x3fff,
        height: bytes.readUInt16LE(payload + 8) & 0x3fff,
      };
    }
    offset = next;
  }

  if (offset !== bytes.length || !dimensions) {
    throw new Error('WebP has no supported image dimensions');
  }
  return dimensions;
}

export function readImageDimensions(bytes: Buffer): ImageDimensions {
  const dimensions = pngDimensions(bytes) ?? webpDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error('Unsupported or malformed PNG/WebP image');
  }
  return dimensions;
}

async function walkFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().sort();
}

function addIssue(
  issues: AssetIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path: path.replaceAll('\\', '/'), message });
}

async function readRequired(
  root: string,
  path: string,
  issues: AssetIssue[],
): Promise<Buffer | undefined> {
  try {
    return await readFile(resolve(root, path));
  } catch (error) {
    addIssue(issues, 'asset.missing', path, (error as Error).message);
    return undefined;
  }
}

function assetReferenceIssues(
  value: unknown,
  documentPath: string,
  issues: AssetIssue[],
  jsonPath = '$',
  inAssetRecord = false,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assetReferenceIssues(
        item,
        documentPath,
        issues,
        `${jsonPath}[${index}]`,
        inAssetRecord,
      ),
    );
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const isAssetValue = inAssetRecord || /(?:asset|image|source)$/i.test(key);
    if (typeof child === 'string' && isAssetValue) {
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(child) ||
        child.startsWith('//') ||
        child.startsWith('\\\\') ||
        /(^|[\\/])\.\.([\\/]|$)/.test(child)
      ) {
        addIssue(
          issues,
          'asset.non-local-reference',
          `${documentPath}:${jsonPath}.${key}`,
          `Expected a project-local asset path, received ${JSON.stringify(child)}`,
        );
      }
    } else {
      assetReferenceIssues(
        child,
        documentPath,
        issues,
        `${jsonPath}.${key}`,
        inAssetRecord || key === 'assets',
      );
    }
  }
}

async function validateLocalReferences(
  root: string,
  issues: AssetIssue[],
): Promise<void> {
  for (const directory of ['contracts/examples', 'src/content/levels']) {
    for (const path of await walkFiles(resolve(root, directory))) {
      if (!['.json', '.tmj'].includes(extname(path))) {
        continue;
      }
      try {
        const document = JSON.parse(await readFile(path, 'utf8')) as unknown;
        assetReferenceIssues(
          document,
          relative(root, path).replaceAll('\\', '/'),
          issues,
        );
      } catch (error) {
        addIssue(
          issues,
          'asset.document-unreadable',
          relative(root, path),
          (error as Error).message,
        );
      }
    }
  }
}

async function validateInitialLoad(
  root: string,
  issues: AssetIssue[],
): Promise<Record<string, number>> {
  const dist = resolve(root, 'dist');
  const indexPath = join(dist, 'index.html');
  const indexBytes = await readRequired(root, 'dist/index.html', issues);
  if (!indexBytes) {
    return {};
  }

  let commonBytes = gzipSync(indexBytes).byteLength;
  for (const path of await walkFiles(resolve(dist, 'assets'))) {
    const relativePath = relative(dist, path).replaceAll('\\', '/');
    if (/^assets\/maps\/[^/]+\/background\.webp$/.test(relativePath)) {
      continue;
    }
    if (
      !/\.(?:js|css|woff2?|ogg|mp3)$/i.test(path) &&
      !relativePath.startsWith('assets/objects/') &&
      !relativePath.startsWith('assets/ui/') &&
      relativePath !== 'assets/tiles/lunar-logical.png'
    ) {
      continue;
    }
    const bytes = await readFile(path);
    commonBytes += /\.(?:js|css)$/i.test(path)
      ? gzipSync(bytes).byteLength
      : bytes.byteLength;
  }

  const result: Record<string, number> = {};
  for (const sourcePath of BACKGROUND_PATHS) {
    const distPath = sourcePath.replace(/^public\//, 'dist/');
    const background = await readRequired(root, distPath, issues);
    if (!background) {
      continue;
    }
    const levelId = sourcePath.split('/').at(-2) ?? sourcePath;
    result[levelId] = commonBytes + background.byteLength;
    if (result[levelId] > ASSET_LIMITS.initialLoadBytes) {
      addIssue(
        issues,
        'asset.initial-load-budget',
        indexPath,
        `${levelId} initial load is ${result[levelId]} bytes`,
      );
    }
  }
  return result;
}

export async function inspectRepositoryAssets(
  root = process.cwd(),
  includeDist = false,
): Promise<AssetValidationReport> {
  const issues: AssetIssue[] = [];
  const backgrounds: AssetValidationReport['backgrounds'] = [];
  const hashes = new Map<string, string>();

  for (const path of BACKGROUND_PATHS) {
    const bytes = await readRequired(root, path, issues);
    if (!bytes) continue;
    try {
      const dimensions = readImageDimensions(bytes);
      if (dimensions.format !== 'webp') {
        addIssue(issues, 'asset.background-format', path, 'Expected WebP');
      }
      if (
        dimensions.width !== ASSET_LIMITS.backgroundWidth ||
        !ASSET_LIMITS.backgroundHeights.includes(
          dimensions.height as (typeof ASSET_LIMITS.backgroundHeights)[number],
        )
      ) {
        addIssue(
          issues,
          'asset.background-dimensions',
          path,
          `${dimensions.width}x${dimensions.height} is not 2048x1024/1536`,
        );
      }
      if (bytes.byteLength > ASSET_LIMITS.backgroundBytes) {
        addIssue(
          issues,
          'asset.background-budget',
          path,
          `${bytes.byteLength} > ${ASSET_LIMITS.backgroundBytes} bytes`,
        );
      }
      if (
        dimensions.width > ASSET_LIMITS.textureDimension ||
        dimensions.height > ASSET_LIMITS.textureDimension
      ) {
        addIssue(
          issues,
          'asset.texture-dimensions',
          path,
          `${dimensions.width}x${dimensions.height} exceeds 4096px`,
        );
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const duplicate = hashes.get(sha256);
      if (duplicate) {
        addIssue(
          issues,
          'asset.background-duplicate',
          path,
          `Content is identical to ${duplicate}`,
        );
      } else {
        hashes.set(sha256, path);
      }
      backgrounds.push({ path, bytes: bytes.length, ...dimensions, sha256 });
    } catch (error) {
      addIssue(issues, 'asset.image-invalid', path, (error as Error).message);
    }
  }

  let atlasBytes = 0;
  let atlasHasTransparency = false;
  let atlasTiles = 0;
  for (const path of await walkFiles(resolve(root, TILE_DIRECTORY))) {
    const repositoryPath = relative(root, path).replaceAll('\\', '/');
    if (repositoryPath !== ATLAS_PATH) {
      addIssue(
        issues,
        'asset.unexpected-tile-asset',
        repositoryPath,
        `Only ${ATLAS_PATH} is allowed in the production tile directory`,
      );
    }
  }
  const atlas = await readRequired(root, ATLAS_PATH, issues);
  if (atlas) {
    atlasBytes = atlas.byteLength;
    try {
      const dimensions = readImageDimensions(atlas);
      const tileSize = ASSET_LIMITS.logicalTileSize;
      if (
        dimensions.format !== 'png' ||
        dimensions.width % tileSize !== 0 ||
        dimensions.height % tileSize !== 0
      ) {
        addIssue(
          issues,
          'asset.atlas-grid',
          ATLAS_PATH,
          `Expected a PNG aligned to ${tileSize}px tiles`,
        );
      } else {
        atlasTiles =
          (dimensions.width / tileSize) * (dimensions.height / tileSize);
      }
      atlasHasTransparency = pngHasTransparentPixels(atlas);
      if (!atlasHasTransparency) {
        addIssue(
          issues,
          'asset.atlas-transparency',
          ATLAS_PATH,
          'Logical tiles must preserve the level background through alpha',
        );
      }
      if (
        atlasBytes > ASSET_LIMITS.atlasBytes ||
        atlasTiles > ASSET_LIMITS.atlasTileCount
      ) {
        addIssue(
          issues,
          'asset.atlas-budget',
          ATLAS_PATH,
          `${atlasBytes} bytes and ${atlasTiles} logical tiles`,
        );
      }
    } catch (error) {
      addIssue(
        issues,
        'asset.image-invalid',
        ATLAS_PATH,
        (error as Error).message,
      );
    }
  }

  const objectFiles = await walkFiles(resolve(root, OBJECT_DIRECTORY));
  let objectBytes = 0;
  for (const path of objectFiles) {
    const bytes = await readFile(path);
    objectBytes += bytes.byteLength;
    if (/\.(?:png|webp)$/i.test(path)) {
      try {
        const dimensions = readImageDimensions(bytes);
        if (
          dimensions.width > ASSET_LIMITS.textureDimension ||
          dimensions.height > ASSET_LIMITS.textureDimension
        ) {
          addIssue(
            issues,
            'asset.texture-dimensions',
            relative(root, path),
            `${dimensions.width}x${dimensions.height} exceeds 4096px`,
          );
        }
      } catch (error) {
        addIssue(
          issues,
          'asset.image-invalid',
          relative(root, path),
          (error as Error).message,
        );
      }
    }
  }
  if (objectBytes > ASSET_LIMITS.objectBytes) {
    addIssue(
      issues,
      'asset.object-budget',
      OBJECT_DIRECTORY,
      `${objectBytes} > ${ASSET_LIMITS.objectBytes} bytes`,
    );
  }

  await validateLocalReferences(root, issues);
  const initialLoadBytes = includeDist
    ? await validateInitialLoad(root, issues)
    : {};
  return {
    backgrounds,
    atlasBytes,
    atlasHasTransparency,
    atlasTiles,
    objectBytes,
    initialLoadBytes,
    issues,
  };
}
