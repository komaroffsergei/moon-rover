# Карты в Tiled

- orthogonal `.tmj`/JSON;
- клетка 64×64 логических px;
- tileset встроен в JSON;
- фон — локальный WebP Image Layer;
- игровые координаты row/column.

## Слои снизу вверх

1. `background` — Image Layer;
2. `terrain` — Tile Layer;
3. `hazards` — Tile Layer;
4. `obstacles` — Tile Layer;
5. `objects` — Object Layer;
6. `decorations` — необязательно.

## Свойства тайла

`terrainType: normal|rough|blocked`, `walkable`, `movementCost`, `hazardProfileId?`.

## Объекты

Одна база (`class=base`), центры (`class=center`), курьерские точки
(`class=roverSpawn`) и одна ремонтная (`class=repairSpawn`). ID совпадают с
level meta. Для доменной классификации использовать современное поле Tiled
`class`, не legacy `type`.

Координаты objects и `facilityLayouts` являются authoring-якорями для
валидации D007, безопасного выбора базы и golden E2E. При создании production
runtime отдельный `placementSeed` выбирает authoring-базу и процедурно
распределяет centers по distinct walkable/reachable клеткам, включая hazard.
Один результат проецируется одновременно в SimulationConfig и PhaserMapSource;
terrain, hazards и obstacles не перемещаются.

Phaser загружает и рисует карту. Отдельный MapModel извлекает логическую сетку; Phaser objects не являются доменными сущностями.
