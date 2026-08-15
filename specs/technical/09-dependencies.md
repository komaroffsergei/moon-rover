# Политика зависимостей

## Production allowlist

`phaser`, `react`, `react-dom`, `zustand`, `zod`, `pure-rand`.

## Dev allowlist

`typescript`, `vite`, React plugin Vite, `vitest`, `@playwright/test`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `prettier`, типы React/Node и минимальный TS runner для content script.

## Правила

- точные версии фиксируются lockfile в T001;
- брать актуальные patch выбранных major после совместной проверки;
- не добавлять UI framework, pathfinding, RNG, schema, collection/date utilities;
- новый пакет: доказать потребность, сравнить с существующим API, проверить активность/лицензию/размер/transitive deps, записать решение, добавить интеграционный тест.
