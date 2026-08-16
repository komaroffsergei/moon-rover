# Moon Courier Crisis — исходный SDD v1.0.0

Это доступный для просмотра снимок текстовой части пакета
`moon-courier-sdd-codex-pack` версии `1.0.0`, созданного 13 августа 2026 года.
Файлы извлечены из исходного ZIP без изменения содержимого; этот README является
только навигационным индексом.

SHA-256 исходного ZIP:
`5a9a13d7d14a374212c64598b64ac13a8effd64fb930f2ca2d6fd60e9a6a5878`.

## С чего начать

- [README исходного пакета](PACKAGE_README.md);
- [главный промпт разработки](prompts/00-master-prompt.md);
- [видение продукта](specs/product/00-vision.md) и
  [границы scope](specs/product/01-scope.md);
- [основной игровой цикл](specs/gameplay/01-core-loop.md);
- [карта экранов](specs/ui/01-screen-map.md);
- [архитектура](specs/technical/02-architecture.md);
- [матрица трассировки](quality/TRACEABILITY_MATRIX.md);
- [исходный manifest задач](tasks/manifest.json).

## Состав снимка

| Каталог                               | Содержимое                                            |
| ------------------------------------- | ----------------------------------------------------- |
| [`specs/product`](specs/product/)     | Видение, scope, словарь, решения и допущения          |
| [`specs/gameplay`](specs/gameplay/)   | Игровой цикл, ресурсы, маршруты, аварии и исход смены |
| [`specs/ui`](specs/ui/)               | Экраны, компоновка, состояния, стиль и доступность    |
| [`specs/technical`](specs/technical/) | Стек, архитектура, контент, Docker и границы модулей  |
| [`features`](features/)               | Feature-spec F001–F012                                |
| [`contracts`](contracts/)             | JSON Schema, Tiled-контракт и примеры контента        |
| [`tasks`](tasks/)                     | Первоначальные задачи T001–T012 и их manifest         |
| [`prompts`](prompts/)                 | Главный и поэтапные промпты Codex                     |
| [`quality`](quality/)                 | Приёмка, DoD, тестовая стратегия и три прохода ревью  |

## Приоритет исходных требований

1. `specs/product/03-decisions.md`;
2. соответствующая `features/Fxxx-*.md`;
3. контракты из `contracts/`;
4. остальные спецификации;
5. задачи;
6. визуальные референсы.

Полный manifest исходного архива сохранён как
[`ORIGINAL_PACKAGE_MANIFEST.json`](ORIGINAL_PACKAGE_MANIFEST.json). Он описывает
все 146 файлов ZIP, включая графические референсы и служебные шаблоны, поэтому
его `fileCount` намеренно больше числа файлов в этом текстовом снимке.

[Визуальные референсы](../../../references/README.md) уже присутствуют в
репозитории и побайтово совпадают с исходным архивом.
