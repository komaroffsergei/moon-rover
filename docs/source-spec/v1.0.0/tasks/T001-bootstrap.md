# T001. Каркас проекта и Docker-контур

**Feature spec:** `features/F001-bootstrap.md`  
**Зависит от:** нет

## Цель

Создать минимальный запускаемый каркас, в котором все команды разработки выполняются через Docker Compose.

## Контекст задачи

Открыть только перечисленные файлы и уже созданный код, непосредственно связанный с задачей:

- `AGENTS.md`
- `features/F001-bootstrap.md`
- `specs/technical/01-stack.md`
- `specs/technical/03-project-layout.md`
- `specs/technical/13-module-boundaries.md`
- `specs/technical/08-docker.md`
- `specs/technical/09-dependencies.md`

Не читать весь пакет «на всякий случай». Если нужное правило отсутствует, применить порядок приоритетов из `README.md`.

## В scope

- Vite + React + TypeScript strict;
- минимальная Phaser-сцена-заглушка;
- pnpm lockfile;
- Dockerfile, compose.yaml, nginx.conf, .dockerignore;
- lint, format:check, typecheck, test, build scripts;

## Ожидаемые результаты

- `package.json и pnpm-lock.yaml`;
- `src/main.tsx, src/app/App.tsx, src/game/createGame.ts`;
- `Dockerfile, compose.yaml, nginx.conf`;
- `конфигурации TypeScript/Vite/ESLint/Prettier/Vitest`;
- `ESLint-ограничения импортов по зонам ответственности`;

Конкретные имена внутренних файлов можно скорректировать, если сохраняются границы ответственности и это объяснено в отчёте.

## Критерии приёмки

- [ ] `docker compose up app` открывает страницу без ошибок консоли;
- [ ] `docker compose run --rm verify pnpm lint` проходит;
- [ ] typecheck, test и build проходят в контейнере;
- [ ] production target содержит только статическую сборку и nginx;
- [ ] запрещённый cross-layer import ловится ESLint без отдельной архитектурной зависимости;

## Не входит

- игровая логика;
- карты и контент;
- полноценный UI;
- E2E-браузеры;

## Обязательный рабочий цикл

1. До изменений записать план максимум из 8 пунктов.
2. Найти самый маленький законченный вертикальный срез задачи.
3. Сначала добавить/уточнить проверяемые тесты или валидаторы требования.
4. Реализовать минимальный код, необходимый для прохождения этих проверок.
5. Запустить команды через Docker из `quality/THREE_PASS_WORKFLOW.md`.
6. Просмотреть итоговый diff и удалить код, не нужный этой задаче.
7. Создать `reports/T001.md` по `quality/REPORT_TEMPLATE.md`.

## Запрет завершения

Задача не считается выполненной по фразе «должно работать». В отчёте нужны фактические команды, их результат и ссылки на тесты, доказывающие каждый критерий.
