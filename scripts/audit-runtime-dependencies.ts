import { realpath, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly license?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<
    Record<string, { readonly optional?: boolean } | undefined>
  >;
}

interface RuntimePackage {
  readonly directory: string;
  readonly id: string;
  readonly license: string;
  readonly manifest: PackageManifest;
}

const APPROVED_DIRECT_DEPENDENCIES = new Set([
  'phaser',
  'pure-rand',
  'react',
  'react-dom',
  'zod',
  'zustand',
]);

const FORBIDDEN_RUNTIME_PACKAGES = [
  /^maplibre(?:-|$)/i,
  /^leaflet$/i,
  /(?:^|-)pathfind(?:er|ing)?(?:-|$)/i,
  /(?:^|-)a-?star(?:-|$)/i,
  /^redux$/i,
  /^@reduxjs\/toolkit$/i,
  /^xstate$/i,
];

const PERMISSIVE_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

const COPYLEFT_LICENSE =
  /(?:^|[^A-Z])(?:AGPL|CDDL|EPL|EUPL|GPL|LGPL|MPL|OSL)(?:[-\s.(]|$)/i;
const LICENSE_FILE = /^(?:copying|licen[cs]e)(?:[.-]|$)/i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readManifest(directory: string): Promise<PackageManifest> {
  const path = join(directory, 'package.json');
  const input = JSON.parse(
    await readFile(path, 'utf8'),
  ) as Partial<PackageManifest>;
  if (
    typeof input.name !== 'string' ||
    input.name.length === 0 ||
    typeof input.version !== 'string' ||
    input.version.length === 0
  ) {
    throw new Error(`${path}: package name/version отсутствует`);
  }
  return input as PackageManifest;
}

async function manifestIfPresent(
  directory: string,
): Promise<PackageManifest | undefined> {
  try {
    return await readManifest(directory);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

async function findPackageDirectory(
  importerDirectory: string,
  dependencyName: string,
): Promise<string | undefined> {
  const nameSegments = dependencyName.split('/');
  let directory = importerDirectory;
  while (true) {
    const candidates = new Set([
      join(directory, 'node_modules', ...nameSegments),
      join(directory, ...nameSegments),
    ]);
    for (const candidate of candidates) {
      const manifest = await manifestIfPresent(candidate);
      if (manifest?.name === dependencyName) return realpath(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

async function resolveInstalledPackage(
  importerDirectory: string,
  dependencyName: string,
  optional: boolean,
): Promise<string | undefined> {
  const directory = await findPackageDirectory(
    importerDirectory,
    dependencyName,
  );
  if (directory !== undefined || optional) return directory;
  throw new Error(
    `${dependencyName}: production dependency не разрешается из ${importerDirectory}`,
  );
}

function runtimeRequirements(
  manifest: PackageManifest,
): Array<{ name: string; optional: boolean }> {
  const requirements = new Map<string, boolean>();
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    requirements.set(name, false);
  }
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    if (!requirements.has(name)) requirements.set(name, true);
  }
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional !== true) {
      requirements.set(name, false);
    }
  }
  return [...requirements]
    .map(([name, optional]) => ({ name, optional }))
    .sort((left, right) => compareText(left.name, right.name));
}

function validateLicense(id: string, license: unknown): string {
  if (
    typeof license !== 'string' ||
    license.trim().length === 0 ||
    /^(?:none|unlicensed|unknown)$/i.test(license.trim())
  ) {
    throw new Error(`${id}: отсутствует распознанная лицензия`);
  }
  const normalized = license.trim();
  if (COPYLEFT_LICENSE.test(normalized)) {
    throw new Error(`${id}: copyleft-лицензия ${normalized} запрещена`);
  }
  if (!PERMISSIVE_LICENSES.has(normalized)) {
    throw new Error(
      `${id}: лицензия ${normalized} не входит в permissive allowlist`,
    );
  }
  return normalized;
}

function validatePackageName(id: string, name: string): void {
  if (FORBIDDEN_RUNTIME_PACKAGES.some((pattern) => pattern.test(name))) {
    throw new Error(`${id}: пакет запрещён runtime dependency policy`);
  }
}

async function inspectPackage(directory: string): Promise<RuntimePackage> {
  const manifest = await readManifest(directory);
  const id = `${manifest.name}@${manifest.version}`;
  validatePackageName(id, manifest.name);
  const license = validateLicense(id, manifest.license);
  const files = await readdir(directory);
  if (!files.some((name) => LICENSE_FILE.test(name))) {
    throw new Error(`${id}: в package root отсутствует LICENSE/COPYING`);
  }
  return { directory, id, license, manifest };
}

async function productionClosure(
  projectRoot: string,
): Promise<RuntimePackage[]> {
  const rootManifest = await readManifest(projectRoot);
  const directDependencies = Object.keys(
    rootManifest.dependencies ?? {},
  ).sort();
  const unapproved = directDependencies.filter(
    (name) => !APPROVED_DIRECT_DEPENDENCIES.has(name),
  );
  if (unapproved.length > 0) {
    throw new Error(
      `Неутверждённые direct production dependencies: ${unapproved.join(', ')}`,
    );
  }

  const queue: Array<{ importer: string; name: string; optional: boolean }> =
    directDependencies.map((name) => ({
      importer: projectRoot,
      name,
      optional: false,
    }));
  const visitedDirectories = new Set<string>();
  const packages = new Map<string, RuntimePackage>();

  while (queue.length > 0) {
    const requirement = queue.shift();
    if (requirement === undefined) break;
    const directory = await resolveInstalledPackage(
      requirement.importer,
      requirement.name,
      requirement.optional,
    );
    if (directory === undefined || visitedDirectories.has(directory)) continue;
    visitedDirectories.add(directory);

    const runtimePackage = await inspectPackage(directory);
    packages.set(runtimePackage.id, runtimePackage);
    for (const dependency of runtimeRequirements(runtimePackage.manifest)) {
      queue.push({ importer: directory, ...dependency });
    }
  }

  return [...packages.values()].sort((left, right) =>
    compareText(left.id, right.id),
  );
}

function validateNotices(
  packages: readonly RuntimePackage[],
  notices: string,
): void {
  const lines = notices.split(/\r?\n/);
  for (const runtimePackage of packages) {
    const marker = `\`${runtimePackage.id}\``;
    const matches = lines.filter((line) => line.includes(marker));
    if (matches.length !== 1) {
      throw new Error(
        `${runtimePackage.id}: THIRD_PARTY_NOTICES должен содержать ровно одну строку ${marker}`,
      );
    }
    const notice = matches[0] ?? '';
    if (
      !notice.includes(runtimePackage.license) ||
      !/copyright/i.test(notice)
    ) {
      throw new Error(
        `${runtimePackage.id}: notice должен содержать license id и Copyright`,
      );
    }
  }

  const licenses = new Set(packages.map(({ license }) => license));
  for (const license of [...licenses].sort()) {
    if (!notices.includes(`### ${license}`)) {
      throw new Error(
        `THIRD_PARTY_NOTICES: отсутствует текст лицензии под заголовком ### ${license}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const packages = await productionClosure(projectRoot);
  const notices = await readFile(
    join(projectRoot, 'THIRD_PARTY_NOTICES.md'),
    'utf8',
  );
  validateNotices(packages, notices);
  console.log(
    `Runtime dependency audit passed: ${packages.length} packages (${packages.map(({ id }) => id).join(', ')}).`,
  );
}

await main().catch((error: unknown) => {
  console.error(`Runtime dependency audit failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
