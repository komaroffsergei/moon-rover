# F001. Каркас, Docker и quality gates

## Цель

Создать минимальный запускаемый проект без игровой логики.

## Требования

- Vite + React + TypeScript strict + пустая Phaser scene;
- multi-stage Dockerfile и Compose dev/test/app/e2e;
- pinned pnpm, lockfile, ESLint, Prettier, Vitest, Playwright;
- scripts lint/typecheck/test/validate:content/build/test:e2e;
- README и CODEMAP;

## Не входит

- Симуляция, карты и финальный дизайн;

## Приёмка

Все Docker-команды проходят; nginx отдаёт приложение; console errors отсутствуют.
