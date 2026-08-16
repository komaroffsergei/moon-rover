# Модель состояний

## Смена

`BRIEFING → RUNNING ↔ PAUSED → VICTORY | DEFEAT`

## Ровер

`IDLE_AT_BASE | IDLE_ON_MAP | MOVING | DELAYED | BROKEN | STUCK | REPAIRING | RESCUING | SELF_REPAIR | OUT_OF_BATTERY`

`ROUTE_DRAFT` — UI-режим, а не состояние доменной сущности. Невозможная команда возвращает типизированную ошибку.

## Центр

`WORKING | WARNING | RECOVERY | LOST`

## UI

`INSPECT | LOAD_CARGO | BUILD_ROUTE | CHOOSE_RESCUE | CONFIRM_TRANSFER`

Черновое UI-состояние не меняет домен до подтверждённой команды.
