# Контракт Tiled `.tmj`

## Map

- `orientation=orthogonal`, `renderorder=right-down`;
- `tilewidth=tileheight=64`;
- finite map;
- tileset встроен в JSON, внешняя `.tsx` ссылка запрещена.

## Слои

| Имя | Тип | Обязателен | Назначение |
|---|---|---:|---|
| background | imagelayer | да | локальный WebP |
| terrain | tilelayer | да | стоимость/проходимость |
| hazards | tilelayer | да | профиль риска |
| obstacles | tilelayer | да | непроходимое |
| objects | objectgroup | да | база, центры, spawns |
| decorations | tile/object | нет | только оформление |

## Objects

- `base`: `class=base`, `entityId=base`;
- `center`: `class=center`, entityId из level meta;
- `roverSpawn` / `repairSpawn`: соответствующий `class`, entityId совпадает со spawnObjectId.

Использовать современное поле Tiled `class`; legacy object `type` для доменной классификации не вводить. Поле `type` самого map/layer остаётся структурным полем формата Tiled.

Запрещены баланс в Tiled properties, скрипты, polygon navigation, объекты между клетками и внешние URL.
