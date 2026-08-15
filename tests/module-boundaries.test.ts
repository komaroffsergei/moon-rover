import { ESLint } from 'eslint';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const eslint = new ESLint({
  cwd: projectRoot,
  overrideConfigFile: resolve(projectRoot, 'eslint.config.mjs'),
});

const boundaryRuleIds = new Set([
  'no-restricted-imports',
  'no-restricted-syntax',
]);

function countBoundaryErrors(
  messages: readonly { ruleId: string | null; severity: number }[],
): number {
  return messages.filter(
    ({ ruleId, severity }) =>
      ruleId !== null && boundaryRuleIds.has(ruleId) && severity === 2,
  ).length;
}

const cases = [
  ['shared → shared', 'src/shared/probe.ts', './format', 0],
  ['shared ↛ domain', 'src/shared/probe.ts', '../domain/model', 1],
  ['domain → shared', 'src/domain/probe.ts', '../shared/id', 0],
  ['domain ↛ game', 'src/domain/probe.ts', '../game/createGame', 1],
  ['content → domain', 'src/content/probe.ts', '../domain/model', 0],
  [
    'content ↛ simulation',
    'src/content/probe.ts',
    '../simulation/createSimulation',
    1,
  ],
  ['simulation → domain', 'src/simulation/probe.ts', '../domain/model', 0],
  [
    'nested simulation ↛ content',
    'src/simulation/engine/probe.ts',
    '../../content/runtime',
    1,
  ],
  ['simulation ↛ Phaser', 'src/simulation/probe.ts', 'phaser', 1],
  ['game → domain', 'src/game/probe.ts', '../domain/model', 0],
  ['game → Phaser', 'src/game/probe.ts', 'phaser', 0],
  ['game ↛ simulation', 'src/game/probe.ts', '../simulation/controller', 1],
  [
    'game ↛ simulation через избыточный ./',
    'src/game/probe.ts',
    './../simulation/controller',
    1,
  ],
  [
    'game ↛ simulation через нормализуемый parent traversal',
    'src/game/probe.ts',
    '../domain/../simulation/controller',
    1,
  ],
  ['game ↛ ui', 'src/game/probe.ts', '../ui/Panel', 1],
  ['ui → shared', 'src/ui/probe.tsx', '../shared/id', 0],
  ['ui → React', 'src/ui/probe.tsx', 'react', 0],
  ['ui ↛ game', 'src/ui/probe.tsx', '../game/createGame', 1],
  ['ui ↛ Phaser', 'src/ui/probe.tsx', 'phaser', 1],
  ['UI store → domain', 'src/ui/store/probe.ts', '../../domain/model', 0],
  ['UI store → Zustand', 'src/ui/store/probe.ts', 'zustand/vanilla', 0],
  ['UI store ↛ game', 'src/ui/store/probe.ts', '../../game/mapGamePort', 1],
  [
    'UI store ↛ simulation',
    'src/ui/store/probe.ts',
    '../../simulation/engine',
    1,
  ],
  ['app → game', 'src/app/probe.tsx', '../game/createGame', 0],
  ['app ↛ tests', 'src/app/probe.tsx', '../../tests/helper', 1],
] as const;

const dynamicCases = [
  [
    'simulation ↛ dynamic Phaser',
    'src/simulation/probe.ts',
    "void import('phaser');\n",
    1,
  ],
  [
    'game ↛ dynamic simulation',
    'src/game/probe.ts',
    "void import('../simulation/controller');\n",
    1,
  ],
  [
    'game ↛ dynamic simulation через parent traversal',
    'src/game/probe.ts',
    "void import('../domain/../simulation/controller');\n",
    1,
  ],
  [
    'simulation ↛ вычисляемый dynamic import',
    'src/simulation/probe.ts',
    "const zone = 'domain'; void import('../' + zone);\n",
    1,
  ],
  [
    'app → dynamic game',
    'src/app/probe.tsx',
    "void import('../game/createGame');\n",
    0,
  ],
] as const;

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function resolveSourceImport(
  importer: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => sourceFiles.has(candidate)) ?? null;
}

function sourceImports(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function productionImportCycles(): readonly (readonly string[])[] {
  const sourceRoot = resolve(projectRoot, 'src');
  const sourceFiles = collectSourceFiles(sourceRoot);
  const sourceFileSet = new Set(sourceFiles);
  const imports = new Map(
    sourceFiles.map((filePath) => [
      filePath,
      sourceImports(filePath).flatMap((specifier) => {
        const resolvedImport = resolveSourceImport(
          filePath,
          specifier,
          sourceFileSet,
        );
        return resolvedImport === null ? [] : [resolvedImport];
      }),
    ]),
  );
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  function visit(filePath: string): void {
    state.set(filePath, 'visiting');
    stack.push(filePath);
    for (const importedFile of imports.get(filePath) ?? []) {
      if (state.get(importedFile) === undefined) {
        visit(importedFile);
        continue;
      }
      if (state.get(importedFile) !== 'visiting') continue;
      const cycleStart = stack.indexOf(importedFile);
      const cycle = [...stack.slice(cycleStart), importedFile].map((entry) =>
        relative(sourceRoot, entry).replaceAll('\\', '/'),
      );
      const cycleKey = [...new Set(cycle)].sort().join('|');
      if (!cycleKeys.has(cycleKey)) {
        cycleKeys.add(cycleKey);
        cycles.push(cycle);
      }
    }
    stack.pop();
    state.set(filePath, 'visited');
  }

  for (const filePath of sourceFiles.sort()) {
    if (state.get(filePath) === undefined) visit(filePath);
  }
  return cycles;
}

describe('границы импортов', () => {
  it.each(cases)(
    '%s',
    async (_name, filePath, specifier, expectedBoundaryErrors) => {
      const [result] = await eslint.lintText(`import '${specifier}';\n`, {
        filePath: resolve(projectRoot, filePath),
      });

      if (!result) {
        throw new Error('ESLint не вернул результат для виртуального файла.');
      }

      expect(countBoundaryErrors(result.messages)).toBe(expectedBoundaryErrors);
    },
    15_000,
  );

  it.each(dynamicCases)(
    '%s',
    async (_name, filePath, source, expectedBoundaryErrors) => {
      const [result] = await eslint.lintText(source, {
        filePath: resolve(projectRoot, filePath),
      });

      if (!result) {
        throw new Error('ESLint не вернул результат для виртуального файла.');
      }

      expect(countBoundaryErrors(result.messages)).toBe(expectedBoundaryErrors);
    },
    15_000,
  );

  it('production import graph не содержит циклов', () => {
    const cycles = productionImportCycles();
    expect(
      cycles,
      `Обнаружены циклы:\n${cycles.map((cycle) => cycle.join(' → ')).join('\n')}`,
    ).toEqual([]);
  }, 15_000);
});
