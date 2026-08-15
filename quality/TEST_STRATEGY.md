# Стратегия тестирования

## Цель

Каждый тест доказывает игровое правило или контракт. Тесты не должны повторять реализацию и не считаются полезными только потому, что строка стала зелёной.

## Уровни

### 1. Unit — основной объём

Без DOM, Phaser и реальных часов:

- часы и fixed-step;
- расход/доставка ресурсов, auto-service базы и полную capped auto-unload только
  при конечном прибытии, fractional conservation и pass-through без эффекта;
- recovery window;
- груз и батарея;
- risk-weighted any-angle маршрут, LOS/supercover без corner cutting,
  произвольная достижимая цель и стоимость из `routeWeights`;
- переназначение из live-position, немедленный U-turn без position jump и
  атомарное сохранение старого пути при ошибке;
- детерминированный RNG;
- состояния происшествий;
- спасение и передача батареи;
- автозапуск штатного ремонта только после конечного прибытия repair rover,
  stable target selection, точные пять минут и отсутствие pass-through trigger;
- стартовые заявки центров, их tie-break/ceil, округление доставки и
  дедупликация рации;
- единая политика integer-display без потери дробного conservation;
- исход смены.

Использовать фиксированные snapshots входа, seed и явные команды. Никаких `sleep`.

### 2. Контентные тесты

Для каждого JSON/Tiled файла:

- schema validation;
- обязательные слои и свойства;
- уникальность ID;
- координаты внутри карты;
- объекты не на препятствиях;
- достижимость от базы;
- топологические проверки риск/обход;
- schema/cross-document проверка обязательных `routing.routeWeights` и общего
  production-профиля всех пяти уровней;
- ссылки на локальные ассеты;
- размер ассетов.
- authoring facility layouts: distinct safe cells и D007; procedural runtime
  pool: distinct walkable/reachable centers, hazard разрешён, blocked исключён,
  одинаковый placement seed воспроизводим.

### 3. Integration

Проверить связку `content → SimulationEngine → snapshot → command` без браузера. Ключевые сценарии выполняются ускоренными игровыми шагами.

### 4. E2E Playwright

Минимальный набор:

1. выбор карты и старт;
2. выбор ровера, диагональный правый клик, немедленное движение и
   противоположный reroute без скачка;
3. отказ маршрута к blocked-клетке без потери текущей задачи;
4. истощение ресурса → 30-минутное окно → успешное восстановление;
5. истечение окна → поражение;
6. метеорит → ремонтная бригада → восстановление;
7. передача полной батареи с подтверждением;
8. пауза действительно замораживает время;
9. победа при работающих центрах независимо от положения роверов;
10. resize до 1280×720 сохраняет доступность full-map HUD;
11. radio drawer открывается и сворачивается, comic bubble закрывается,
    battery/cargo overlays видны и пятая карта запускается.

Текущий `tests/e2e/phaser-map.spec.ts` дополнительно доказывает отсутствие route
dock/видимого draft/cell markers, any-angle U-turn из live-position, сохранение
маршрута и видимую ошибку после blocked-клика, обход центральной опасной зоны
Тихо и стартовые заявки центров. Там же проверяются animation
diagnostics: непрерывный heading, wheel phase и dust при движении, а
reduced-motion — без пыли и смены протектора. Реплики проверяются реальными
event-сценариями центра и ремонтной бригады: ограничение viewport/overlap, zoom,
pause, terminal cleanup и отсутствие повторного проигрывания истории.

Проверять состояние через доступный UI и стабильные `data-testid` только там, где роль/текст недостаточны.

## Детерминизм

- `Math.random()` запрещён.
- В тестах используется конкретный seed.
- Игровой clock инъецируется как команда шага.
- В E2E доступен test mode через build-time env, который задаёт simulation seed,
  per-level golden placement seed и balance fixture, но не добавляет debug API
  в production.

## Скриншоты

Скриншотное сравнение применяется только к крупным layout-регрессиям. Не делать pixel-perfect snapshots всей лунной текстуры: это хрупкая бюрократия, а не проверка игры.

## Quality gate

```bash
# format:check + lint + typecheck + unit + content + build
docker compose run --rm verify

# browser scenarios against healthy dev service
docker compose run --rm e2e

# production image smoke
docker compose up --build app
```

При локализации ошибки допустимо запустить одну команду внутри `verify`, например `docker compose run --rm verify pnpm test`. После исправления всё равно повторяется полный gate.
