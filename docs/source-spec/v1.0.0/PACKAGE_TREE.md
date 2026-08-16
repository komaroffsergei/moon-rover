# Состав SDD-пакета

Полный машинно-читаемый перечень находится в `PACKAGE_TREE.txt`, а контрольные суммы — в `MANIFEST.json`.

## Каталоги и корневые файлы

| Раздел | Файлов | Назначение |
|---|---:|---|
| `.agents` | 1 | локальный Codex skill с progressive disclosure |
| `.codex` | 1 | пример конфигурации Codex |
| `AGENTS.md` | 1 | корневой управляющий документ |
| `CODEX_START.md` | 1 | корневой управляющий документ |
| `PACKAGE_TREE.md` | 1 | корневой управляющий документ |
| `PACKAGE_TREE.txt` | 1 | корневой управляющий документ |
| `PACKAGE_VALIDATION.md` | 1 | корневой управляющий документ |
| `PLANS.md` | 1 | корневой управляющий документ |
| `README.md` | 1 | корневой управляющий документ |
| `TASK_INDEX.md` | 1 | корневой управляющий документ |
| `THIRD_PARTY_NOTICES.md` | 1 | корневой управляющий документ |
| `contracts` | 12 | JSON Schema, Tiled-контракт и валидные примеры |
| `docker` | 6 | шаблоны dev/verify/e2e/production контейнеров |
| `features` | 12 | 12 feature-spec с критериями и out-of-scope |
| `prompts` | 19 | master/review/task prompts |
| `quality` | 10 | DoD, тесты, три прохода ревью и контроль контекста |
| `references` | 16 | исследование, ассеты и визуальные референсы |
| `reports` | 1 | каталог отчётов Codex по задачам |
| `specs` | 33 | нормативные product/gameplay/UI/technical спецификации |
| `src` | 7 | nested AGENTS.md для будущих зон ответственности |
| `tasks` | 15 | 12 последовательных task-spec и machine-readable manifest |
| `templates` | 4 | шаблоны ADR, feature-spec, CODEMAP и лицензий |

## Главные точки входа

- `CODEX_START.md` — первая команда;
- `AGENTS.md` — постоянные ограничения;
- `tasks/manifest.json` — очередность;
- `quality/THREE_PASS_WORKFLOW.md` — обязательная проверка каждой задачи;
- `references/CONTACT_SHEET.png` — обзор интерфейсов;
- `PACKAGE_VALIDATION.md` — проверка целостности пакета.
