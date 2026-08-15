# Тестирование

Все команды проекта выполняются через Docker Compose. Локальные Node.js, pnpm и
браузеры не участвуют в доказательстве готовности.

## Полный gate

```bash
docker compose run --rm --build verify
```

Default command сервиса `verify` запускает последовательно:

1. `format:check`;
2. `lint`;
3. `typecheck`;
4. Vitest unit/integration/content tests;
5. production content validation;
6. deterministic runtime dependency/license audit;
7. production Vite build и dist asset budget validation.

E2E выполняется отдельно, потому что ему нужен браузер и healthy web service:

```bash
docker compose run --rm e2e
```

## Уровни тестов

| Уровень     | Что доказывает                                                                                           | Основные файлы                                              |
| ----------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Unit        | fixed-step, capped cargo, FREE_NAVIGATION/supercover, battery, incidents, rescue, radio, outcome         | `tests/simulation-*.test.ts`                                |
| Content     | JSON/Tiled schemas, topology, procedural placement capacity/safety, asset budgets                        | `tests/content-*.test.ts`, `tests/asset-validation.test.ts` |
| Integration | `ContentBundle + placement → SimulationEngine → controller/store/view`, fresh session seed               | `tests/app-*.test.ts`, `tests/game-store.test.ts`           |
| Render/UI   | organic zones, rounded routes, rover heading, projection, camera, semantic states/actions                | `tests/game-*.test.ts`, `tests/ui-*.test.tsx`               |
| Boundaries  | разрешённые imports и отсутствие production cycles                                                       | `tests/module-boundaries.test.ts`                           |
| Browser     | five-map placement, continuous reroute/U-turn, capped arrival unload, recovery/rescue and runtime health | `tests/e2e/*.spec.ts`                                       |

Unit и integration tests не используют sleep, browser clock или случайный
`Math.random()`: входы задаются явными командами, fixed-step и seed. Ускоренный
`tests/content-level-smoke.test.ts` проигрывает все пять 480-секундных смен
без ожидания реального времени.

Production placement намеренно получает свежие значения Web Crypto на каждую
сессию. `tests/app-placement-seed.test.ts` проверяет это через injected random
source, не делая тест недетерминированным; E2E использует golden seeds или
явный authoring layout. `tests/content-facility-placement.test.ts` таблично
проверяет все карты: центры различны, walkable, достижимы от выбранной безопасной
базы и воспроизводятся для одного placement seed.

Ядро свободной навигации закреплено
`tests/simulation-free-navigation.test.ts`: visibility legs проходят
консервативный supercover без срезания blocked-углов, движение и расход батареи
непрерывны, а reroute начинается из точной текущей позиции и допускает
немедленный U-turn. `tests/game-map-presentation-geometry.test.ts` отдельно
проверяет seeded organic hazard-контуры всех production-карт и скруглённый
маршрут с точными endpoints. Capped arrival transfer и сохранение остатка груза
покрыты `tests/simulation-rover-cargo.test.ts`.

## Целевые команды

```bash
# Один Vitest-файл
docker compose run --rm --build verify \
  pnpm exec vitest run tests/simulation-clock.test.ts

# Только статические проверки
docker compose run --rm --build verify pnpm format:check
docker compose run --rm --build verify pnpm lint
docker compose run --rm --build verify pnpm typecheck

# Контент и source assets
docker compose run --rm --build verify pnpm validate:content
docker compose run --rm --build verify pnpm validate:assets

# Offline production closure/license/notice audit
docker compose run --rm --build verify pnpm audit:runtime

# Registry advisory audit (требует сеть; результат записывается в release report)
docker compose run --rm --no-deps dev pnpm audit --audit-level=low
```

После исправления локализованной ошибки всё равно повторяются полный `verify` и
релевантный browser suite.

## Что проверяет dependency audit

`scripts/audit-runtime-dependencies.ts` начинает с root `dependencies`, проходит
установленные required dependencies, optional dependencies текущей платформы и
обязательные peer dependencies без чтения dev closure. Проверка
отклоняет:

- direct dependency вне утверждённого production allowlist;
- явно запрещённые map/pathfinding/state packages;
- пакет без name/version/license или файла LICENSE/COPYING;
- copyleft либо неизвестную permissive policy лицензию;
- пакет `name@version`, отсутствующий ровно одной строкой с license и Copyright
  в `THIRD_PARTY_NOTICES.md`.

Список сортируется, поэтому одинаковый lockfile даёт стабильный отчёт. Проверка
не заменяет сетевой advisory audit `pnpm audit`.

## Playwright

`compose.yaml` использует image `mcr.microsoft.com/playwright`, версия которого
буквально совпадает с `@playwright/test` в `package.json`. Suite выполняется
одним worker без retries, с viewport `1280×720`. Автоматические screenshot и
trace сохраняются только при ошибке в `test-results`.

Test-only fixtures/diagnostics включаются build-time режимом тестового web
service и отсутствуют в production bundle. Assertions предпочитают доступный UI
и semantic roles; `data-testid` применяется только там, где роль/текст не дают
стабильной точки наблюдения.

`tests/e2e/phaser-map.spec.ts` проверяет реальный canvas-intent ПКМ, diagonal
FREE_NAVIGATION, reroute/U-turn без скачка позиции, blocked target, heading,
вращение колёс, пыль и reduced-motion. `tests/e2e/t014-free-navigation.spec.ts`
запускает procedural placement на всех пяти картах и подтверждает полную
capped-разгрузку по прибытии с сохранением избытка у ровера.

T016 добавляет pixel-level canvas-проверку
`tests/e2e/t016-rover-hud.spec.ts`: у выбранного ровера нет синего selection-
ring, а cargo занимает одну сегментированную шкалу. Файл
`tests/e2e/t016-ui-regressions.spec.ts` проверяет квадратные icon-only controls
без overflow и повторное открытие radio/inspector. Camera-сценарий в
`tests/e2e/phaser-map.spec.ts` закрепляет cover-fit для 1280×720 и 1920×1080,
а также изменение zoom кнопками и колесом.

Проверка production nginx:

```bash
docker compose up --build -d --wait app
docker compose run --rm --no-deps \
  -e PLAYWRIGHT_BASE_URL=http://moon-courier-nginx:8080 \
  -e PLAYWRIGHT_PRODUCTION_BOUNDARY=1 e2e \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile \
    --store-dir=/pnpm/store && pnpm exec playwright test \
    tests/e2e/production-boundary.spec.ts tests/e2e/level-catalog.spec.ts'
```

После запуска дополнительно доступны read-only проверки health/static response:

```bash
docker compose exec -T app wget -qO- http://127.0.0.1:8080/healthz
```

## Content и asset failures

Content errors имеют вид `code path: message`; сначала исправляется самый ранний
ошибочный документ, затем bundle валидируется заново. Для карты нельзя обходить
cross-reference/topology checks отдельным schema parse.

`validate:assets` без аргумента проверяет source assets. Dist budgets проверяются
после свежего Vite build автоматически командой `pnpm build`; запуск
`validate:assets --dist` без свежего `dist` не является release evidence.

## Release-последовательность

1. Запустить полный `verify` из чистого Docker build.
2. Запустить полный Playwright suite против test/dev service.
3. Собрать и дождаться healthy `app`, затем пройти production browser smoke.
4. Проверить отсутствие console errors, failed requests, secrets/local paths и
   dev tools в runtime image.
5. Выполнить три прохода `quality/THREE_PASS_WORKFLOW.md` и записать фактические
   команды в `reports/Txxx.md`.
