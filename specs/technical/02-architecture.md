# Архитектура

```text
Tiled + content JSON
       ↓ validation
 RuntimeContent
       ↓
SimulationEngine ← GameCommand
       ↓
Snapshot + DomainEvent
   ↙              ↘
Phaser          Zustand/React
```

## SimulationEngine

Владеет временем, центрами, роверами, маршрутами, батареей, грузом, событиями, recovery и исходом.

## Phaser

Создаёт карту, рисует snapshot, переводит левый клик в выбор, а правый — в
GridCell-цель controller intent. Показывает только подтверждённый плавный
маршрут и waypoint, без видимой сетки или route draft. Не списывает ресурсы и
не меняет статус.

## React

Хранит только выбранный объект, вкладку, открытую панель и черновые значения груза; читает snapshot и отправляет команды.

## GameController

Небольшой адаптер принимает команды, вызывает engine, публикует snapshot и передаёт доменные события. Сторонняя event bus не нужна.
