# CODEMAP

[README](../README.md) · [Правила игры](GAME_RULES.md) ·
[Карты](MAP_AUTHORING.md) · [JSON-контент](CONTENT_REFERENCE.md) ·
[Тестирование](TESTING.md)

## Текущий runtime-поток

```text
index.html
  → src/main.tsx
  → src/app/App.tsx
  ├─→ createRuntimeMap
  │   ├─→ fresh session placementSeed → safe authored base + procedural centers
  │   ├─→ validated ContentBundle + placement → SimulationConfig → SimulationEngine
  │   ├─→ app-owned MapGameController → throttled readonly view
  │   └─→ serializable PhaserMapSource
  ├─→ per-session vanilla Zustand store
  ├─→ LevelSelectScreen → BriefingScreen
  └─→ lazy GameScreen
      ├─→ semantic HUD/panels/dialogs → typed store/controller intents
      └─→ dynamic createGame(parent, runtime)
          → Phaser MapScene
          ├─→ tilemapTiledJSON → embedded tileset + Image Layer metadata
          ├─→ snapshot projection → keyed center/rover visuals
          └─→ pointer/camera → GridCell → typed controller intent
```

При размонтировании `App` уничтожает созданный `Phaser.Game`, поэтому повторный
mount не оставляет второй canvas или глобальные listeners.

## Production-каталог уровней

```text
src/content/levels/catalog.ts (ровно 5 frozen source bundles)
  ├─→ Tycho / Shackleton / Tranquility / South Pole / Aitken metadata + TMJ + theme
  ├─→ общие balance / incidents / radio
  └─→ getRuntimeLevelSource(selected id)
      → loadContentBundle
      ├─→ Zod contracts + cross-document references
      ├─→ reachability / connected hazard zones
      ├─→ risk ratio + direct-safe center + disjoint safe approaches
      ├─→ те же safe/reachability/D007 проверки для каждой facility layout
      └─→ seeded facility selector → createSimulationConfigFromContent
          → изолированные engine/controller/store выбранной сессии
```

Метаданные уровня являются единственным источником `ordinal`, сложности и
начального набора equipment demands. Selector хранит один выбранный session и
один `<img>` preview; смена карточки уничтожает прежний store/controller и
создаёт runtime из соответствующего статического bundle. Каждая новая
production-сессия получает независимый `placementSeed` через Web Crypto:
`selectFacilityPlacement` выбирает одну из валидированных безопасных authored
позиций базы и seeded-перемешиванием размещает центры в различных достижимых
внутренних walkable-клетках, включая допустимые hazard-клетки. Placement RNG не
изменяет seed симуляции. E2E использует golden seed или явный authoring-layout
для координатных сценариев. Полноразмерные фоны не встроены в JS и остаются
отдельными локальными WebP.

`scripts/validate-content.ts` проверяет coherent example bundle и пять
production bundle. `scripts/asset-validation.ts` закрепляет allowlist atlas,
точные размеры/лимиты фонов, уникальность изображений, object/UI/load budgets и
запрет remote references. `tests/content-level-smoke.test.ts` управляет каждым
уровнем фиксированным 500-ms clock и test-side safe-route диспетчером до
`VICTORY`, с hard bound и проверкой реальных доставок во все центры.

## Интерфейс и состояние

```text
SimulationEngine readonly GameSnapshot
  → MapGameController (advance вызывает только Phaser adapter)
  ├─→ center resource percentages/depletion forecast
  ├─→ simulation-owned RoverActionAvailability
  ├─→ independent selectedEntity / focusRequest
  ├─→ atomic right-click ROUTE_ROVER_TO → FREE_NAVIGATION
  │   └─→ reroute from exact live position; legacy draft helpers вне main UI
  └─→ subscribe(view), публикация не чаще 100 ms при advance
      → per-session Zustand store
      ├─→ screen/tab/modal/journal/cargo draft — только UI state
      └─→ React screens/panels
          → controller intent / typed GameCommand
          → новый readonly snapshot
```

`src/ui/store` принадлежит нормативной UI-зоне: он импортирует только domain DTO
и Zustand, не знает Phaser/simulation/content. `src/ui` не импортирует
`src/game`; app composition root структурно связывает оба узких порта.
Availability ремонта, спасения, передачи батареи, ручной зарядки и разгрузки
проецируется в simulation, поэтому React не воспроизводит adjacency/status/
operation rules. Battery transfer остаётся единственным аварийным confirm
dialog; recovery, rescue, route и журнал не блокируют карту.

Phaser и `GameScreen` загружаются отдельными dynamic chunks только после старта
смены. MapScene преобразует левый клик в выбор, а правый — в немедленный
`routeSelectedRoverTo`; HTML route dock, видимая сетка, кандидаты и route draft в
основном сценарии отсутствуют. Критический центр получает красную рамку и
текстовый `Критично · mm:ss`, так что состояние не кодируется одним цветом.
Новые entity radio messages дополнительно проходят через ограниченный пул из
трёх comic-style Phaser containers; текст остаётся simulation/content-owned,
одна сущность не получает две одновременные реплики, а журнал не сокращается.

## Карта и Phaser

```text
contracts/examples/shackleton-rift.tmj + theme + local public/assets
  → loadContentBundle (Zod + Tiled world validation)
  → app adapter + validated seeded facility layout
  ├─→ SimulationEngine + RoutingMap
  └─→ PhaserMapSource (raw validated TMJ + assets/palette/placed object projection)
      → Phaser Tiled parser
      ├─→ background Image Layer
      ├─→ невидимые логические terrain / hazards / obstacles из embedded tileset
      └─→ code-native organic zones, blocked relief, smooth route and effects

pointer → camera.getWorldPoint → half-open worldToGridCell
  → MapGameController (src/app)
  → typed ROUTE_ROVER_TO command
  → deterministic visibility graph + conservative grid supercover
  → immutable FREE_NAVIGATION legs/traversals/forecast
  → readonly GameSnapshot
  → rover interpolation + center/resource/route redraw
```

`src/game` не импортирует `content` или `simulation`: сцена получает узкий
`MapGameController` port и сериализуемый map source. Adjacency, walkability,
forecast и endpoint→goal остаются в app/simulation. Camera state хранит world
center и zoom; contain-fit, clamp, pointer anchor и resize — чистая математика.
Scene shutdown снимает scale/keyboard listeners и очищает host markers.
При возврате из скрытой вкладки `MapScene` передаёт Phaser `pauseDuration` через
тот же controller `advance`; игровая пауза по-прежнему фильтруется simulation.
`mapPresentationGeometry` превращает логические hazard-маски в сглаженные
контуры с отдельным детерминированным visual seed и рисует маршрут через
quadratic-rounded точки с неизменными началом и концом. Terrain/hazard/obstacle
клетки остаются единицами расчёта и не получают видимой цветной сетки; relief
помечает непроходимые obstacles, а органическая зона — повышенный риск поверх
лунного фона.

## Контент и валидация

```text
локальный JSON / TMJ
  → parseJsonText
  → Zod document schema
  → Tiled structure + object/grid/BFS/risk validation
  → typed ContentBundle

contracts/examples/*
  → scripts/validate-content.ts
  → те же public loaders
```

Ошибки представлены `ContentValidationError.issues` со стабильными `code` и
JSON path. Runtime-потребитель не получает документ до успешной валидации.

## Симуляция

```text
validated Balance + LevelMeta + Tiled map + Radio JSON
  → createSimulationConfigFromContent
  ├─→ row-major RoutingMap (terrain + obstacles + hazards)
  ├─→ required routing.routeWeights (movement + incident risk)
  ├─→ typed RadioCatalog (messages + historyLimit=100)
  → domain SimulationConfig + seed
  → createSimulationEngine
  → fixed-step clock (100 ms)
  ├─→ rover cargo / automatic base service / distance-aware battery cost
  ├─→ visibility graph + supercover Dijkstra → immutable FREE_NAVIGATION route
  ├─→ repair / crater rescue / confirmed full battery transfer
  │   └─→ operation-first fixed-step → incident resolution → route policy
  ├─→ continuous leg execution → live-position reroute / immediate U-turn
  │   └─→ distance battery debit → crossed-cell incident → cooldown/timed state
  → START_SHIFT initial center requests (largest deficit + stable tie-break)
  → final-arrival effect (base service / center auto-unload; no pass-through effect)
  → center drain → equipment demand → thresholds/recovery
  → immediate defeat / end-of-shift outcome
  → DomainEvent[] с event-time cell
  ├─→ deterministic radio formatter → bounded newest-first journal
  → readonly GameSnapshot + RadioMessage[]
```

`dispatch` атомарно обрабатывает start/pause/resume, замену сохранённого mixed
cargo на базе, зарядку и rover-aware unload в клетке центра. Конечное прибытие
автоматически применяет base service либо полную capped-разгрузку всех трёх
типов груза в любой центр: передаётся `min(cargo, free capacity)`, а фактический
остаток сохраняется у ровера. Полный центр не меняет груз; проезд через клетку
базы или центра не запускает эффект прибытия. Ручная разгрузка использует ту же
консервативную передачу.

`routeSelectedRoverTo` строит маршрут к любой walkable-клетке по visibility
graph из точной текущей позиции и центров walkable-клеток. Каждое ребро проходит
через консервативный grid supercover: касание blocked-клетки, в том числе углом,
запрещает ребро. Вес складывает пройденную в каждой клетке евклидову длину,
`movementCost` и configured route weights, а incident risk начисляется один раз
при входе в клетку. `ROUTE_ROVER_TO` сохраняет immutable legs/traversals и
forecast. Повторный ПКМ начинает новый маршрут из текущей дробной `position`,
поэтому ровер может сразу развернуться в обратную сторону без snap-back;
недопустимая цель сохраняет прежнее назначение. `ASSIGN_ROVER_ROUTE` остаётся
legacy-клеточной границей и не заменяет активный FREE_NAVIGATION-маршрут.

Movement хранит logical cell отдельно от непрерывной `position`, списывает время
и батарею пропорционально пройденной длине и разыгрывает normal/hazard profile
при фактическом пересечении границы новой клетки через независимые per-rover
pure-rand streams. Active incident блокирует новые rolls; после него три
успешных входа пропускаются. Simulation хранит только числовое время и seeded RNG
по каждому center/rover ID; она не читает wall clock, DOM или browser timers.

Emergency repair и crater rescue хранят одну operation-запись на пару роверов.
Исполнитель получает `REPAIRING`/`RESCUING`, пострадавший сохраняет
`BROKEN`/`STUCK` до завершения. Repair очищает незавершённый маршрут, crater
rescue сохраняет его, а остаток completion fixed-step доступен последующему
movement. Battery transfer изменяет state только по explicit confirm: соседний
courier становится `OUT_OF_BATTERY`, repair unit получает заряд до capacity,
избыток теряется. Длительности 5/3 минуты приходят из validated balance.

При `START_SHIFT` simulation создаёт по одной заявке на неполный центр:
наибольший абсолютный дефицит, стабильный tie-break
`oxygen → food → equipment`, amount через `ceil`, без reservation. Radio
formatter переводит каждое поддерживаемое domain event не более чем в одно
локализованное сообщение из JSON catalog и округляет дробную доставку до
ближайшего целого (`-0 → 0`). Recovery-start и коррелированные incident/rescue
либо battery/out-of-charge пары не дублируются. Fingerprint подавляет повторную
доставку того же события, но сохраняет новый эпизод с другим `gameMinute`;
журнал ограничен последними 100 сообщениями. `objectId`, event-time `cell`,
source category и priority остаются typed metadata для будущих фильтров и
центрирования карты и текущего comic-callout без зависимости simulation от
DOM/Phaser.

## Реализованные зоны

| Путь             | Ответственность                                                 | Публичная граница             | Запрещено                                    |
| ---------------- | --------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| `src/app`        | React lifecycle, content/runtime adapter и map controller       | `App`, controller factory     | коэффициенты и Phaser rendering              |
| `src/domain`     | Serializable config, commands, events, snapshots                | `src/domain/index.ts`         | алгоритмы и framework imports                |
| `src/game`       | Phaser Tiled scene, camera/input, renderers и controller port   | `createGame(parent, runtime)` | simulation, content и изменение snapshot     |
| `src/ui/store`   | Per-session UI state и controller command delegation            | `createGameStore`             | game/simulation/content и второй clock       |
| `src/ui`         | React screens, panels, radio и allowed dialogs                  | component props + store       | game/simulation/content и изменение snapshot |
| `src/content`    | Zod-схемы, loaders, Tiled/radio validation и DTO adapter        | `src/content/index.ts`        | React, Phaser и изменение simulation         |
| `src/simulation` | Часы, центры, роверы, routing, rescue, radio journal и outcomes | `src/simulation/index.ts`     | content, React, Phaser, Zustand, DOM/timers  |

## Проверяемые границы

- `eslint.config.mjs` задаёт folder-specific `no-restricted-imports` для всех
  целевых зон.
- `tests/module-boundaries.test.ts` исполняет разрешённые/запрещённые static и
  dynamic imports через ESLint и проверяет весь production graph на циклы.
- `tests/game-visibility-resume.test.ts` закрепляет catch-up скрытого времени и
  отсутствие сдвига при явной игровой паузе.
- `tests/e2e/bootstrap.spec.ts` проходит level select → briefing → game,
  измеряет map ≥65%, desktop layout 1280×720/1920×1080, focus, размеры текста/
  controls, pause/Esc/Space и собирает console/page/network/HTTP errors.
- `tests/e2e/phaser-map.spec.ts` реальными DOM/canvas intents выбирает ровер и
  ПКМ немедленно назначает/перестраивает маршрут без route dock; тест сохраняет
  непрерывную позицию при reroute, доказывает немедленный U-turn, отклоняет
  blocked-клик без потери маршрута, проверяет diagonal legs, безопасный обход
  зоны Тихо, поворот корпуса, колёса/пыль/reduced-motion, стартовые заявки,
  middle-pan и wheel zoom; evidence сохраняется в `test-results`.
- `tests/e2e/t014-free-navigation.spec.ts` запускает procedural placement на
  всех пяти картах, допускает центр в hazard-зоне и проверяет полную
  arrival-разгрузку с capped остатком у ровера.
- `tests/game-store.test.ts`, `tests/ui-preflight.test.tsx` и
  `tests/ui-game-states.test.tsx` закрепляют screen flow, single subscription,
  command delegation, allowed dialogs, final states и inline recovery.
- `tests/simulation-rover-action-availability.test.ts` проверяет read-only
  availability всех rover actions без переноса правил в React.
- `tests/game-center-map-presentation.test.ts` закрепляет критический текст и
  recovery timer на карте.
- `tests/app-runtime-map.test.ts` закрепляет validated raw TMJ, embedded tileset,
  локальные assets, пять изолированных runtime и согласованные simulation
  entities.
- `tests/app-placement-seed.test.ts` закрепляет новый Web Crypto seed для каждой
  production-сессии и golden seed без crypto в E2E;
  `tests/content-facility-placement.test.ts` проверяет детерминизм на seed,
  варианты безопасной базы, уникальные достижимые procedural centers и
  сохранение simulation seed.
- `tests/app-map-game-controller.test.ts` покрывает selection, атомарное
  назначение CELL-цели через FREE_NAVIGATION, configured route weights,
  continuous-origin forecast, endpoint goal, dispatch/rebase и неизменность
  simulation snapshot; отдельные legacy draft helpers не являются текущим
  UI-потоком.
- `tests/game-map-geometry.test.ts`, `tests/game-camera-math.test.ts` и
  `tests/game-snapshot-projection.test.ts` закрепляют half-open coordinates,
  contain/clamp/anchor/resize и interpolation из snapshot.
- `tests/game-map-presentation-geometry.test.ts` проверяет детерминированные
  нерегулярные hazard-контуры всех production-карт и скругление маршрута без
  сдвига endpoints; `tests/game-rover-heading.test.ts` закрепляет shortest-turn
  heading, включая переход через границу `±π`.
- `tests/content-schemas.test.ts` сверяет public loaders со всеми contract
  examples и проверяет стабильные schema errors.
- `tests/content-map-validation.test.ts` покрывает Tiled layers/properties,
  IDs/references, positional collisions, blocked/reachability, risk-choice и
  независимые безопасные подходы.
- `tests/content-level-catalog.test.ts` таблично доказывает состав, связность
  hazard-зон, долю risk choices и нормативные safe/short ratios всех пяти
  production-карт; `tests/content-level-smoke.test.ts` доказывает их победный
  баланс с фиксированными seeds.
- `tests/asset-validation.test.ts` и `pnpm validate:assets` проверяют пять
  различных WebP 2048×1536, компактный 3-tile atlas, отсутствие legacy/CDN
  ассетов и initial-load budget после production build.
- `scripts/validate-content.ts` проверяет все JSON/TMJ из
  `contracts/examples` теми же runtime loaders.
- `scripts/audit-runtime-dependencies.ts` обходит production dependency closure,
  проверяет allowlist/license files и полноту `THIRD_PARTY_NOTICES.md`.
- `tests/simulation-*.test.ts` покрывают accumulator/pause, linear resources,
  validated-content adapter, seeded demand, thresholds, recovery boundaries и
  multi-center outcomes, mixed cargo conservation, charging и battery formula.
- `tests/simulation-routing-*.test.ts` покрывают совместимость legacy draft,
  configured weights, CELL-цели, immutable assignment и forecast;
  `tests/simulation-free-navigation.test.ts` отдельно покрывает visibility LOS,
  deterministic supercover/corner blocking, diagonal distance, continuous
  battery, crossed-cell incidents и reroute/U-turn без snap-back.
- `tests/simulation-movement.test.ts` и `tests/simulation-incidents.test.ts`
  покрывают fixed-step progress, cell-entry battery, stop at zero, pause,
  deterministic incident streams, cooldown и переходы DELAYED/BROKEN/STUCK/
  SELF_REPAIR.
- `tests/content-incidents.test.ts` проверяет согласованность normal/hazard chance
  между balance и incident profiles; adapter переносит weights и timing rules в
  runtime config без коэффициентов в simulation-коде.
- `tests/simulation-rescue.test.ts` покрывает same/cardinal proximity, точные
  repair/rescue timers, pause/chunking, operation-first remainder, route policy,
  snapshots, no-teleport и confirmed full battery transfer.
- `tests/content-schemas.test.ts` и `tests/simulation-content.test.ts` закрепляют
  rescue timings в JSON Schema/Zod и их перенос в runtime config.
- `tests/content-radio.test.ts` закрепляет полный набор eventCode, metadata,
  template bounds/placeholders, JSON Schema parity и размещение censored noise.
- `tests/simulation-radio.test.ts` покрывает стартовые заявки, tie-break/ceil,
  integer delivery formatting, mapping/cardinality, event-time targets,
  correlation/dedupe, newest-first history=100 и engine integration;
  `tests/shared-format-game-quantity.test.ts` закрепляет nearest-integer и
  `-0 → 0`.
- `tests/e2e/level-catalog.spec.ts` выбирает и запускает все пять карт,
  проверяет один preview и отсутствие загрузки всего каталога фонов.
- `tests/e2e/release-scenarios.spec.ts` через валидируемые test-only fixtures
  проходит recovery/defeat, meteorite repair, battery transfer и victory вне
  базы; production boundary отдельно доказывает отсутствие fixtures/diagnostics.

## Контейнерный поток

```text
package.json + pnpm-lock.yaml + THIRD_PARTY_NOTICES.md
  → Docker deps
  ├─→ development → Vite :5173
  ├─→ e2e-app → Vite --mode e2e внутри Compose
  │   └─→ validated named fixtures + diagnostics только test build
  ├─→ verify → quality gate + runtime dependency/license audit
  └─→ build → dist → nginx runtime :8080

Playwright image
  ├─→ healthy e2e-app → полный deterministic browser suite
  └─→ healthy nginx → UI-only catalog + production boundary
```
