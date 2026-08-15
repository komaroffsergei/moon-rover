# Модель состояний

## Смена

`BRIEFING → RUNNING ↔ PAUSED → VICTORY | DEFEAT`

## Ровер

`IDLE_AT_BASE | IDLE_ON_MAP | MOVING | DELAYED | BROKEN | STUCK | REPAIRING | RESCUING | SELF_REPAIR | OUT_OF_BATTERY`

Назначение маршрута — атомарное controller intent: отдельного `ROUTE_DRAFT` нет.
Невозможная команда возвращает типизированную ошибку и сохраняет текущее
назначение. Помимо последней логической `GridCell`, ровер хранит дробную
navigation position и progress текущего line-of-sight segment; reroute начинает
новый segment из этой позиции.

## Центр

`WORKING | WARNING | RECOVERY | LOST`

## UI

`INSPECT | LOAD_CARGO | CHOOSE_RESCUE | CONFIRM_TRANSFER`

Правый клик назначает достижимую цель сразу и не переводит UI в отдельный
режим. Подтверждение сохраняется только там, где оно явно требуется правилом,
например для полной передачи батареи.
