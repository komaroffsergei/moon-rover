# Правила `src/simulation`

- Только чистый TypeScript и доменные данные.
- Запрещены React, Phaser, Zustand, DOM, `Date.now`, `performance.now`, `setTimeout`, `Math.random`.
- Все изменения выполняются командами и фиксированным шагом времени.
- Публичный результат — serializable snapshot и domain events.
- Любое новое правило обязано иметь unit-тест с фиксированным seed/clock.
