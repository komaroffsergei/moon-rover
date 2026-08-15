# Создание и изменение карт

Production-карта — согласованный набор из level metadata, Tiled `.tmj`, theme и
локального WebP. Все четыре части загружаются одним `ContentBundle`; файл не
попадает в runtime, если схема, ссылки или топология невалидны.

## Где находятся файлы

```text
src/content/levels/
  level-01-tycho.json
  tycho-crater.tmj
  theme.tycho-low.json
public/assets/maps/tycho/background.webp
```

Общие `balance`, `incidents` и `radio` находятся в `contracts/examples`.
Production-каталог явно собирается в `src/content/levels/catalog.ts`; сейчас он
фиксирован пятью уровнями и ordinal `1..5`. Добавление следующего уровня требует
отдельного изменения продуктового контракта, а не только нового файла.

## Настройки Tiled map

- `type=map`, `orientation=orthogonal`, `renderorder=right-down`;
- finite map (`infinite=false`), клетка строго `64×64`;
- обязательные слои идут ровно в порядке ниже и не имеют offset/parallax;
- обязательные слои видимы и имеют `opacity` в диапазоне `(0, 1]`;
- неизвестные слои запрещены. Один необязательный `decorations` может быть
  `tilelayer` или `objectgroup` и располагается после `objects`.

| Слой         | Tiled type    | Содержимое                             |
| ------------ | ------------- | -------------------------------------- |
| `background` | `imagelayer`  | локальный `.webp`, совпадающий с theme |
| `terrain`    | `tilelayer`   | базовая проходимость и стоимость       |
| `hazards`    | `tilelayer`   | клетки с hazard profile                |
| `obstacles`  | `tilelayer`   | непроходимые клетки                    |
| `objects`    | `objectgroup` | база, центры и rover spawns            |

Map/layer properties с игровыми коэффициентами и любые script-поля запрещены.

## Embedded tileset

Внешний `.tsx` через `tileset.source` запрещён. Tileset встраивается в `.tmj` и
ссылается на локальный `/assets/tiles/lunar-logical.png`. Геометрия atlas должна
точно соответствовать `tilewidth`, `tileheight`, `tilecount`, `columns`,
`margin` и `spacing`.

Каждый tile объявляет только следующие properties:

| Property          | Правило                                                    |
| ----------------- | ---------------------------------------------------------- |
| `terrainType`     | `normal`, `rough` или `blocked`                            |
| `walkable`        | boolean; `blocked` обязан быть `false`, остальные — `true` |
| `movementCost`    | положительное число                                        |
| `hazardProfileId` | необязательная ссылка на non-`normal` profile incidents    |

`terrain`, `hazards` и `obstacles` имеют размеры всей карты и массив `data`
длиной `width × height`. Каждый ненулевой GID должен существовать во встроенном
tileset; Tiled flip flags допустимы и снимаются валидатором перед lookup.

## Объекты

Доменные объекты — point objects на координатах `x=column×64`, `y=row×64`.
Современное поле `class` обязательно; legacy `object.type`, polygon/polyline,
ellipse и text запрещены. Единственное разрешённое property — строковый
`entityId` в kebab-case.

| `class`       | Количество | `entityId` и ссылка                  |
| ------------- | ---------: | ------------------------------------ |
| `base`        |    ровно 1 | ровно `base`                         |
| `center`      | не менее 1 | совпадает с `levelMeta.centers[].id` |
| `roverSpawn`  | не менее 1 | совпадает с spawn курьера            |
| `repairSpawn` |    ровно 1 | совпадает со spawn ремонтного ровера |

ID Tiled objects, layer IDs и `entityId` уникальны. Объекты находятся внутри
карты на проходимых клетках; база не совпадает с центром, два центра не могут
занимать одну клетку. Несколько rover spawns в одной клетке допустимы.

Tiled positions служат authoring-якорями. Обязательный metadata-массив
`facilityLayouts` содержит 3–12 safe вариантов с `id`, `baseCell` и точным
record `centers` по всем center ID. Они закрепляют D007, безопасные базы и
golden E2E. Production runtime по отдельному `placementSeed` выбирает одну из
этих баз и процедурно назначает centers различным внутренним walkable-клеткам,
достижимым от базы. Hazard-клетки входят в pool, blocked — нет; один placement
проецируется и в simulation, и в Phaser.

## Топология уровня

Валидатор выполняет BFS по четырём сторонам и отклоняет карту, если объект или
проходимая клетка недостижимы от базы. Дополнительно:

- каждая связная hazard zone содержит 8–30 клеток;
- уровни 2–5 имеют минимум одну hazard zone из 20 клеток;
- пятый уровень имеет минимум три отдельные связные hazard zones;
- у каждого ID из `riskChoiceCenters` есть короткий hazard-маршрут и более
  длинный безопасный маршрут с отношением длины `1.4..1.9`;
- начиная со второго уровня существует non-risk центр с прямым безопасным путём;
- минимум один центр имеет два независимых безопасных подхода.

Эти проверки оценивают authoring-дизайн карты, но не обещают фиксированный
safe/short ratio для каждого center ID после процедурного runtime-размещения.

## Theme и ассеты

`theme.<themeId>.json` задаёт локальный `backgroundAsset`, шестизначные HEX
цвета и локальные object assets. `backgroundAsset` обязан совпадать с `image`
слоя `background`. Runtime CDN, URL, UNC, parent traversal и внешние tilesets не
допускаются.

Фон каждой production-карты — уникальный WebP `2048×1536` не больше 600 KB;
texture dimension не превышает 4096. Общий object budget — 1 MB, logical atlas —
не более 512 KB/16 tiles, conservative initial-load budget — 6 MB.

## Рабочий порядок

1. Измените metadata, `.tmj`, theme и локальный background одним законченным
   набором.
2. Синхронизируйте `themeId`, `tiledMap`, center IDs, `facilityLayouts`, rover
   `spawnObjectId`, hazard profiles и `catalog.ts`.
3. Запустите проверки только через Compose:

```bash
docker compose run --rm --build verify pnpm validate:content
docker compose run --rm --build verify pnpm validate:assets
docker compose run --rm --build verify \
  pnpm exec vitest run tests/content-map-validation.test.ts tests/content-level-catalog.test.ts tests/content-level-smoke.test.ts
```

4. Перед выпуском выполните полный `docker compose run --rm --build verify` и
   Playwright для selector/start каждого уровня.

Поля metadata/theme/incidents подробно перечислены в
[CONTENT_REFERENCE](CONTENT_REFERENCE.md).
