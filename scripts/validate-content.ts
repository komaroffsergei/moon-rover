import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import {
  ContentValidationError,
  loadBalance,
  loadIncidentProfiles,
  loadContentBundle,
  loadLevelMeta,
  loadRadioContent,
  loadTheme,
  loadTiledMap,
  parseJsonText,
} from '../src/content';

const examplesRoot = resolve('contracts/examples');
const files = (await readdir(examplesRoot))
  .filter((name) => ['.json', '.tmj'].includes(extname(name)))
  .sort();

const levelsRoot = resolve('src/content/levels');

async function readJson(path: string): Promise<unknown> {
  return parseJsonText(await readFile(path, 'utf8'), path);
}

function validateExample(fileName: string, input: unknown): void {
  if (fileName.endsWith('.tmj')) return void loadTiledMap(input);
  if (fileName.startsWith('balance.')) return void loadBalance(input);
  if (fileName.startsWith('incidents.'))
    return void loadIncidentProfiles(input);
  if (fileName.startsWith('level-')) return void loadLevelMeta(input);
  if (fileName.startsWith('radio.')) return void loadRadioContent(input);
  if (fileName.startsWith('theme.')) return void loadTheme(input);

  throw new ContentValidationError(fileName, [
    {
      code: 'content.unknown-document',
      path: '$',
      message: 'Для example-файла не определён отдельный контракт',
    },
  ]);
}

for (const fileName of files) {
  const path = join(examplesRoot, fileName);
  const input = await readJson(path);
  validateExample(fileName, input);
  console.log(`✓ ${fileName}`);
}

loadContentBundle({
  balance: await readJson(join(examplesRoot, 'balance.default.json')),
  balanceProfileId: 'default',
  incidents: await readJson(join(examplesRoot, 'incidents.default.json')),
  levelMeta: await readJson(join(examplesRoot, 'level-02-shackleton.json')),
  map: await readJson(join(examplesRoot, 'shackleton-rift.tmj')),
  radio: await readJson(join(examplesRoot, 'radio.ru.json')),
  theme: await readJson(join(examplesRoot, 'theme.realistic-dark.json')),
});
console.log('✓ coherent contracts/examples bundle');

const levelMetaFiles = (await readdir(levelsRoot))
  .filter((name) => /^level-\d{2}-[a-z0-9-]+\.json$/.test(name))
  .sort();
if (levelMetaFiles.length !== 5) {
  throw new ContentValidationError('production-level-catalog', [
    {
      code: 'content.level-count',
      path: '$',
      message: `Ожидалось ровно 5 production level metadata, получено ${levelMetaFiles.length}`,
    },
  ]);
}

const common = {
  balance: await readJson(join(examplesRoot, 'balance.default.json')),
  balanceProfileId: 'default',
  incidents: await readJson(join(examplesRoot, 'incidents.default.json')),
  radio: await readJson(join(examplesRoot, 'radio.ru.json')),
};
const seenOrdinals = new Set<number>();
for (const fileName of levelMetaFiles) {
  const levelMetaSource = await readJson(join(levelsRoot, fileName));
  const levelMeta = loadLevelMeta(levelMetaSource);
  const mapPath = join(levelsRoot, levelMeta.tiledMap);
  const themePath = join(levelsRoot, `theme.${levelMeta.themeId}.json`);
  const bundle = loadContentBundle({
    ...common,
    levelMeta: levelMetaSource,
    map: await readJson(mapPath),
    theme: await readJson(themePath),
  });
  seenOrdinals.add(bundle.levelMeta.ordinal);
  console.log(`✓ production ${bundle.levelMeta.id}`);
}
if ([1, 2, 3, 4, 5].some((ordinal) => !seenOrdinals.has(ordinal))) {
  throw new ContentValidationError('production-level-catalog', [
    {
      code: 'content.level-ordinals',
      path: '$',
      message: 'Production catalog должен содержать ordinals 1, 2, 3, 4 и 5',
    },
  ]);
}

console.log(
  `Content validation passed: ${files.length} example-файлов и ${levelMetaFiles.length} production bundles.`,
);
