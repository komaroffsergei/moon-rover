# Технологический стек

| Задача | Решение | Причина |
|---|---|---|
| Игровой canvas | Phaser 4.2.x | tilemap, камера, ввод, спрайты |
| Карты | Tiled 1.12.x JSON | живой OSS-редактор |
| Панели | React 19.2.x | доступный DOM UI |
| UI store | Zustand 5.x | тонкий мост без Redux |
| Контент | Zod 4.x | runtime-проверка JSON |
| RNG | pure-rand | seed и воспроизводимость |

Tooling: Node 24 LTS, pnpm 11, TypeScript strict, Vite 8, Vitest 4, Playwright, ESLint flat config, Prettier, Docker Compose.

Не использовать MapLibre/OpenLayers, React Router, Tailwind/Material UI, Phaser physics, backend framework, ORM, RxJS, Lodash, UUID/date libraries.
