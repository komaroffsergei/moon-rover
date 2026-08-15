# Матрица трассировки

| Feature | Task | Основные проверки |
| ------- | ---- | ----------------- |
| F001 | T001 | container smoke, lint, typecheck, build |
| F002 | T002 | `tests/content-schemas.test.ts`, `tests/content-map-validation.test.ts` |
| F003 | T003 | `tests/simulation-clock.test.ts`, `tests/simulation-centers.test.ts`, outcome tests |
| F004 | T004 | `tests/simulation-rover-cargo.test.ts`, `tests/simulation-battery.test.ts`, `tests/shared-format-game-quantity.test.ts` |
| F005 | T005 | `tests/simulation-routing-weighted.test.ts`, `tests/simulation-routing-assignment.test.ts`, `tests/app-map-game-controller.test.ts`, `tests/e2e/phaser-map.spec.ts` |
| F006 | T006 | `tests/simulation-movement.test.ts`, `tests/simulation-incidents.test.ts` |
| F007 | T007 | `tests/simulation-rescue.test.ts`, release-scenario E2E |
| F008 | T008 | `tests/content-radio.test.ts`, `tests/simulation-radio.test.ts`, `tests/ui-radio-panel.test.tsx`, `tests/e2e/phaser-map.spec.ts` |
| F009 | T009 | map projection/input tests, `tests/e2e/phaser-map.spec.ts` |
| F010 | T010 | `tests/e2e/bootstrap.spec.ts`, `tests/e2e/release-scenarios.spec.ts`, `tests/e2e/production-boundary.spec.ts` |
| F011 | T011 | `tests/content-level-catalog.test.ts`, `tests/content-level-smoke.test.ts`, `tests/e2e/level-catalog.spec.ts` |
| F012 | T012 | full quality gate, product acceptance and user-directed reconciliation evidence |

F005/T005 сохраняются в таблице как историческая пара со статусом
`superseded by D006 / user-directed T012 revision`: нормативное поведение теперь
— ПКМ, детерминированный Dijkstra, отсутствие видимой сетки/draft и немедленное
назначение маршрута. Новая задача для этой reconciliation не создаётся.
