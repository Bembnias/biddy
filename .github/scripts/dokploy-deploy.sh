#!/usr/bin/env bash
# Wdrożenie stosu Biddy w Dokploy (docs/deployment-dokploy.md): zleca deploy przez API Dokploy
# (POST /api/compose.deploy) i czeka, aż API przedstawi się oczekiwaną wersją (/health → release),
# a web zacznie odpowiadać. Dokploy pobiera obrazy z tagiem `staging`, więc przed wywołaniem tag
# musi wskazywać obrazy wersji SHA (robi to workflow .github/workflows/deploy-dokploy.yml).
#
# Użycie: DOKPLOY_URL=… DOKPLOY_API_KEY=… COMPOSE_ID=… API_URL=… WEB_URL=… \
#   .github/scripts/dokploy-deploy.sh <SHA commita>
# TIMEOUT: ile sekund czekać na nową wersję API (domyślnie 720: migracje, pobranie obrazów, start).
set -euo pipefail

SHA="${1:?Podaj SHA commita, którego wersję wdrażasz}"
: "${DOKPLOY_URL:?Ustaw DOKPLOY_URL (adres panelu Dokploy)}"
: "${DOKPLOY_API_KEY:?Ustaw DOKPLOY_API_KEY (klucz API z profilu w Dokploy)}"
: "${COMPOSE_ID:?Ustaw COMPOSE_ID (identyfikator usługi Compose w Dokploy)}"
: "${API_URL:?Ustaw API_URL (publiczny adres API)}"
: "${WEB_URL:?Ustaw WEB_URL (publiczny adres web)}"
TIMEOUT="${TIMEOUT:-720}"

response="$(mktemp)"
trap 'rm -f "$response"' EXIT

body="$(jq -n --arg id "$COMPOSE_ID" --arg title "CI ${SHA:0:12}" '{composeId: $id, title: $title}')"
status="$(curl -sS -o "$response" -w '%{http_code}' -X POST "${DOKPLOY_URL%/}/api/compose.deploy" \
  -H 'content-type: application/json' -H "x-api-key: ${DOKPLOY_API_KEY}" -d "$body")"
if [ "$status" -ge 300 ]; then
  echo "::error::Dokploy odrzucił deploy (HTTP ${status}): $(head -c 500 "$response")"
  exit 1
fi
echo "Dokploy przyjął deploy wersji ${SHA}."

# Dokploy wdraża w tle (pobranie obrazów, migracje, start), więc sprawdzamy wynik po /health.
deadline=$((SECONDS + TIMEOUT))
release=''
until [ "$release" = "$SHA" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::API nie przeszło na wersję ${SHA} w ${TIMEOUT} s (ostatnio: ${release:-brak odpowiedzi}). Przyczyna w logach wdrożenia w Dokploy (usługa Compose → Deployments)."
    exit 1
  fi
  sleep 10
  release="$(curl -fs --max-time 5 "${API_URL%/}/health" | jq -r '.release // empty' 2>/dev/null || true)"
  echo "API: ${release:-brak odpowiedzi}"
done

# Web startuje po zdrowym API (depends_on), zwykle kilka sekund później.
deadline=$((SECONDS + 180))
until curl -fs --max-time 10 -o /dev/null "${WEB_URL%/}/"; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error::Web nie odpowiada po wdrożeniu wersji ${SHA}. Sprawdź logi usługi web w Dokploy."
    exit 1
  fi
  sleep 5
done
echo "Wersja ${SHA} działa: API i web odpowiadają."
