# syntax=docker/dockerfile:1
# Obraz web Biddy: lokalnie w Dockerze (infra/docker-compose.app.yml) i na serwerze z Dokploy
# (infra/dokploy/docker-compose.yml, docs/deployment-dokploy.md).
#
# Budowa z katalogu głównego repozytorium (kontekst = całe monorepo):
#   docker build -f apps/web/Dockerfile -t biddy-web .
#
# Zmienne NEXT_PUBLIC_* Next.js wkleja do kodu przy buildzie (argumenty poniżej), więc obraz jest
# związany ze środowiskiem (osobny obraz dla stagingu i produkcji). Adres API dla renderowania na
# serwerze (API_INTERNAL_URL) i sekret rewalidacji (WEB_REVALIDATE_SECRET) czyta przy starcie.
#
# Upload source map do Sentry: sekret BuildKit `sentry_auth_token` (opcjonalny), np.
#   docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN …

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

# 2. Zależności i build web z pakietami workspace. NEXT_OUTPUT=standalone: Next.js składa
#    samodzielny serwer z minimalnym node_modules (next.config.ts).
FROM base AS builder
ARG NEXT_PUBLIC_ENVIRONMENT=local
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_FURGONETKA_MAP_KEY=
ARG NEXT_PUBLIC_APP_RELEASE=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ENV NEXT_PUBLIC_ENVIRONMENT=${NEXT_PUBLIC_ENVIRONMENT} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_FURGONETKA_MAP_KEY=${NEXT_PUBLIC_FURGONETKA_MAP_KEY} \
    NEXT_PUBLIC_APP_RELEASE=${NEXT_PUBLIC_APP_RELEASE} \
    SENTRY_ORG=${SENTRY_ORG} \
    SENTRY_PROJECT=${SENTRY_PROJECT} \
    NEXT_OUTPUT=standalone
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/.pnpmfile.cjs ./.pnpmfile.cjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
# Token Sentry tylko na czas buildu (sekret BuildKit nie zostaje w warstwach obrazu).
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm turbo run build --filter=@biddy/web

# 3. Obraz końcowy: samodzielny serwer Next.js (server.js) z plikami statycznymi, bez źródeł,
#    narzędzi i zależności deweloperskich.
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
