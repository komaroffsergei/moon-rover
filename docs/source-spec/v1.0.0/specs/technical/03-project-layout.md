# Целевая структура

```text
src/
├── app/             # bootstrap, controller
├── simulation/      # clock, centers, rovers, routing, incidents, rescue, result
├── game/            # Phaser scenes, map, renderers, input
├── ui/              # screens, panels, radio, controls, styles
├── content/         # levels, balance, incidents, radio, themes, validation
├── domain/          # commands, events, snapshot, ids
└── shared/          # только общие маленькие утилиты
```

Тест рядом с модулем, E2E в `tests/e2e`. Не группировать всё по папкам `interfaces/services/managers`, не создавать barrel на каждом уровне, локальные типы держать рядом, общие доменные контракты — в `domain`.
