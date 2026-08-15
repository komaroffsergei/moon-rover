import { parseArgs } from 'node:util';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const MAX_BACKGROUND_BYTES = 600_000;
const BACKGROUND_WIDTH = 2_048;
const BACKGROUND_HEIGHT = 1_536;

const BACKGROUND_SOURCES = [
  {
    id: 'tycho',
    source: 'exec-5df2e62c-eb75-411a-a732-e8272f30af37.png',
  },
  {
    id: 'tranquility',
    source: 'exec-57b91327-b829-4601-8448-83314e032014.png',
  },
  {
    id: 'south-pole',
    source: 'exec-acd02f0b-7d20-4a07-a891-a5d3063c8759.png',
  },
  {
    id: 'aitken',
    source: 'exec-b4bb4a89-2885-4fc5-9675-53bd7b43143b.png',
  },
  {
    id: 'shackleton',
    source: null,
  },
];

const { values } = parseArgs({
  options: {
    'atlas-only': { type: 'boolean', default: false },
    'background-source-dir': { type: 'string', default: '/generated' },
  },
});

async function writeIfChanged(outputPath, bytes) {
  let current;
  try {
    current = await readFile(outputPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (current?.equals(bytes)) {
    return 'unchanged';
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  return 'written';
}

async function renderLogicalAtlas(page) {
  const dataUrl = await page.evaluate(() => {
    const tileSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = tileSize * 3;
    canvas.height = tileSize;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is unavailable');
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Logical tiles are translucent overlays: the level WebP remains visible.
    // normal: subtle navigation tint with sparse crater markers.
    context.fillStyle = 'rgba(115, 121, 130, 0.08)';
    context.fillRect(0, 0, tileSize, tileSize);
    context.fillStyle = 'rgba(37, 42, 49, 0.22)';
    for (const [x, y, radius] of [
      [13, 15, 4],
      [43, 21, 6],
      [25, 45, 3],
      [53, 50, 2],
    ]) {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = 'rgba(137, 144, 153, 0.38)';
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, tileSize - 1, tileSize - 1);

    // rough/hazard: тёплая штриховка, заметная поверх любого фона.
    context.save();
    context.beginPath();
    context.rect(tileSize, 0, tileSize, tileSize);
    context.clip();
    context.fillStyle = 'rgba(96, 79, 69, 0.16)';
    context.fillRect(tileSize, 0, tileSize, tileSize);
    context.strokeStyle = 'rgba(213, 154, 82, 0.62)';
    context.lineWidth = 3;
    for (let offset = -tileSize; offset < tileSize * 2; offset += 12) {
      context.beginPath();
      context.moveTo(tileSize + offset, tileSize);
      context.lineTo(tileSize + offset + tileSize, 0);
      context.stroke();
    }
    context.strokeStyle = 'rgba(240, 189, 112, 0.82)';
    context.lineWidth = 2;
    context.strokeRect(tileSize + 2, 2, tileSize - 4, tileSize - 4);
    context.restore();

    // blocked: тёмная клетка с однозначным знаком запрета.
    context.fillStyle = 'rgba(37, 42, 49, 0.58)';
    context.fillRect(tileSize * 2, 0, tileSize, tileSize);
    context.strokeStyle = 'rgba(196, 73, 73, 0.9)';
    context.lineWidth = 8;
    context.beginPath();
    context.moveTo(tileSize * 2 + 13, 13);
    context.lineTo(tileSize * 3 - 13, tileSize - 13);
    context.moveTo(tileSize * 3 - 13, 13);
    context.lineTo(tileSize * 2 + 13, tileSize - 13);
    context.stroke();
    context.strokeStyle = 'rgba(224, 107, 95, 0.92)';
    context.lineWidth = 2;
    context.strokeRect(tileSize * 2 + 2, 2, tileSize - 4, tileSize - 4);

    return canvas.toDataURL('image/png');
  });

  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function renderBackground(page, sourcePath, preserveReadySource) {
  const sourceBytes = await readFile(sourcePath);
  const sourceDataUrl = `data:image/png;base64,${sourceBytes.toString('base64')}`;

  const result = await page.evaluate(
    async ({ sourceDataUrl, width, height, maxBytes, preserveReadySource }) => {
      const image = new Image();
      image.src = sourceDataUrl;
      await image.decode();

      if (
        preserveReadySource &&
        image.naturalWidth === width &&
        image.naturalHeight === height
      ) {
        return {
          dataUrl: null,
          qualityPercent: null,
          sourceWidth: image.naturalWidth,
          sourceHeight: image.naturalHeight,
        };
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas 2D context is unavailable');
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      const targetRatio = width / height;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      let sourceX = 0;
      let sourceY = 0;

      if (sourceRatio > targetRatio) {
        sourceWidth = Math.round(image.naturalHeight * targetRatio);
        sourceX = Math.floor((image.naturalWidth - sourceWidth) / 2);
      } else {
        sourceHeight = Math.round(image.naturalWidth / targetRatio);
        sourceY = Math.floor((image.naturalHeight - sourceHeight) / 2);
      }

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );

      for (let qualityPercent = 88; qualityPercent >= 32; qualityPercent -= 2) {
        const dataUrl = canvas.toDataURL('image/webp', qualityPercent / 100);
        const byteLength = Math.floor(
          ((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4,
        );
        if (byteLength <= maxBytes) {
          return {
            dataUrl,
            qualityPercent,
            sourceWidth: image.naturalWidth,
            sourceHeight: image.naturalHeight,
          };
        }
      }

      throw new Error(`Cannot meet ${maxBytes} byte WebP budget`);
    },
    {
      sourceDataUrl,
      width: BACKGROUND_WIDTH,
      height: BACKGROUND_HEIGHT,
      maxBytes: MAX_BACKGROUND_BYTES,
      preserveReadySource,
    },
  );

  if (result.dataUrl === null) {
    if (sourceBytes.byteLength > MAX_BACKGROUND_BYTES) {
      throw new Error(
        `Existing background exceeds ${MAX_BACKGROUND_BYTES} byte WebP budget`,
      );
    }
    return { ...result, bytes: sourceBytes };
  }

  return {
    ...result,
    bytes: Buffer.from(
      result.dataUrl.slice(result.dataUrl.indexOf(',') + 1),
      'base64',
    ),
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const atlasPath = resolve('public/assets/tiles/lunar-logical.png');
  const atlasBytes = await renderLogicalAtlas(page);
  const atlasStatus = await writeIfChanged(atlasPath, atlasBytes);
  console.log(
    `logical-atlas: ${atlasStatus}, 192x64, ${atlasBytes.byteLength} bytes`,
  );

  if (!values['atlas-only']) {
    const sourceDirectory = resolve(values['background-source-dir']);
    const sourceDirectoryStats = await stat(sourceDirectory);
    if (!sourceDirectoryStats.isDirectory()) {
      throw new Error(`${sourceDirectory} is not a directory`);
    }

    for (const background of BACKGROUND_SOURCES) {
      const outputPath = resolve(
        `public/assets/maps/${background.id}/background.webp`,
      );
      const sourcePath =
        background.source === null
          ? outputPath
          : resolve(sourceDirectory, background.source);
      const rendered = await renderBackground(
        page,
        sourcePath,
        background.source === null,
      );
      const status = await writeIfChanged(outputPath, rendered.bytes);
      console.log(
        `${background.id}: ${status}, ${rendered.sourceWidth}x${rendered.sourceHeight} -> ${BACKGROUND_WIDTH}x${BACKGROUND_HEIGHT}, ${rendered.qualityPercent === null ? 'preserved' : `q${rendered.qualityPercent}`}, ${rendered.bytes.byteLength} bytes`,
      );
    }
  }
} finally {
  await browser.close();
}
