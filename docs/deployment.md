# Wdrożenia i środowiska

Runbook F-09 ([FEATURES.md](FEATURES.md#f-09--cicd-i-środowiska--m), [PROJECT.md §11.6](PROJECT.md#116-hosting-i-usługi-zewnętrzne), [§18](PROJECT.md#18-infrastruktura-devops-jakość)): jak działają staging i preview, jak je uruchomić od zera i co robić przy migracjach, wycofaniu wersji i problemach.

## Środowiska

| Środowisko | Web                                   | API i worker                         | Kiedy powstaje                                |
| ---------- | ------------------------------------- | ------------------------------------ | --------------------------------------------- |
| local      | `pnpm dev` (http://localhost:3000)    | `pnpm dev` (http://localhost:3001)   | zawsze, usługi z `infra/docker-compose.yml`   |
| preview    | Vercel, adres `*.vercel.app` per PR   | API stagingu                         | każdy push do pull requesta                   |
| staging    | Vercel, https://staging.biddy.pl      | Render, https://api.staging.biddy.pl | każdy commit na `main` po zielonym CI         |
| production | —                                     | —                                    | przed startem (osobny feature, tag + akcepty) |

**[DECYZJA TYMCZASOWA]** Domeny stagingu to `staging.biddy.pl` (web) i `api.staging.biddy.pl` (API), z ciasteczkiem sesji na `staging.biddy.pl`. Zmiana domen to zmiana zmiennych w `render.yaml` i w projekcie Vercel.

## Jak przebiega wdrożenie

```
pull request ──► CI (checks, integration, api-image, web) + Vercel preview
merge do main ─► CI na main ──zielone──► Render: build obrazu apps/api/Dockerfile
                                          ├─ API:    preDeploy (migracje) → start → /health → przełączenie ruchu
                                          └─ worker: preDeploy (migracje) → start
               └─► Vercel: build web (staging), od razu po pushu
```

- **API i worker** to jeden obraz Docker (`apps/api/Dockerfile`) z dwoma poleceniami. Render buduje go z `main` dopiero po zielonych checkach GitHub (`autoDeployTrigger: checksPass` w [`render.yaml`](../render.yaml)), więc kod, który nie przeszedł CI, nie trafia na staging.
- **Migracje** (`node dist/infra/db/migrate.js`) uruchamia `preDeployCommand` przed startem nowej wersji API i workera. Migracje biorą blokadę doradczą Postgresa, więc równoległy pre-deploy drugiej usługi czeka i niczego nie powtarza. **Nieudana migracja przerywa deploy, a poprzednia wersja działa dalej.**
- **Zmiany tylko w web** nie budują obrazu API (`buildFilter` w `render.yaml`), a zmiany bez wpływu na web nie budują web na Vercel (`ignoreCommand` z `turbo-ignore` w [`apps/web/vercel.json`](../apps/web/vercel.json)).
- **Wersja (release)** to SHA commita: API bierze ją z `RENDER_GIT_COMMIT` (widać ją w `/health` i w Sentry), web z `VERCEL_GIT_COMMIT_SHA` (zdarzenia Sentry i source mapy pod tym samym release).

Kryterium F-09 mówi o stagingu w mniej niż 15 minut od merge'a. Czas składa się z CI na `main` (najdłuższy job), budowy obrazu na Render (warstwy z zależnościami są w cache, dopóki nie zmieni się lockfile) i startu. Zmierz go po pierwszym uruchomieniu: czas commita na `main` kontra czas „Deploy live” w zdarzeniach usługi na Render. Jeśli przekracza 15 minut, najpierw skróć CI (zdalny cache Turborepo, niżej).

## Pierwsze uruchomienie

Jednorazowo, w tej kolejności. Klucze i hasła trafiają tylko do paneli platform, nigdy do repozytorium.

### 1. Usługi zewnętrzne

- **Sentry** (region EU): projekty `biddy-api` i `biddy-web`. Potrzebne: DSN obu projektów i token organizacji do uploadu source map (`SENTRY_AUTH_TOKEN`). Opcjonalnie integracja z GitHubem (commity w release).
- **Resend:** domena `staging.biddy.pl` z rekordami DNS, klucz API.
- **Cloudflare Turnstile:** widżet dla `staging.biddy.pl` (klucz witryny i klucz tajny).
- **SMSAPI.pl:** token API. Nazwa nadawcy (`SMSAPI_SENDER`) wymaga rejestracji w SMSAPI; do tego czasu zostaw pustą.
- **Google i Apple** (opcjonalnie): klienci OAuth z callbackiem `https://api.staging.biddy.pl/v1/auth/callback/google` (i `/apple`).

### 2. Render (API, worker, Postgres, Key Value)

1. Render → **New → Blueprint** → repozytorium Biddy, plik `render.yaml`, gałąź `main`.
2. Render pyta o wartości `sync: false`: wpisz DSN Sentry (`biddy-api`), klucze Resend, Turnstile i SMSAPI; klucze Google i Apple zostaw puste, jeśli logowanie społecznościowe ma być wyłączone. `BETTER_AUTH_SECRET` Render generuje sam (worker kopiuje go z API).
3. Po utworzeniu usług: **biddy-staging-api → Settings → Custom Domains** → `api.staging.biddy.pl`.
4. Pierwszy deploy wykona migracje na pustej bazie. Kont testowych z seeda na stagingu nie ma (seed odmawia przy `NODE_ENV=production`); konta zakłada się przez rejestrację.

Render GitHub App musi mieć dostęp do checków repozytorium, inaczej `checksPass` nie zobaczy wyniku CI.

### 3. Vercel (web)

1. Vercel → **Add New → Project** → repozytorium Biddy. **Root Directory:** `apps/web` (framework Next.js wykryje sam). **Node.js:** 24.x.
2. Zmienne środowiskowe (Settings → Environment Variables):

| Zmienna                        | Production (= staging)           | Preview                        |
| ------------------------------ | -------------------------------- | ------------------------------ |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (pnpm z `packageManager`)    | `1`                            |
| `NEXT_PUBLIC_ENVIRONMENT`      | `staging`                        | — (sam ustawi się `preview`)   |
| `NEXT_PUBLIC_API_URL`          | `https://api.staging.biddy.pl`   | `https://api.staging.biddy.pl` |
| `NEXT_PUBLIC_SITE_URL`         | `https://staging.biddy.pl`       | — (adres deploymentu)          |
| `NEXT_PUBLIC_SENTRY_DSN`       | DSN `biddy-web`                  | DSN `biddy-web`                |
| `SENTRY_AUTH_TOKEN`            | token Sentry (Sensitive)         | token Sentry (Sensitive)       |
| `SENTRY_ORG`, `SENTRY_PROJECT` | organizacja, `biddy-web`         | jak w Production               |
| `NEXT_PUBLIC_POSTHOG_KEY`      | klucz PostHog (opcjonalnie)      | —                              |

   Na preview `NEXT_PUBLIC_ENVIRONMENT=preview` i adres strony biorą się z `VERCEL_ENV` i `VERCEL_URL` (`platformDefaults` w `apps/web/src/env.ts`). `NEXT_PUBLIC_*` ustaw tylko dla właściwego środowiska: wartość dla „All Environments” wygrałaby z ustawieniem automatycznym.
3. **Settings → Domains:** `staging.biddy.pl` jako domena produkcyjna projektu (gałąź `main`).
4. Zostaw włączone **System Environment Variables** (domyślnie są włączone).

### 4. DNS (Cloudflare)

- `staging.biddy.pl` → rekord wskazany przez Vercel.
- `api.staging.biddy.pl` → `CNAME` na adres usługi z Render (`biddy-staging-api.onrender.com`).

Na początek oba rekordy **bez proxy Cloudflare** (szara chmurka). Proxy Cloudflare przed API wymaga zmiany `TRUST_PROXY` (niżej).

### 5. GitHub

- **Settings → Branches:** ochrona `main` z wymaganymi checkami `Lint, typecheck, testy i build`, `Testy integracyjne (Testcontainers)`, `Obraz API (Docker)` i `Aplikacja web (Playwright)`.
- Opcjonalnie zdalny cache Turborepo (krótsze CI): sekret `TURBO_TOKEN` i zmienna `TURBO_TEAM` (Vercel Remote Cache). Bez nich CI używa cache lokalnego.

## Zmienne środowiskowe

Pełny opis zmiennych jest w [`.env.example`](../.env.example). Na stagingu:

- **Wspólne dla API i workera** (grupa `biddy-staging-shared` w `render.yaml`): `NODE_ENV=production`, `LOG_LEVEL`, `SENTRY_ENVIRONMENT=staging`, `SENTRY_TRACES_SAMPLE_RATE`, `QUEUE_PREFIX`, `WEB_URL`, `MAIL_FROM`.
- **Z zasobów Render:** `DATABASE_URL` (Postgres), `REDIS_QUEUE_URL` (Key Value `noeviction`), `REDIS_CACHE_URL` (Key Value `allkeys-lru`, używany od F-15). Adresy wewnętrzne: bazy i Redisa nie widać z internetu (`ipAllowList: []`).
- **Tylko API:** `API_PUBLIC_URL`, `CORS_ORIGINS`, `AUTH_COOKIE_DOMAIN`, `OPENAPI_ENABLED=true` (Swagger UI pod `/docs` na stagingu) i sekrety.
- **Ustawiane przez Render:** `PORT`, `RENDER_GIT_COMMIT`.

Nowa zmienna API: dopisz ją do `.env.example`, a jeśli staging jej wymaga, do `render.yaml` (sekret jako `sync: false` i ręcznie w panelu usługi, bo `sync: false` działa tylko przy tworzeniu Blueprintu).

## Migracje: zasady

- Migracja musi działać z **poprzednią** wersją kodu (expand → contract, [PROJECT.md §18.2](PROJECT.md#182-cicd-github-actions)): stara wersja API działa dalej, gdy nowa wykonuje pre-deploy, i zostaje, jeśli deploy się nie uda.
  - Nowa kolumna: nullowalna albo z wartością domyślną. Wypełnienie danych i `NOT NULL` w kolejnym wdrożeniu.
  - Usunięcie albo zmiana nazwy kolumny: najpierw kod przestaje jej używać (wdrożenie), dopiero potem migracja ją usuwa.
- Nie edytuj migracji już wdrożonej (Drizzle śledzi je w `drizzle.__drizzle_migrations`). Poprawka to nowa migracja.
- **Nieudana migracja na stagingu:** deploy ma status „Pre-deploy failed”, działa poprzednia wersja. Log pre-deploy pokazuje przyczynę (`[db:migrate] Migracje nie powiodły się: …`). Popraw migrację nowym commitem. Migracja w transakcji nie zostawia połowicznych zmian.

## Wycofanie wersji

- **API i worker:** Render → usługa → Events → wcześniejszy deploy → **Rollback**. Działa bez zmian w bazie, jeśli migracje nowej wersji były wstecznie kompatybilne (zasady wyżej). Migracji nie cofamy automatycznie.
- **Web:** Vercel → Deployments → wcześniejszy deployment → **Instant Rollback**.

## Weryfikacja `TRUST_PROXY` na Render

API ufa nagłówkowi `X-Forwarded-For` tylko od adresów loopback i prywatnych (domyślne `TRUST_PROXY` na produkcji: `loopback,uniquelocal`), bo przed usługą stoi load balancer Render w sieci prywatnej. Od tego zależą limity per IP (logowanie, SMS-y).

Sprawdzenie po pierwszym deployu:

1. Sprawdź swój publiczny adres (np. `curl https://ifconfig.me`).
2. Wyślij żądanie z fałszywym nagłówkiem:
   ```bash
   curl -H 'X-Forwarded-For: 203.0.113.7' https://api.staging.biddy.pl/health
   ```
3. W logach API (Render → Logs) znajdź to żądanie: `req.remoteAddress` musi być **Twoim** adresem, a nie `203.0.113.7` (podrobiony nagłówek) ani adresem `10.x` (load balancer).

Jeśli przed API stoi proxy Cloudflare (pomarańczowa chmurka), `remoteAddress` będzie adresem Cloudflare. Wtedy dopisz zakresy Cloudflare do `TRUST_PROXY` (https://www.cloudflare.com/ips/), np. `TRUST_PROXY=loopback,uniquelocal,173.245.48.0/20,…`, i powtórz sprawdzenie.

## Preview deployments: ograniczenia

Preview działa pod `*.vercel.app` i rozmawia z API stagingu. Strony renderowane na serwerze i statyczne działają, ale wywołania API z przeglądarki blokuje CORS (API stagingu ufa tylko `https://staging.biddy.pl`), a ciasteczko sesji z `staging.biddy.pl` do `*.vercel.app` nie trafia. **Preview służy do przeglądu interfejsu; logowanie i dane testuj na stagingu.** Pełne preview z sesją wymaga adresów preview pod `biddy.pl` (Vercel Preview Deployment Suffix, plan Pro) i dopisania ich do `CORS_ORIGINS`.

## Rozwiązywanie problemów

- **Worker restartuje się zaraz po starcie:** w logach `maxmemory-policy`: Key Value kolejek musi mieć `noeviction` (`render.yaml`, F-04).
- **API nie startuje, w logach lista zmiennych:** brakuje wymaganej zmiennej produkcyjnej (lista w README, „API (apps/api)”). Uzupełnij ją w panelu usługi.
- **Render nie wdraża po merge'u:** sprawdź, czy wszystkie checki CI na commicie są zielone i czy Render GitHub App ma dostęp do checków. Zmiana tylko poza `buildFilter` (np. same dokumenty) celowo nie wdraża API.
- **Build web na Vercel się nie uruchomił:** `turbo-ignore` uznał, że zmiana nie dotyczy `@biddy/web`. Wymuś deploy z panelu (Redeploy).
- **Obraz lokalnie:** `docker build -f apps/api/Dockerfile -t biddy-api .`, test jak w CI: `.github/scripts/smoke-api-image.sh` (opis w nagłówku skryptu).
