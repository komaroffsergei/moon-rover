# Third-party notices

## Runtime-зависимости

Production closure вычисляется из `package.json` и установленных package
manifests командой `pnpm audit:runtime`. Все перечисленные пакеты распространяются
по лицензии MIT:

- `eventemitter3@5.0.4` — MIT — Copyright (c) 2014 Arnout Kazemier.
- `phaser@4.2.1` — MIT — Copyright (c) 2026 Richard Davey, Phaser Studio Inc.
- `pure-rand@8.4.2` — MIT — Copyright (c) 2018 Nicolas DUBIEN.
- `react@19.2.8` — MIT — Copyright (c) Meta Platforms, Inc. and affiliates.
- `react-dom@19.2.8` — MIT — Copyright (c) Meta Platforms, Inc. and affiliates.
- `scheduler@0.27.0` — MIT — Copyright (c) Meta Platforms, Inc. and affiliates.
- `zod@4.4.3` — MIT — Copyright (c) 2025 Colin McDonnell.
- `zustand@5.0.15` — MIT — Copyright (c) 2019 Paul Henschel.

## Визуальные ассеты

Сторонние визуальные ассеты в поставку не включены.

- Фоны `public/assets/maps/*/background.webp` созданы специально для Moon
  Courier с помощью OpenAI ImageGen и локально перекодированы детерминированным
  Chromium-пайплайном проекта. Они не являются копиями NASA Moon Kit или иных
  перечисленных в исследовании материалов.
- Спрайты `public/assets/objects/*.png` созданы специально для проекта с помощью
  ImageGen в T009.
- Технический атлас `public/assets/tiles/lunar-logical.png` программно нарисован
  Canvas-командами из `scripts/build-visual-assets.mjs`; внешних исходников у
  него нет.
- Изображения в `references/generated/` являются сгенерированными для проекта
  дизайн-референсами и не загружаются игрой.

Упомянутые в `references/research.md` NASA, Kenney, Game-icons.net и
OpenGameArt исследовались как возможные источники, но их файлы не используются.
Все runtime-ассеты хранятся локально; CDN и сетевые обращения за изображениями
не требуются.

## Тексты лицензий

### MIT

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
