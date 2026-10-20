# Obraz web Biddy do uruchomienia lokalnie w Dockerze (infra/docker-compose.app.yml). Produkcja
# i preview działają na Vercel (bez tego obrazu).
#
# Budowa z katalogu głównego repozytorium (kontekst = całe monorepo):
#   docker build -f apps/web/Dockerfile -t biddy-web .
#
# Zmienne NEXT_PUBLIC_* Next.js wkleja do kodu przy buildzie (argumenty poniżej); adres API dla
# renderowania na serwerze (API_INTERNAL_URL) czyta przy starcie.

ARG NODE_IMAGE=node:24.21.0-alpine3.24
ARG TURBO_VERSION=2.11.7

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# 1. Tylko pakiety potrzebne web (turbo prune).
FROM base AS pruner
ARG TURBO_VERSION
COPY . .
RUN pnpm dlx turbo@${TURBO_VERSION} prune @biddy/web --docker

# 2. Zależności i build web z pakietami workspace.
FROM base AS builder
ARG NEXT_PUBLIC_ENVIRONMENT=local
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_ENVIRONMENT=${NEXT_PUBLIC_ENVIRONMENT} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/.pnpmfile.cjs ./.pnpmfile.cjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter=@biddy/web

# 3. Uruchomienie: `next start` na zbudowanej aplikacji (nasłuchuje na wszystkich interfejsach).
FROM builder AS runner
ENV NODE_ENV=production
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
