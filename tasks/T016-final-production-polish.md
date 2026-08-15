# T016. Финальная доводка карты и production cleanup

**Feature spec:** `features/F016-final-production-polish.md`
**Зависит от:** T015

## Цель

Выполнить финальные требования владельца продукта F016-R1–R5: очистить HUD
ровера, исправить controls/camera/zoom, удалить подтверждённо мёртвый код и
опубликовать проверенное production-состояние.

## Spec-audit до кода

- CSS shell и canvas уже занимают viewport; чёрные поля создаёт
  `containFitZoom(Math.min)`. Нормативное исправление — `cover-fit(Math.max)`
  без растяжения bitmap, с прежним clamp и pan к обрезанным краям.
- Zoom работает в baseline, но стартует на минимуме, поэтому уменьшение молча
  блокируется. Требуются явные regression-сценарии `+`, `−`, wheel и resize.
- Синий ореол — отдельная rover-ветка selection graphics. Зелёно-графитовое
  battery ring уже независимо проецирует snapshot и должно остаться.
- Три `cargoRatios` уже нормированы общей capacity. Их следует нарисовать
  последовательными сегментами одной шкалы, не создавая новую доменную модель.
- Radio-кнопка фактически имеет `scrollWidth > clientWidth`; обе HUD-кнопки
  становятся квадратными icon-only controls с доступными именами.
- Route-draft API не имеет production-вызовов и противоречит D006; invisible
  TilemapLayer не участвуют в кадре. Удаляется только этот доказанный dead path,
  а используемые simulation route primitives и authoring validation остаются.
- Полный rewrite 1900-строчной MapScene отклонён как высокий регрессионный риск.
  Комментарии объясняют причины и инварианты, а не повторяют очевидный код.
- Browser plugin в сессии отсутствует; визуальная проверка выполняется обычным
  Playwright через Docker Compose и это явно записывается в отчёт.

## План до кода

1. Зафиксировать и опубликовать baseline T015 в приватном GitHub-репозитории.
2. Оформить T016/F016, spec-audit и обновить конфликтующие living specs.
3. Добавить regression-тесты HUD, camera cover/zoom и нижних controls.
4. Исправить rover HUD, полноэкранную camera и доступный zoom.
5. Упростить доказанно мёртвые route-draft/tilemap/UI ветки и русские пояснения.
6. Выполнить целевые проверки и visual QA 1280×720/1920×1080.
7. Провести три quality-прохода и полный Docker gate/E2E.
8. Создать `reports/T016.md`, завершить manifest, commit/push и остановиться.

## В scope

- требования F016-R1–R5;
- unit/UI/Playwright evidence и production visual QA;
- синхронизация living specs, CODEMAP, TESTING и отчёта;
- удаление только подтверждённого dead runtime-кода.

## Не входит

- изменение simulation balance, маршрутизации, cargo/battery arithmetic;
- новые карты, события, зависимости или bitmap-ассеты;
- архитектурная декомпозиция MapScene ради эстетики;
- публичный репозиторий или PR-workflow поверх начального `main`.

## Обязательный рабочий цикл

1. Regression tests перед production-реализацией.
2. Все project/app команды только через Docker Compose.
3. Три прохода `quality/THREE_PASS_WORKFLOW.md`.
4. `reports/T016.md`, отдельный финальный commit/push, затем остановка.
