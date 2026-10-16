# Obraz API Biddy (PROJECT.md §11.6): ten sam obraz uruchamia API, workera i migracje.
#   API (domyślne CMD):  node --import ./dist/instrument.js dist/main.js
#   worker:              node --import ./dist/instrument.js dist/worker.js
#   migracje (pre-deploy): node dist/infra/db/migrate.js
#
# Budowa z katalogu głównego repozytorium (kontekst = całe monorepo):
#   docker build -f apps/api/Dockerfile -t biddy-api .
#
# Wersje Node i Turborepo muszą zgadzać się z .nvmrc i katalogiem pnpm (pnpm-workspace.yaml);
# pilnuje tego test apps/api/test/unit/dockerfile.test.ts.

ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG TURBO_VERSION=2.11.7

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    TURBO_TELEMETRY_DISABLED=1
# pnpm w wersji z pola packageManager (package.json) przez corepack.
RUN corepack enable
WORKDIR /repo

# 1. Tylko pakiety potrzebne API (turbo prune). Zmiana w apps/web nie unieważnia cache warstw
#    z zależnościami i buildem API.
FROM base AS pruner
ARG TURBO_VERSION
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @biddy/api --docker

# 2. Wszystkie zależności (z cache magazynu pnpm) i build API z pakietami workspace.
FROM base AS builder
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Hooki pnpm (lockfile zapisuje ich sumę kontrolną; turbo prune ich nie kopiuje).
COPY --from=pruner /repo/.pnpmfile.cjs ./.pnpmfile.cjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@biddy/api

# 3. Same zależności produkcyjne API i jego pakietów workspace, instalowane od zera (instalacja
#    --prod na istniejących node_modules zostawia narzędzia w magazynie .pnpm).
FROM base AS production-deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
# Hooki pnpm (lockfile zapisuje ich sumę kontrolną; turbo prune ich nie kopiuje).
COPY --from=pruner /repo/.pnpmfile.cjs ./.pnpmfile.cjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter=@biddy/api...

# 4. Obraz końcowy: zbudowany kod, migracje SQL i zależności produkcyjne, bez źródeł i narzędzi.
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps --chown=node:node /repo/package.json ./
COPY --from=production-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
# Pakiety workspace razem z własnymi zależnościami (np. zod w @biddy/shared): Node szuka ich
# w node_modules obok pakietu.
COPY --from=production-deps --chown=node:node /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=node:node /repo/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
# Szablony e-maili (F-20) z Reactem i React Email oraz kolory z design tokens.
COPY --from=production-deps --chown=node:node /repo/packages/emails/node_modules ./packages/emails/node_modules
COPY --from=builder --chown=node:node /repo/packages/emails/package.json ./packages/emails/
COPY --from=builder --chown=node:node /repo/packages/emails/dist ./packages/emails/dist
COPY --from=builder --chown=node:node /repo/packages/design-tokens/package.json ./packages/design-tokens/
COPY --from=builder --chown=node:node /repo/packages/design-tokens/dist ./packages/design-tokens/dist
COPY --from=builder --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=builder --chown=node:node /repo/apps/api/dist ./apps/api/dist
# Migracje SQL (src/infra/db/migrations.ts szuka ich w apps/api/drizzle względem dist/).
COPY --from=builder --chown=node:node /repo/apps/api/drizzle ./apps/api/drizzle
USER node
WORKDIR /app/apps/api
# Port podaje platforma w PORT (Render); bez niego API_PORT albo 3001.
EXPOSE 3001
CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]
