# syntax=docker/dockerfile:1.7

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=moon-courier-pnpm-11,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

FROM deps AS development
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev"]

FROM deps AS verify
COPY . .
CMD ["pnpm", "check"]

FROM deps AS build
COPY . .
RUN pnpm build

FROM nginx:1.29.8-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=2s --start-period=2s --retries=30 \
  CMD wget -qO- http://127.0.0.1:8080/healthz | grep -qx ok || exit 1
