# Docker-шаблоны

T001 копирует файлы без суффикса `.template` в корень проекта:

```text
docker/Dockerfile.template      → Dockerfile
docker/compose.yaml.template    → compose.yaml
docker/nginx.conf.template      → docker/nginx.conf
docker/.dockerignore.template   → .dockerignore
```

`package-scripts.template.json` не копируется поверх `package.json`, а используется как нормативный набор scripts.

## Команды

```bash
# Разработка
docker compose up --build dev

# Полный статический и unit/content gate
docker compose run --rm verify

# Отдельная команда внутри verify-образа
docker compose run --rm verify pnpm lint

# E2E; сервис сам ждёт healthcheck dev-сервера
docker compose run --rm e2e

# Production nginx
docker compose up --build app
```

Версия `mcr.microsoft.com/playwright` должна буквально совпадать с `@playwright/test` в lockfile. При обновлении меняются обе позиции одним отдельным maintenance-изменением, не посреди feature-задачи.
