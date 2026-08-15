# Справочник JSON-контента

Runtime принимает только JSON-документы с `schemaVersion: 1`. Zod-схемы
строгие: неизвестные поля считаются ошибкой, ID используют kebab-case, а
ошибки возвращают стабильные `code` и JSON path. Нормативные JSON Schema лежат
в `contracts/*.schema.json`, runtime-схемы — в `src/content/schemas`.

## `balance.default.json`

Общий профиль баланса находится в `contracts/examples/balance.default.json`.

| Поле                                                | Ограничение/смысл                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `time.gameMinutesPerRealSecond`                     | ровно `1`                                                          |
| `time.fixedStepMilliseconds`                        | ровно `100`                                                        |
| `time.shiftRealSeconds`                             | ровно `480`                                                        |
| `center.warningThreshold`                           | ровно `20`                                                         |
| `center.recoveryGameMinutes`                        | ровно `30`                                                         |
| `center.radioThresholds`                            | ровно `[50, 25, 10, 5, 1]`                                         |
| `center.recoveryRadioThresholds`                    | ровно `[20, 10, 5, 1]`; стартовое `30` создаётся правилом recovery |
| `center.equipmentCapacity`                          | ровно `100`                                                        |
| `center.equipmentDemand.firstEligibleGameMinute`    | ровно `30`                                                         |
| `center.equipmentDemand.minimumIntervalGameMinutes` | ровно `45`                                                         |
| `center.equipmentDemand.lossMin/lossMax`            | ровно `20/40`                                                      |
| `routing.eventCooldownCells`                        | ровно `3`                                                          |
| `routing.routeWeights.movementCost`                 | положительный вес стоимости входа; production `1`                  |
| `routing.routeWeights.incidentRisk`                 | неотрицательный вес вероятности происшествия; production `10`      |
| `incidents.normalCellChance`                        | `0.005..0.01`                                                      |
| `incidents.hazardCellChanceMin/Max`                 | каждое значение `0.08..0.16`                                       |
| `rescue.repairGameMinutes`                          | ровно `5`                                                          |
| `rescue.craterRescueGameMinutes`                    | ровно `3`                                                          |

Runtime передаёт `routing.routeWeights` в поиск маршрута без кодового fallback:
`entryWeight = movementCost × routeWeights.movementCost +
effectiveCellChance × routeWeights.incidentRisk`. Все пять production-уровней
используют общий валидированный профиль `default`.

`roverArchetypes` содержит минимум четыре уникальных объекта:

- `id` — kebab-case, ссылка из level metadata;
- `cargoCapacity ≥ 0`;
- `batteryCapacity ≥ 1`;
- `gameMinutesPerNormalCell ≥ 0.5`;
- `batteryCostMultiplier ≥ 0.1`.

Production-профиль использует ID `fast`, `standard`, `heavy`, `repair`; только
`repair` имеет нулевой cargo capacity.

## `incidents.default.json`

| Поле                          | Ограничение/смысл                                                  |
| ----------------------------- | ------------------------------------------------------------------ |
| `rules.dustStormGameMinutes`  | ровно `10`                                                         |
| `rules.selfRepairGameMinutes` | ровно `10`                                                         |
| `profiles[]`                  | минимум один уникальный profile, обязательный ID `normal`          |
| `profiles[].cellChance`       | число `0..1`                                                       |
| `profiles[].weights`          | non-negative `dustStorm`, `meteorite`, `crater`; сумма больше нуля |

`normal.cellChance` обязан совпасть с
`balance.incidents.normalCellChance`. Остальные profile chances должны лежать
между `hazardCellChanceMin` и `hazardCellChanceMax`. Tiled property
`hazardProfileId` ссылается на существующий non-`normal` profile.

## `level-XX-<slug>.json`

Metadata каждой production-карты находится в `src/content/levels`.

| Поле                             | Ограничение/смысл                                        |
| -------------------------------- | -------------------------------------------------------- |
| `ordinal`                        | integer `1..5`, определяет progression constraints       |
| `id`                             | уникальный kebab-case runtime ID                         |
| `title`                          | 1–80 символов                                            |
| `description`                    | необязательно, до 300 символов                           |
| `riskLevel`                      | `low`, `medium`, `high`, `extreme`, `maximum` по ordinal |
| `tiledMap`                       | имя локального `.tmj` рядом с metadata                   |
| `themeId`                        | ID файла `theme.<themeId>.json`                          |
| `balanceProfileId`               | ID фактически загруженного balance, сейчас `default`     |
| `seed`                           | непустой seed всех детерминированных RNG-потоков уровня  |
| `shiftDurationRealSeconds`       | ровно `480`                                              |
| `centers`                        | 2–6 уникальных центров; точное число зависит от ordinal  |
| `facilityLayouts`                | 3–12 authoring-якорей D007, базы и golden E2E            |
| `rovers`                         | 3–9 уникальных роверов; точное число зависит от ordinal  |
| `riskChoiceCenters`              | уникальные IDs из `centers`, проверяемые topology rules  |
| `seededEquipmentDemandCenterIds` | уникальные IDs из `centers`; количество равно ordinal    |

Progression matrix:

| Ordinal | Risk      | Centers | Couriers | Repair | Risk-choice centers |
| ------: | --------- | ------: | -------: | -----: | ------------------: |
|       1 | `low`     |       2 |        2 |      1 |                   1 |
|       2 | `medium`  |       3 |        2 |      1 |                   2 |
|       3 | `high`    |       4 |        3 |      1 |                   3 |
|       4 | `extreme` |       5 |        4 |      1 |                   3 |
|       5 | `maximum` |       6 |        5 |      1 |                   3 |

### `centers[]`

- `id`, `name`;
- `oxygen` и `food`: `initial` в `(0, 100]`, `capacity: 100`,
  `depletionGameMinutes: 180..480`;
- `equipmentInitial` в `(0, 100]`.

Каждый center ID встречается ровно в одном Tiled object `class=center`.

### `facilityLayouts[]`

- уникальный kebab-case `id`;
- `baseCell` и каждая запись `centers[centerId]` содержат целые неотрицательные
  `column`/`row`;
- record содержит ровно все ID из `centers`, без неизвестных и пропущенных;
- все authoring facility cells различны и проходят cross-validation карты:
  safe/walkable/in-bounds, safe reachability и полный D007;
- production seed выбирает безопасную `baseCell`, затем процедурно назначает
  centers distinct внутренним walkable/reachable клеткам; hazard разрешён,
  blocked запрещён;
- E2E может явно закрепить authoring layout вместо procedural placement.

### `rovers[]`

- `id`, `name`;
- `archetypeId`: `fast`, `standard`, `heavy` или `repair`, существующий в
  balance;
- `spawnObjectId`: уникальная ссылка на Tiled `roverSpawn` либо `repairSpawn`.

На каждом уровне ровно один `repair`, остальные archetypes — курьеры.

## `theme.<id>.json`

| Поле              | Ограничение/смысл                                  |
| ----------------- | -------------------------------------------------- |
| `id`              | kebab-case, совпадает с `levelMeta.themeId`        |
| `backgroundAsset` | локальный путь, совпадает с Tiled background image |
| `colors`          | record строковых ключей и цветов `#RRGGBB`         |
| `assets`          | record строковых ключей и локальных путей          |

Production theme предоставляет `base`, `center`, `rover`, `repairRover` и цвета
grid/hazard/route/status. Цвет `grid` сохраняется в контракте темы для
совместимости, но логическая сетка в текущем UI не рисуется. URL,
protocol-relative, UNC и `..` paths запрещены.

## `radio.ru.json`

- `historyLimit` — ровно `100`;
- `messages` — полный record всех `RADIO_EVENT_CODES` из
  `src/domain/radio.ts`, без пропущенных или неизвестных codes;
- каждый message содержит `category`, `priority` и непустой `templates[]`;
- `category`: `INFO`, `WARNING`, `CRITICAL`, `EVENT`, `RESCUE`, `SYSTEM`;
- `priority`: integer `0..3`; template — 1–180 символов.

Коды сгруппированы по стартовым заявкам центров, ресурсным порогам, recovery,
equipment demand, трём видам incidents, arrival/delivery/battery, repair/rescue
и outcome. Placeholders запрещены, кроме:

- `{amount}` для `center.request.oxygen`, `center.request.food`,
  `center.request.equipment` и `equipment.demand`;
- `{oxygen}`, `{food}`, `{equipment}` для `center.delivery.received`;
- `{charge}` для `rescue.battery.transferred`.

Simulation передаёт в стартовую заявку `ceil` наибольшего дефицита центра, а
radio formatter перед подстановкой доставки округляет её дробные значения до
ближайшего целого и нормализует `-0` в `0`.

## Tiled `.tmj`

Tiled — JSON без `schemaVersion`, но проходит отдельную Zod-схему и
структурную/world validation. Слои, embedded tileset, objects и topology rules
описаны в [MAP_AUTHORING](MAP_AUTHORING.md).

## Междокументные ссылки

`loadContentBundle` атомарно проверяет:

1. `levelMeta.balanceProfileId` совпадает с загруженным balance profile;
2. `levelMeta.themeId === theme.id`;
3. `theme.backgroundAsset === Tiled background.image`;
4. rover archetypes существуют в balance;
5. incident chances согласованы с balance;
6. center/spawn IDs взаимно однозначно согласованы между metadata и Tiled;
7. каждая authoring facility layout содержит точный набор центров и сохраняет topology;
8. hazard tile profiles существуют в incidents.

Нельзя валидировать только один изменённый документ и считать bundle готовым.

## Проверка

```bash
docker compose run --rm --build verify pnpm validate:content
docker compose run --rm --build verify pnpm validate:assets
docker compose run --rm --build verify \
  pnpm exec vitest run tests/content-schemas.test.ts tests/content-map-validation.test.ts tests/content-level-catalog.test.ts
```

Production-каталог дополнительно проходит ускоренный победный smoke каждого
уровня в `tests/content-level-smoke.test.ts`.
