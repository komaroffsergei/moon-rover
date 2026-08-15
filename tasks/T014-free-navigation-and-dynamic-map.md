# T014. Свободная навигация и динамическая карта

**Feature spec:** `features/F014-free-navigation-and-dynamic-map.md`  
**Зависит от:** T013

## Цель

Реализовать пять прямых правок владельца продукта: полную capped-разгрузку,
нерегулярные опасные зоны, свободные кратчайшие маршруты, немедленный U-turn и
новое случайное размещение научных центров при каждом запуске.

## Контекст задачи

- `features/F014-free-navigation-and-dynamic-map.md`
- `specs/product/03-decisions.md`
- `specs/product/04-assumptions.md`
- `specs/gameplay/03-centers-resources.md`
- `specs/gameplay/04-rovers-cargo-battery.md`
- `specs/gameplay/05-manual-routing.md`
- `specs/gameplay/06-hazards-events.md`
- `specs/gameplay/09-levels-balance.md`
- `specs/gameplay/10-state-model.md`
- `specs/ui/03-interaction-states.md`
- `specs/ui/04-visual-style.md`
- `specs/technical/04-simulation.md`
- `specs/technical/05-map-tiled.md`
- `specs/technical/06-map-validation.md`
- `specs/technical/13-module-boundaries.md`
- `quality/TEST_STRATEGY.md`
- `quality/THREE_PASS_WORKFLOW.md`

## Spec-audit до кода

- Новый запрос напрямую заменяет D001 «четыре направления, без диагоналей»,
  D005 recovery-only unload и D006 «обязательно завершить начатое ребро».
- Существующее сглаживание лишь округляет прямоугольную hazard-маску; для
  органической формы нужна отдельная детерминированная contour-геометрия.
- «Восполнить полностью» ограничено conservation: центр получает не больше
  cargo и capacity; недостаток груза остаётся недостатком.
- Свободное движение требует дробной позиции и единого line-of-sight/supercover
  правила для runtime и content validation; GridCell остаётся единицей
  обслуживания, инцидентов и авторинга.
- Случайные hazard-центры несовместимы с прежним safe-only D007 для каждой
  раскладки. D007 остаётся проверкой геометрии authoring-якорей карты, а runtime
  гарантирует distinct/walkable/reachable, но не фиксированный risk ratio
  каждого случайного center ID.
- Новый reload означает новую независимую выборку, а не математическую
  гарантию отличия от предыдущей; одинаковый явно заданный seed воспроизводим.

## План до кода

1. Зафиксировать T014/F014, обновить противоречащие living specs и regression tests.
2. Ввести чистую any-angle навигацию с LOS/supercover, евклидовой стоимостью и запретом corner cutting.
3. Перевести route state и движение на дробную позицию с клеточными entry-effects.
4. Сделать атомарный reroute из live-position и доказать немедленный U-turn без скачка.
5. Реализовать procedural center placement с hazard-кандидатами и фиксированным E2E override.
6. Переключить arrival на полную capped-разгрузку с fractional conservation.
7. Добавить нерегулярный hazard contour и естественную линию маршрута без cell markers.
8. Выполнить три quality-прохода, отчёт T014 и остановиться.

## В scope

- требования F014-R1–R5;
- единый чистый navigation kernel без новой production-зависимости;
- unit/content/integration/Playwright evidence;
- living specs, CODEMAP, GAME_RULES, MAP_AUTHORING, TEST_STRATEGY и отчёт.

## Не входит

- точная физика, столкновения и ручное управление;
- произвольная sub-cell конечная цель: ПКМ выбирает центр walkable-клетки;
- procedural terrain/hazards/obstacles;
- изменение вероятностей происшествий и depletion balance;
- новые production-зависимости или T015.

## Обязательный рабочий цикл

1. Spec-audit и план до 8 пунктов — до production-кода.
2. Regression tests перед реализацией.
3. Все команды только через Docker Compose.
4. Три прохода `quality/THREE_PASS_WORKFLOW.md`.
5. `reports/T014.md`, затем остановка.
