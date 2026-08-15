import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const projectPrefix = String.raw`(?:(?:\./)*(?:\.\./(?:\./)*)+(?:src/)?|@/|src/)`;
const normalizedParentTraversal = String.raw`^(?:(?:\./)*(?:\.\./)+|@/|src/)(?:[^./][^/]*/)(?:[^/]+/)*\.\.(?:/|$)`;
const uiFrameworks = ['phaser', 'react', 'react-dom', 'zustand'];

function importExpressionSelector(regex) {
  return `ImportExpression[source.value=/${regex.replaceAll('/', String.raw`\/`)}/]`;
}

function restrictedImports(forbiddenZones, forbiddenPackages = []) {
  const patterns = [
    {
      regex: normalizedParentTraversal,
      message:
        'Импорт не должен менять уже выбранную зону через parent traversal.',
    },
  ];

  if (forbiddenZones.length > 0) {
    patterns.push({
      regex: `^${projectPrefix}(?:${forbiddenZones.join('|')})(?:/|$)`,
      message: 'Импорт нарушает разрешённое направление между зонами src.',
    });
  }

  if (forbiddenPackages.length > 0) {
    patterns.push({
      regex: `^(?:${forbiddenPackages.join('|')})(?:/|$)`,
      message: 'Эта зона не должна зависеть от UI/game framework.',
    });
  }

  return ['error', { patterns }];
}

function restrictedDynamicImports(forbiddenZones, forbiddenPackages = []) {
  const restrictions = [
    {
      selector: 'ImportExpression:not([source.type="Literal"])',
      message:
        'Dynamic import должен использовать строковый literal для проверки границы.',
    },
    {
      selector: importExpressionSelector(normalizedParentTraversal),
      message:
        'Dynamic import не должен менять уже выбранную зону через parent traversal.',
    },
  ];

  if (forbiddenZones.length > 0) {
    restrictions.push({
      selector: importExpressionSelector(
        `^${projectPrefix}(?:${forbiddenZones.join('|')})(?:/|$)`,
      ),
      message:
        'Dynamic import нарушает разрешённое направление между зонами src.',
    });
  }

  if (forbiddenPackages.length > 0) {
    restrictions.push({
      selector: importExpressionSelector(
        `^(?:${forbiddenPackages.join('|')})(?:/|$)`,
      ),
      message: 'Эта зона не должна динамически загружать UI/game framework.',
    });
  }

  return ['error', ...restrictions];
}

const boundaryPolicies = [
  {
    zone: 'app',
    forbiddenZones: ['tests'],
    forbiddenPackages: [],
  },
  {
    zone: 'shared',
    forbiddenZones: [
      'app',
      'domain',
      'content',
      'simulation',
      'game',
      'ui',
      'tests',
    ],
    forbiddenPackages: uiFrameworks,
  },
  {
    zone: 'domain',
    forbiddenZones: ['app', 'content', 'simulation', 'game', 'ui', 'tests'],
    forbiddenPackages: uiFrameworks,
  },
  {
    zone: 'content',
    forbiddenZones: ['app', 'simulation', 'game', 'ui', 'tests'],
    forbiddenPackages: uiFrameworks,
  },
  {
    zone: 'simulation',
    forbiddenZones: ['app', 'content', 'game', 'ui', 'tests'],
    forbiddenPackages: uiFrameworks,
  },
  {
    zone: 'game',
    forbiddenZones: ['app', 'content', 'simulation', 'ui', 'tests'],
    forbiddenPackages: ['react', 'react-dom', 'zustand'],
  },
  {
    zone: 'ui',
    forbiddenZones: ['app', 'content', 'simulation', 'game', 'tests'],
    forbiddenPackages: ['phaser'],
  },
];

export default defineConfig(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  ...boundaryPolicies.map(({ zone, forbiddenZones, forbiddenPackages }) => ({
    files: [`src/${zone}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': restrictedImports(
        forbiddenZones,
        forbiddenPackages,
      ),
      'no-restricted-syntax': restrictedDynamicImports(
        forbiddenZones,
        forbiddenPackages,
      ),
    },
  })),
);
