# CODEMAP

## Поток данных

`content → validation → SimulationEngine → snapshot → Phaser/React → command → SimulationEngine`

## Модули

| Каталог | Ответственность | Публичная граница | Не должен импортировать |
|---|---|---|---|
| `src/simulation` | правила | commands/snapshot | React, Phaser, DOM |
| `src/game` | карта и ввод | adapter | UI business logic |
| `src/ui` | панели | selectors/actions | mutable entities |
| `src/content` | данные | validated content | scenes/components |

## Ключевые сценарии

Для каждого сценария указать точный путь от команды до события и UI, без копирования исходников в документ.
