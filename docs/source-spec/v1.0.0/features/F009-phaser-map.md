# F009. Phaser-карта

## Цель

Отобразить Tiled-карту и ручной ввод.

## Требования

- embedded Tiled JSON + Image Layer;
- pan/zoom;
- renderer обновляет объекты по snapshot;
- route draft и candidate cells;
- крупные hazard/obstacle читаемы;

## Не входит

- Доменные правила в сцене;

## Приёмка

E2E строит маршрут и видит движение; resize не ломает layout.
