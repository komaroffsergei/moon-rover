# Docker

Все рабочие операции выполняются контейнерами. Локальный Node/pnpm не является обязательным условием разработки.

## Compose services

- `dev`: Vite, port 5173, bind mount и named volumes;
- `verify`: format check + lint + typecheck + unit + content validation + build;
- `e2e`: официальный version-matched Playwright image, ожидающий healthcheck `dev`;
- `app`: production nginx, port 8080.

```bash
docker compose up --build dev
docker compose run --rm verify
docker compose run --rm e2e
docker compose up --build app
```

Dockerfile multi-stage на `node:24-bookworm-slim`, Corepack/pinned pnpm, отдельные `deps/development/verify/build/runtime`. Production содержит только nginx и `dist`, без Node, исходников и dev-зависимостей. Версия Playwright image обязана совпадать с `@playwright/test` из lockfile.

Нормативные шаблоны и порядок копирования находятся в `docker/README.md`.
