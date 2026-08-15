# Индекс задач

Codex выполняет строго одну строку за сеанс и переходит дальше только после зелёного отчёта предыдущей. Подробный machine-readable routing находится в `tasks/manifest.json`.

| ID | Результат | Зависит от | Reasoning | Готовый prompt |
|---|---|---|---|---|
| T001 | Каркас проекта и Docker-контур | нет | high | `prompts/tasks/T001.md` |
| T002 | Контракты контента и валидатор | T001 | high | `prompts/tasks/T002.md` |
| T003 | Часы, центры, ресурсы и исход смены | T002 | medium | `prompts/tasks/T003.md` |
| T004 | Роверы, груз и батарея | T003 | medium | `prompts/tasks/T004.md` |
| T005 | Ручное построение маршрута | T004 | medium | `prompts/tasks/T005.md` |
| T006 | Движение и неблагоприятные события | T005 | medium | `prompts/tasks/T006.md` |
| T007 | Спасение, ремонт и передача батареи | T006 | medium | `prompts/tasks/T007.md` |
| T008 | Рация и журнал событий | T007 | medium | `prompts/tasks/T008.md` |
| T009 | Игровая карта Phaser | T008 | high | `prompts/tasks/T009.md` |
| T010 | Компактный интерфейс диспетчера | T009 | high | `prompts/tasks/T010.md` |
| T011 | Четыре карты, баланс и ассеты | T010 | high | `prompts/tasks/T011.md` |
| T012 | Регрессия, упрощение и release build | T011 | high | `prompts/tasks/T012.md` |

## Контекстное правило

Поле `context` в manifest является allowlist для первого чтения. Дополнительный файл открывается только если существующий код прямо на него ссылается или spec-audit показывает конкретный пробел; причина фиксируется в отчёте.
