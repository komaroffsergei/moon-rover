# T015. Минимальный HUD, автоматический ремонт и пятая карта

**Feature spec:** `features/F015-minimal-hud-auto-repair-level-five.md`  
**Зависит от:** T014

## Цель

Реализовать пять прямых правок владельца продукта: автоматический ремонт
курьера при остановке ремонтной бригады рядом, закрываемые comic-реплики,
круговой индикатор батареи и грузовой HUD над ровером, полноэкранный
минималистичный интерфейс с выдвижной рацией и пятую карту максимальной
сложности.

## Контекст задачи

- `features/F015-minimal-hud-auto-repair-level-five.md`
- `specs/product/03-decisions.md`
- `specs/product/04-assumptions.md`
- `specs/gameplay/04-rovers-cargo-battery.md`
- `specs/gameplay/07-rescue-repair-transfer.md`
- `specs/gameplay/09-levels-balance.md`
- `specs/gameplay/10-state-model.md`
- `specs/ui/01-screen-map.md`
- `specs/ui/02-main-layout.md`
- `specs/ui/03-interaction-states.md`
- `specs/ui/04-visual-style.md`
- `specs/ui/05-accessibility.md`
- `specs/technical/04-simulation.md`
- `specs/technical/05-map-tiled.md`
- `specs/technical/06-map-validation.md`
- `specs/technical/10-assets-tiles.md`
- `specs/technical/13-module-boundaries.md`
- `quality/TEST_STRATEGY.md`
- `quality/THREE_PASS_WORKFLOW.md`

## Spec-audit до кода

- Прямой запрос заменяет D002 и UI layout со стационарными top/left/right/
  bottom-панелями: игровая карта становится full-bleed, а сведения и рация —
  временными floating surfaces. Inspector можно свернуть, не сбрасывая выбор,
  чтобы назначить цель в ранее перекрытой части карты.
- Автоматический ремонт заменяет ручное подтверждение только для meteorite-
  ремонта курьера. Кратерное спасение и полная передача батареи остаются
  явными действиями.
- Автоматический ремонт запускает существующую валидируемую 5-минутную
  emergency operation после конечного `ROVER_ARRIVED` ремонтника. Проезд рядом
  не запускает её; при нескольких целях выбирается same-cell, затем стабильный
  ID. Ручной fallback остаётся для курьера, сломавшегося рядом с уже стоящей
  бригадой.
- Крестик реплики закрывает только текущую карту-реплику. Domain event и запись
  журнала рации не удаляются и повторно не проигрываются.
- Battery halo и три cargo-линии являются проекцией snapshot: Phaser не
  рассчитывает игровые значения и ничего не записывает в simulation.
- Пятая карта расширяет progression/content contracts с четырёх до пяти
  уровней. Максимальная сложность выражена шестью центрами, пятью курьерами,
  одним ремонтником, пятью equipment-demand целями и минимум тремя связными
  hazard-зонами; вероятности происшествий и длительность смены не меняются.
- Новый визуальный концепт использует существующие sprites и карту; UI-текст и
  controls остаются code-native. Новая bitmap-подложка нужна только пятой
  карте.

## План до кода

1. Зафиксировать T015/F015 и обновить конфликтующие living specs.
2. Добавить regression tests автозапуска ремонта и deterministic выбора цели.
3. Реализовать закрываемые реплики и rover battery/cargo HUD в Phaser.
4. Перестроить GameScreen в full-map HUD с inspector и radio drawer.
5. Добавить валидируемую пятую maximum-карту и локальный background.
6. Выполнить целевые проверки и визуальную сверку с концептом.
7. Провести три quality-прохода, полный Docker gate и E2E.
8. Создать `reports/T015.md`, завершить manifest и остановиться.

## В scope

- требования F015-R1–R5;
- unit/content/UI/Playwright evidence;
- обновление living specs, пользовательской документации и отчёта;
- один новый локальный фон пятой карты без production-зависимостей.

## Не входит

- автоматическое кратерное спасение или передача батареи;
- изменение длительности ремонта, incident probabilities или depletion;
- backend, сохранения между reload и новые production-зависимости;
- процедурная генерация terrain/hazards или шестая карта.

## Обязательный рабочий цикл

1. Spec-audit и план до 8 пунктов — до production-кода.
2. Regression tests перед реализацией.
3. Все команды только через Docker Compose.
4. Три прохода `quality/THREE_PASS_WORKFLOW.md`.
5. `reports/T015.md`, затем остановка.
