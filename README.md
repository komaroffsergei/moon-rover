# Moon Courier Crisis

Moon Courier Crisis — браузерная диспетчерская лунной логистики. Игрок выбирает
одну из пяти карт, отправляет курьерские роверы и ремонтную бригаду правым
кликом, поддерживает кислород, еду и оборудование центров и реагирует на
происшествия в течение восьмиминутной смены.

React отвечает за экраны и панели, Phaser — за карту и ввод, а детерминированная
TypeScript-симуляция остаётся единственным источником игровых правил. Контент
загружается из локальных JSON/Tiled-файлов и валидируется до запуска сессии.

## Требования

- Docker Desktop с Docker Compose;
- свободные порты `5173` для dev и `8080` для production preview.

Локальные Node.js и pnpm не требуются. Node 24, pnpm 11 и точные версии npm
пакетов задаются `Dockerfile`, `package.json` и `pnpm-lock.yaml`.

## Быстрый старт

Production image собирается и запускается одной командой:

```bash
docker compose up --build app
```

После появления статуса `healthy` игра доступна на
`http://localhost:8080`. Для разработки с Vite:

```bash
docker compose up --build dev
```

Dev-сервер доступен на `http://localhost:5173`.

## Игровой цикл

1. Выберите Тихо, Шеклтон, Море Спокойствия, Южный полюс или Лабиринт Эйткена
   и откройте брифинг.
   Каждая новая production-сессия заново выбирает безопасную позицию базы из
   валидированных вариантов и процедурно размещает научные центры в различных
   достижимых проходимых точках карты.
2. После старта прочитайте по одной заявке от каждого неполного центра: она
   сообщает его наибольший дефицит, но не резервирует ровер или груз.
3. Выберите ровер левым кликом и нажмите правой кнопкой на другую достижимую
   проходимую точку. Он сразу отправится по детерминированному visibility-маршруту
   с учётом длины, рельефа и риска; supercover не позволяет срезать угол
   непроходимой зоны. Тем же действием маршрут перестраивается из точной текущей
   позиции во время движения, включая немедленный разворот назад.
4. При конечном прибытии база автоматически заряжает и восстанавливает
   сохранённый груз, а научный центр автоматически принимает каждый из трёх
   ресурсов до своей ёмкости. Непринятый избыток остаётся у ровера. Проезд через
   точку базы или центра этих эффектов не вызывает.
5. Используйте
   ремонт/спасение/передачу батареи при происшествиях.
6. Сохраните все центры рабочими до конца смены. Возвращать роверы на базу для
   победы не требуется.

Видимые запасы, груз, батарея и объёмы доставки округляются до ближайшего
целого, тогда как симуляция сохраняет дробные значения; countdown и объёмы
стартовых заявок округляются вверх.

Полные реализованные правила и аварийные состояния описаны в
[`docs/GAME_RULES.md`](docs/GAME_RULES.md).

## Проверки и команды

```bash
# format + lint + typecheck + unit/integration + content + dependency audit + build
docker compose run --rm --build verify

# Одна проверка в том же контейнерном окружении
docker compose run --rm --build verify pnpm typecheck

# Playwright против healthy dev-сервера
docker compose run --rm e2e

# Детерминированный runtime dependency/license audit
docker compose run --rm --build verify pnpm audit:runtime
```

Чтобы проверить UI-only smoke и границу отсутствия test fixtures против
production nginx без неявного запуска dev-сервиса:

```bash
docker compose up --build -d --wait app
docker compose run --rm --no-deps \
  -e PLAYWRIGHT_BASE_URL=http://moon-courier-nginx:8080 \
  -e PLAYWRIGHT_PRODUCTION_BOUNDARY=1 e2e \
  bash -lc 'corepack enable && pnpm install --frozen-lockfile \
    --store-dir=/pnpm/store && pnpm exec playwright test \
    tests/e2e/production-boundary.spec.ts tests/e2e/level-catalog.spec.ts'
```

Остановить контейнеры:

```bash
docker compose down --remove-orphans
```

Команды для целевых тестов, content/asset validation и диагностики ошибок
собраны в [`docs/TESTING.md`](docs/TESTING.md).

## Архитектура

Runtime проходит по цепочке
`validated content + session placement → SimulationEngine → readonly snapshot/controller → React + Phaser`.
React и Phaser отправляют типизированные намерения и не изменяют игровые
сущности напрямую. Баланс, вероятности и веса риск-взвешенного visibility-поиска
находятся в валидируемом контенте. Visibility graph проверяет каждое ребро
консервативным grid supercover, а симуляция ведёт непрерывную позицию ровера.
Simulation RNG использует фиксированный seed; отдельный placement RNG получает
новый Web Crypto seed для production-сессии. UI получает snapshot не чаще
десяти раз в секунду. Phaser рисует логические hazard-маски органическими
seeded-контурами и скругляет маршрут, не выделяя расчётную сетку цветными
клетками.

- `src/app` — composition root, session lifecycle и map controller;
- `src/domain` — сериализуемые команды, события и snapshots;
- `src/simulation` — часы, центры, роверы, маршруты, происшествия и исход;
- `src/content` — схемы, loaders, Tiled validation и production-каталог;
- `src/game` — Phaser scene, камера, карта и преобразование ввода;
- `src/ui/store`, `src/ui` — Zustand UI state, React-экраны и панели;
- `public/assets` — только локальные production-ассеты;
- `tests` — unit, integration, content, boundary и Playwright-проверки.

Подробный поток и владельцы модулей: [`docs/CODEMAP.md`](docs/CODEMAP.md).

## Документация контента

- [`docs/MAP_AUTHORING.md`](docs/MAP_AUTHORING.md) — контракт Tiled и порядок
  добавления карты;
- [`docs/CONTENT_REFERENCE.md`](docs/CONTENT_REFERENCE.md) — поля JSON и
  междокументные ссылки;
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — runtime-лицензии и
  происхождение ассетов.

## Приоритет требований

При конфликте действует следующий порядок:

1. `specs/product/03-decisions.md`;
2. соответствующая `features/Fxxx-*.md`;
3. JSON-контракты из `contracts/`;
4. остальные спецификации;
5. задачи;
6. изображения.

Разработка ведётся строго по одной доступной задаче из `tasks/manifest.json`.
