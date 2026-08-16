# Контракты контента

- Каждый JSON имеет `schemaVersion`.
- Неизвестная major-версия блокирует уровень с понятной ошибкой.
- Zod — runtime-источник, JSON Schema — редактор/документация.
- ID в `kebab-case`, runtime UUID не нужен.
- Единицы в именах: `RealSeconds`, `GameMinutes`, `Milliseconds`.
- Вероятности 0..1.
- Theme содержит только визуальное, balance — только механику.

Раздельные файлы: `level-meta.json`, `.tmj`, `balance.json`, `incident-profiles.json`, `radio.json`, `theme.json`. Универсальный `final-config-v7.json` запрещён.
