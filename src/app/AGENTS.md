# Правила `src/app`

- Это composition root: создание контента, SimulationEngine, Phaser и React bridge.
- Здесь допустима интеграция модулей, но не игровые правила и не коэффициенты.
- GameController остаётся небольшим адаптером команд/snapshot/events.
- Не создавать глобальный service locator или стороннюю event bus.
