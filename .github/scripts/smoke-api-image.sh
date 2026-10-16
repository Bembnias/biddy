#!/usr/bin/env bash
# Test dymny obrazu API (apps/api/Dockerfile) tak, jak uruchamia go Render (F-09):
# migracje jako krok przed deployem (dwa razy: drugi raz nic nie robi), API odpowiada na /health
# i /ready, a worker działa po starcie (m.in. sprawdza noeviction Redisa kolejek). Do tego sharp
# (natywny libvips dla musl w obrazie Alpine) przetwarza zdjęcie.
#
# Użycie: IMAGE=biddy-api:ci DATABASE_URL=… REDIS_QUEUE_URL=… .github/scripts/smoke-api-image.sh
# W CI Postgres i Redis to kontenery usług GitHub Actions (sieć hosta). Lokalnie można podać
# NETWORK (sieć Docker z bazą i Redisem) i API_URL (adres API widziany z hosta).
set -euo pipefail

IMAGE="${IMAGE:-biddy-api:ci}"
NETWORK="${NETWORK:-host}"
API_PORT="${API_PORT:-10000}"
API_URL="${API_URL:-http://127.0.0.1:${API_PORT}}"
: "${DATABASE_URL:?Ustaw DATABASE_URL}"
: "${REDIS_QUEUE_URL:?Ustaw REDIS_QUEUE_URL}"

# Konfiguracja jak na stagingu (NODE_ENV=production wymaga kompletu zmiennych), z kluczami testowymi.
ENV_ARGS=(
  -e NODE_ENV=production
  -e "DATABASE_URL=${DATABASE_URL}"
  -e "REDIS_QUEUE_URL=${REDIS_QUEUE_URL}"
  -e "REDIS_CACHE_URL=${REDIS_CACHE_URL:-${REDIS_QUEUE_URL}}"
  -e PORT="${API_PORT}"
  -e CORS_ORIGINS=https://staging.biddy.pl
  -e WEB_URL=https://staging.biddy.pl
  -e API_PUBLIC_URL=https://api.staging.biddy.pl
  -e BETTER_AUTH_SECRET=smoke-test-secret-0123456789-0123456789
  -e TURNSTILE_SITE_KEY=1x00000000000000000000AA
  -e TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
  -e RESEND_API_KEY=re_smoke_test
  -e SMSAPI_TOKEN=smoke-test
  -e S3_ENDPOINT=https://smoke-test.eu.r2.cloudflarestorage.com
  -e S3_ACCESS_KEY_ID=smoke-test
  -e S3_SECRET_ACCESS_KEY=smoke-test
  -e MEDIA_PUBLIC_URL=https://media.staging.biddy.pl
  -e WEB_REVALIDATE_SECRET=smoke-test-revalidate-0123456789-0123456789
  -e MEILI_URL=https://smoke-test.meilisearch.invalid
  -e MEILI_API_KEY=smoke-test-meili-key
  -e RENDER_GIT_COMMIT="${GITHUB_SHA:-smoke}"
)
PUBLISH=()
if [[ "${NETWORK}" != "host" ]]; then
  PUBLISH=(-p "127.0.0.1:${API_PORT}:${API_PORT}")
fi

cleanup() {
  docker rm -f smoke-api smoke-worker >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "::error::$1"
  echo '--- logi API ---'
  docker logs smoke-api 2>&1 | tail -50 || true
  echo '--- logi workera ---'
  docker logs smoke-worker 2>&1 | tail -50 || true
  exit 1
}

echo '== sharp w obrazie (przetwarzanie zdjęć, F-12)'
docker run --rm "${IMAGE}" node --input-type=module -e "
const { default: sharp } = await import('sharp');
const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7' } }).png().toBuffer();
const webp = await sharp(png).resize(320).webp().toBuffer();
const { format, width } = await sharp(webp).metadata();
if (format !== 'webp' || width !== 320) throw new Error(format + ' ' + width);
console.log('sharp', sharp.versions.sharp, 'libvips', sharp.versions.vips, 'OK');
" || fail 'sharp nie działa w obrazie'

echo '== Migracje (preDeployCommand)'
docker run --rm --network "${NETWORK}" "${ENV_ARGS[@]}" "${IMAGE}" node dist/infra/db/migrate.js
docker run --rm --network "${NETWORK}" "${ENV_ARGS[@]}" "${IMAGE}" node dist/infra/db/migrate.js

echo '== Start API (domyślne CMD) i workera (dockerCommand z render.yaml)'
docker run -d --name smoke-api --network "${NETWORK}" ${PUBLISH[@]+"${PUBLISH[@]}"} "${ENV_ARGS[@]}" "${IMAGE}" >/dev/null
docker run -d --name smoke-worker --network "${NETWORK}" "${ENV_ARGS[@]}" "${IMAGE}" \
  node --import ./dist/instrument.js dist/worker.js >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "${API_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
health="$(curl -fsS "${API_URL}/health")" || fail 'API nie odpowiada na /health'
echo "/health: ${health}"
[[ "${health}" == *"\"release\":\"${GITHUB_SHA:-smoke}\""* ]] || fail 'API nie zna wersji (RENDER_GIT_COMMIT)'
ready="$(curl -fsS "${API_URL}/ready")" || fail 'API nie jest gotowe (/ready)'
echo "/ready: ${ready}"

# Worker kończy się kodem 1 przy błędnej konfiguracji albo Redisie bez noeviction.
sleep 10
[[ "$(docker inspect -f '{{.State.Running}}' smoke-worker)" == 'true' ]] || fail 'Worker nie działa po starcie'
docker logs smoke-worker 2>&1 | grep -q 'Worker działa' || fail 'Brak logu startu workera'
echo 'Obraz API działa: migracje, API i worker.'
