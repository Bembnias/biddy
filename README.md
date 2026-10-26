# Biddy

Biddy to marketplace C2C z licytacjami czasowymi. Kupujący płaci za Pakiet Ochrony Kupujących, a Biddy wstrzymuje środki do czasu odbioru przedmiotu, obsługuje dostawę i spory.

- Specyfikacja produktu i architektury: [docs/PROJECT.md](docs/PROJECT.md)
- Lista feature speców z szacunkami i zależnościami: [docs/FEATURES.md](docs/FEATURES.md)
- Wdrożenia i środowiska (staging, preview, migracje, wycofanie wersji): [docs/deployment.md](docs/deployment.md)
- Staging na własnym serwerze (Oracle Cloud + Dokploy, CI/CD z GitHub Actions): [docs/deployment-dokploy.md](docs/deployment-dokploy.md)

## Wymagania

| Narzędzie            | Wersja                         | Uwagi                                                                                                                               |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Node.js              | 24 LTS (plik `.nvmrc`)         | `nvm install && nvm use` albo `fnm use --install-if-missing`. Projekt wymaga `>=24.11 <25`.                                         |
| pnpm                 | 10 (przez corepack)            | `corepack enable` raz na maszynę. Dokładną wersję pnpm wybiera pole `packageManager` w `package.json`. Nie instaluj pnpm globalnie. |
| Docker z compose v2  | Docker Desktop albo Engine 25+ | Polecenie `docker compose` (nie stare `docker-compose`). Na Windows przez WSL 2.                                                    |
| Wolne porty lokalnie | patrz [Usługi](#usługi)        | Zajęty port zmienisz w `.env` (patrz [Rozwiązywanie problemów](#rozwiązywanie-problemów)).                                          |

## Szybki start

Cała procedura zajmuje kilka minut, najdłużej trwa pierwsze pobranie obrazów Dockera.

```bash
git clone <adres-repozytorium> biddy && cd biddy
nvm install          # Node 24 z .nvmrc
corepack enable      # pnpm w wersji z package.json
pnpm install
pnpm bootstrap       # .env, usługi w Dockerze, kubełki S3, baza
```

`pnpm bootstrap` wykonuje po kolei:

1. Kopiuje `.env.example` do `.env`, jeśli `.env` jeszcze nie ma (istniejącego pliku nie nadpisuje).
2. Waliduje zmienne środowiskowe (to samo co `pnpm env:check`) i sprawdza bezpieczniki: `DATABASE_URL` i `S3_ENDPOINT` muszą wskazywać na tę maszynę, a `NODE_ENV` nie może być `production`. Inaczej kończy się błędem, zanim cokolwiek zmieni.
3. Sprawdza Dockera i uruchamia usługi z `infra/docker-compose.yml`, czekając na ich healthchecki.
4. Tworzy kubełki S3 i regułę CORS (to samo co `pnpm storage:setup`).
5. Odtwarza lokalną bazę: usuwa ją, tworzy od nowa, uruchamia migracje i seed (to samo co `pnpm db:reset`).

Na końcu wypisuje tabelę usług z adresami i danymi logowania. Skrypt można uruchomić ponownie, ale za każdym razem czyści lokalną bazę.

Sprawdzenie, czy poczta lokalna działa:

```bash
pnpm mail:test       # wysyła mail przez SMTP i potwierdza, że dotarł do Mailpit
```

Codzienna praca:

```bash
pnpm dev               # infra:up, potem tryb deweloperski: API, worker i Bull Board
pnpm infra:down        # zatrzymuje usługi, dane zostają w wolumenach Dockera
pnpm check             # lint, typecheck, testy, formatowanie i aktualność klienta API przed pull requestem
pnpm test:integration  # testy integracyjne z Testcontainers (wymaga Dockera)
pnpm api:generate      # po zmianie endpointu albo DTO: kontrakt OpenAPI i klient API od nowa
```

Aplikacja web działa wtedy pod http://localhost:3000, API pod http://localhost:3001 (sonda http://localhost:3001/health, dokumentacja http://localhost:3001/docs), worker przetwarza joby i eventy domenowe, a podgląd kolejek (Bull Board) jest pod http://localhost:3002. Szczegóły: [Aplikacja web (apps/web)](#aplikacja-web-appsweb), [API (apps/api)](#api-appsapi) i [Kolejki, workery i outbox](#kolejki-workery-i-outbox).

Konta testowe (tworzy je seed w `pnpm bootstrap` i `pnpm db:reset`), wszystkie z hasłem `Biddy-test-2026`, potwierdzonym e-mailem i zweryfikowanym telefonem (mogą licytować i wystawiać):

| E-mail                    | Telefon        | Kto                                |
| ------------------------- | -------------- | ---------------------------------- |
| `kupujacy@biddy.local`    | `+48500000001` | Kasia Kupująca, zwykłe konto       |
| `sprzedajacy@biddy.local` | `+48500000002` | Staszek Sprzedający, zwykłe konto  |
| `admin@biddy.local`       | `+48500000003` | Ada Admin, rola wewnętrzna `admin` |

Maile z linkami (weryfikacja adresu, reset hasła) wysyła worker, a lokalnie przechwytuje je Mailpit: http://localhost:8025. Kody SMS weryfikacji telefonu lokalnie nie wychodzą: API zapisuje je w logu (`SMS (atrapa) do +48…`).

### Cała aplikacja w Dockerze

Do ręcznego testowania bez uruchamiania kodu lokalnie: `pnpm app:up` buduje obrazy API (`apps/api/Dockerfile`) i web (`apps/web/Dockerfile`) i startuje infrastrukturę, migracje z kontami testowymi, API, worker i web (`infra/docker-compose.app.yml`). Web: http://localhost:3000, API: http://localhost:3001, Mailpit: http://localhost:8025. Konta testowe: `kupujacy@biddy.local`, `sprzedajacy@biddy.local`, `admin@biddy.local`, hasło `Biddy-test-2026`. Kody SMS i logi: `pnpm app:logs`; zatrzymanie: `pnpm app:down` (dane zostają). Zdjęcia idą do S3 pod nazwą `s3.localhost` (Chrome i Firefox kierują ją na 127.0.0.1). Przy pisaniu kodu wygodniejsze jest `pnpm dev`.

## Usługi

Wszystkie usługi działają w Dockerze (projekt compose `biddy`) i są dostępne tylko z tej maszyny (porty wystawione na `127.0.0.1`). Dane trzymają nazwane wolumeny, więc przetrwają `pnpm infra:down`.

| Usługa                             | Adres lokalny                         | Port (zmienna w `.env`)      | Dane logowania                       | Na produkcji                    |
| ---------------------------------- | ------------------------------------- | ---------------------------- | ------------------------------------ | ------------------------------- |
| PostgreSQL 17                      | `postgres://localhost:5432/biddy`     | 5432 (`POSTGRES_PORT`)       | `biddy` / `biddy`                    | Render Postgres                 |
| Redis: kolejki BullMQ (noeviction) | `redis://localhost:6379`              | 6379 (`REDIS_QUEUE_PORT`)    | bez hasła                            | Render Key Value                |
| Redis: cache i pub/sub (LRU)       | `redis://localhost:6380`              | 6380 (`REDIS_CACHE_PORT`)    | bez hasła                            | Render Key Value (2. instancja) |
| Meilisearch                        | http://localhost:7700                 | 7700 (`MEILI_PORT`)          | klucz `biddy-local-meili-master-key` | Meilisearch Cloud (EU)          |
| RustFS: API S3                     | http://localhost:9000                 | 9000 (`RUSTFS_PORT`)         | `biddy-local` / `biddy-local-secret` | Cloudflare R2                   |
| RustFS: konsola WWW                | http://localhost:9001/rustfs/console/ | 9001 (`RUSTFS_CONSOLE_PORT`) | `biddy-local` / `biddy-local-secret` | panel Cloudflare                |
| Mailpit: SMTP                      | `localhost:1025`                      | 1025 (`SMTP_PORT`)           | dowolne albo brak                    | Resend                          |
| Mailpit: podgląd maili             | http://localhost:8025                 | 8025 (`MAILPIT_UI_PORT`)     | bez logowania (tylko host localhost) | nie dotyczy                     |

Kubełki S3 tworzone przez `pnpm storage:setup`:

- `biddy-uploads`: prywatny, oryginały zdjęć prosto z przeglądarki (z EXIF) i zdjęcia zatrzymane przez moderację. Reguła CORS pozwala przeglądarce z `http://localhost:3000` (zmienna `S3_CORS_ORIGINS`) na `PUT`, czyli upload przez presigned URL.
- `biddy-media`: publiczny do odczytu (polityka `s3:GetObject`), tylko przetworzone zdjęcia WebP bez metadanych. CORS: `GET` i `HEAD`.
- `biddy-documents`: dokumenty prywatne (etykiety, dowody w sporach, faktury), bez CORS.

Kubełek uploads musi być inny niż media i documents (`pnpm env:check` to sprawdza): oryginał z GPS nie może trafić do publicznego kubełka.

**Dlaczego RustFS, a nie MinIO:** MinIO przestało publikować obrazy Dockera w wersji community. RustFS jest zgodny z API S3 i MinIO, ma licencję Apache 2.0. Lokalnie używa tylko adresów w stylu ścieżki (`S3_FORCE_PATH_STYLE=true`).

**Mailpit tylko pod `localhost` i `127.0.0.1`:** interfejs i API odrzucają (HTTP 403) inne nagłówki Host (`MP_ALLOWED_HOSTS`). To ochrona przed DNS rebinding: obca strona otwarta w przeglądarce nie przeczyta przechwyconych maili z magic linkami i kodami. Dlatego w `MAILPIT_UI_URL` używaj hosta `localhost` albo `127.0.0.1`.

**Dwie instancje Redis:** BullMQ wymaga `maxmemory-policy noeviction`, bo eviction gubi joby. Cache używa `allkeys-lru`. Osobne instancje sprawiają, że zapełniony cache nie blokuje kolejek ([PROJECT.md §11.2](docs/PROJECT.md#112-backend)).

## Zmienne środowiskowe

- Szablon z opisem każdej zmiennej: [`.env.example`](.env.example). Wartości z szablonu działają od razu.
- Twoja kopia: `.env` w katalogu głównym. Nie trafia do repozytorium.
- `pnpm env:check` waliduje zmienne (schemat Zod w `infra/scripts/env.ts`) i wypisuje naraz wszystkie błędne lub brakujące. Pilnuje też zgodności, np. czy port w `DATABASE_URL` jest taki sam jak `POSTGRES_PORT`.
- Zmienne ustawione w powłoce mają pierwszeństwo przed `.env`, tak samo jak w docker compose.
- Znaki `$` i `#` w hasłach i kluczach: docker compose i Node czytają je w `.env` inaczej (compose podstawia `$ZMIENNA`, Node ucina wartość na `#`). Wartość z takimi znakami ujmij w pojedyncze cudzysłowy, np. `POSTGRES_PASSWORD='abc$def#1'`. `pnpm env:check` zgłasza wartości, które kontener i skrypty odczytałyby różnie.
- Znak `%` (i inne znaki specjalne) w haśle w `DATABASE_URL` zakoduj: `%` jako `%25`, `@` jako `%40`. `POSTGRES_PASSWORD` zostaje bez kodowania.
- Produkcja nie korzysta z `.env`: sekrety są w zmiennych środowiskowych platform (Render, Vercel), a zamiast usług z Dockera działają Render Postgres i Key Value, Cloudflare R2, Meilisearch Cloud i Resend ([PROJECT.md §11.6](docs/PROJECT.md#116-hosting-i-usługi-zewnętrzne)).

## Skrypty

Wszystkie uruchamiasz z katalogu głównego.

| Skrypt                  | Co robi                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`        | Pierwsze uruchomienie: `.env`, walidacja, usługi, kubełki S3, reset bazy, podsumowanie.                                               |
| `pnpm dev`              | `pnpm infra:up`, a potem `turbo run dev dev:worker dev:board`: web, API, worker i Bull Board w trybie deweloperskim.                  |
| `pnpm build`            | Build wszystkich pakietów i aplikacji (Turborepo z cache).                                                                            |
| `pnpm lint`             | ESLint (flat config, reguły z informacją o typach).                                                                                   |
| `pnpm typecheck`        | `tsc --noEmit` we wszystkich pakietach.                                                                                               |
| `pnpm test`             | Testy jednostkowe (Vitest).                                                                                                           |
| `pnpm test:integration` | Testy integracyjne (Testcontainers): własny Postgres, Redis i RustFS w kontenerach. Wymaga Dockera, nie wymaga `pnpm infra:up`.       |
| `pnpm check`            | `lint`, `typecheck`, `test`, `format:check` i `api:check` razem.                                                                      |
| `pnpm api:generate`     | Zapisuje kontrakt OpenAPI (`apps/api/openapi.json`) i generuje z niego klienta (`packages/api-client/src/generated`).                 |
| `pnpm api:check`        | Sprawdza bez zmian w plikach, czy kontrakt i klient zgadzają się z kodem API (CI). Gdy nie, uruchom `pnpm api:generate`.              |
| `pnpm format`           | Formatuje repozytorium Prettierem.                                                                                                    |
| `pnpm format:check`     | Sprawdza formatowanie bez zmian w plikach.                                                                                            |
| `pnpm clean`            | Usuwa wyniki buildów i cache.                                                                                                         |
| `pnpm env:check`        | Waliduje zmienne środowiskowe z `.env`.                                                                                               |
| `pnpm infra:up`         | Sprawdza Dockera, uruchamia usługi, czeka na healthchecki i przygotowuje kubełki S3 (pomija je, gdy `S3_ENDPOINT` nie jest lokalny).  |
| `pnpm infra:down`       | Zatrzymuje usługi. Dane zostają w wolumenach.                                                                                         |
| `pnpm infra:logs`       | Logi wszystkich usług na żywo (Ctrl+C kończy).                                                                                        |
| `pnpm infra:reset`      | Zatrzymuje usługi i **usuwa wolumeny**: bazę, kolejki, indeksy, pliki S3 i maile.                                                     |
| `pnpm db:reset`         | Usuwa i tworzy od nowa lokalną bazę, potem `db:migrate` i `db:seed`. Działa tylko dla localhost i poza `NODE_ENV=production`.         |
| `pnpm storage:setup`    | Tworzy brakujące kubełki S3 i regułę CORS. Można uruchamiać wielokrotnie. Działa tylko dla lokalnego S3 i poza `NODE_ENV=production`. |
| `pnpm mail:test`        | Wysyła testowy mail przez SMTP i sprawdza w API Mailpit, że dotarł. Wypisuje link do podglądu.                                        |

Migracje (`db:migrate`) i seed (`db:seed`) definiuje API: `pnpm db:reset` odtwarza bazę z migracji Drizzle z `apps/api/drizzle` (patrz [Baza danych i migracje](#baza-danych-i-migracje)), a seed (`apps/api/src/seed.ts`) zakłada konta testowe z [Szybkiego startu](#szybki-start). Seed jest idempotentny (istniejących kont nie zmienia) i odmawia działania przy `NODE_ENV=production`.

Dla autorów `db:migrate` i `db:seed`: skrypt w pakiecie czyta adres bazy ze zmiennej `DATABASE_URL`. Turborepo 2 działa w trybie strict, więc `turbo.json` przekazuje tym zadaniom `DATABASE_URL` i `NODE_ENV` (`passThroughEnv`). `pnpm db:reset` podaje adres zbudowany z celu sprawdzonego przez bezpiecznik (bez parametrów zapytania), więc zadania łączą się dokładnie z bazą, którą reset odtworzył.

## API (apps/api)

Backend to modularny monolit NestJS na adapterze Fastify ([PROJECT.md §10](docs/PROJECT.md#10-architektura-systemu), [§11.2](docs/PROJECT.md#112-backend)).

### Uruchomienie

```bash
pnpm dev                               # infra:up, potem API, worker i Bull Board w trybie deweloperskim
pnpm --filter @biddy/api dev           # samo API (po pnpm infra:up); restart po każdej zmianie pliku
pnpm --filter @biddy/api dev:worker    # sam worker (joby, konsumenci eventów, relay outboxa)
pnpm --filter @biddy/api dev:board     # sam Bull Board pod http://localhost:3002
```

Na produkcji API i worker to dwa procesy z tego samego buildu: `pnpm --filter @biddy/api start` (`dist/main.js`) i `pnpm --filter @biddy/api start:worker` (`dist/worker.js`).

API czyta zmienne z `.env` w katalogu głównym (tworzy go `pnpm bootstrap`). Baza potrzebuje migracji przed pierwszym startem: `pnpm bootstrap` robi to sam, później wystarczy `pnpm db:reset` albo `pnpm --filter @biddy/api db:migrate`. API importuje zbudowany pakiet `@biddy/shared` (`packages/shared/dist`), więc na świeżym klonie uruchom najpierw `pnpm build`.

Konfigurację sprawdza schemat Zod przy starcie (`apps/api/src/infra/config/config.ts`). Brakująca lub błędna zmienna kończy start kodem 1, a na stderr trafia lista wszystkich złych zmiennych. Dzieje się to, zanim API połączy się z czymkolwiek. Wymagana jest tylko `DATABASE_URL`. Na produkcji także `REDIS_QUEUE_URL`, `REDIS_CACHE_URL`, `RESEND_API_KEY`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_URL`, `MEILI_URL` i `MEILI_API_KEY`, a dla API dodatkowo `CORS_ORIGINS`, `BETTER_AUTH_SECRET`, `API_PUBLIC_URL`, `WEB_URL`, klucze Turnstile i `SMSAPI_TOKEN`. Worker sprawdza te same zmienne, ale nie wymaga tych, których używa tylko API; za to wymaga `WEB_URL`, `WEB_REVALIDATE_SECRET` (rewalidacja stron aukcji, F-18) i `BETTER_AUTH_SECRET` (podpis linków wypisania z e-maili, F-20). Pozostałe zmienne i ich wartości domyślne opisuje sekcja „API” w [`.env.example`](.env.example).

| Adres lokalny                   | Co to jest                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| http://localhost:3001/health    | Liveness: proces działa (`{"status":"ok","release":…}`). Nie sprawdza bazy, więc awaria Postgresa nie restartuje API. |
| http://localhost:3001/ready     | Readiness: baza odpowiada na `select 1`. Inaczej 503 z Problem Details `SERVICE_UNAVAILABLE`.                         |
| http://localhost:3001/docs      | Swagger UI. Domyślnie wyłączone na produkcji (`OPENAPI_ENABLED`).                                                     |
| http://localhost:3001/docs/json | Dokument OpenAPI 3 w JSON, źródło generowanego klienta API (F-05).                                                    |

**Prefiks `/v1`:** wszystkie trasy REST mają prefiks wersji, np. `/v1/auctions` ([PROJECT.md §14.1](docs/PROJECT.md#141-rest-prefiks-v1-openapi-pod-docs)). Bez prefiksu są tylko sondy `/health` i `/ready` oraz dokumentacja `/docs`.

### Błędy: Problem Details (RFC 9457)

Każdy błąd API ma typ treści `application/problem+json` i pole `code` z kodem domenowym. Klient rozpoznaje błąd po `code`, a nie po treści komunikatu. Wspólna lista kodów to `ERROR_CODES` w `packages/shared/src/api/problem-details.ts`. Moduły zgłaszają błędy przez `DomainError({ code, detail })` z `apps/api/src/infra/http`.

Przykład: odpowiedź 400 na dane, które nie przeszły walidacji DTO (nestjs-zod):

```json
{
  "type": "https://biddy.pl/problems/validation-failed",
  "title": "Nieprawidłowe dane",
  "status": 400,
  "detail": "Żądanie zawiera nieprawidłowe dane. Szczegóły są w polu errors.",
  "instance": "/v1/items",
  "code": "VALIDATION_FAILED",
  "requestId": "0199c3a2-5b7e-7c41-9d2f-6a1b2c3d4e5f",
  "errors": [
    {
      "path": "title",
      "code": "too_small",
      "message": "Za mała wartość: oczekiwano, że string będzie mieć >=3 znaków"
    }
  ]
}
```

- `instance` to ścieżka żądania bez parametrów zapytania, `requestId` to identyfikator żądania (patrz niżej).
- `errors` występuje tylko przy `VALIDATION_FAILED`: ścieżka pola, kod Zod i komunikat po polsku.
- Nieznana trasa to 404 `NOT_FOUND` (także nieobsługiwana metoda na istniejącej trasie), zły JSON to 400 `BAD_REQUEST`, adres z błędnym kodowaniem znaków (np. `/v1/%zz`) to 400 `BAD_REQUEST`.
- API przyjmuje tylko JSON. Formularze (`application/x-www-form-urlencoded`), `text/plain` i `multipart/form-data` dostają 415 `UNSUPPORTED_MEDIA_TYPE`. Przeglądarka wysyła takie treści między domenami bez preflightu CORS, więc to także pierwsza linia obrony przed CSRF. Formularz przyjmuje tylko callback Apple Sign In (`/v1/auth/callback/apple`, F-07), który ma parser tylko dla siebie.
- Ten sam format mają błędy z middleware NestJS (np. 401 z middleware uwierzytelniania), razem z nagłówkami CORS, więc przeglądarka może je odczytać.
- Nieoczekiwany błąd to 500 `INTERNAL_ERROR` bez szczegółów. Szczegóły trafiają do logów i Sentry. Pole `debug` (komunikat i stos) pojawia się tylko w development, gdy API słucha na adresie lokalnym (domyślne `API_HOST=127.0.0.1`).

### Logi i request id

- Jeden logger pino dla Fastify, NestJS i modułów. W development czytelny tekst (pino-pretty), poza nim JSON. Zmienne: `LOG_LEVEL` i `LOG_PRETTY`.
- Każde żądanie ma identyfikator. API przyjmuje nagłówek `x-request-id` od klienta lub proxy, jeśli ma bezpieczny format (litery, cyfry i `._:-`, do 128 znaków). W przeciwnym razie generuje UUIDv7.
- Identyfikator wraca w nagłówku `x-request-id` każdej odpowiedzi i w polu `requestId` błędów. Każda linia logu z obsługi żądania ma pole `reqId`, więc błąd zgłoszony przez użytkownika znajdziesz w logach po tym identyfikatorze.
- Sondy `/health` i `/ready` nie są logowane automatycznie. Nagłówki z sekretami (`authorization`, `cookie`) są w logach ukryte, a adres żądania jest logowany bez parametrów zapytania (tokeny z linków weryfikacyjnych, kody OAuth).
- Adres klienta (`remoteAddress` w logach, później limity żądań per IP) za proxy ustala `TRUST_PROXY`: lista adresów IP/CIDR proxy, którym API ufa. Na produkcji domyślnie `loopback,uniquelocal` (load balancer Render w sieci prywatnej). Proxy z publicznymi adresami, np. Cloudflare przed Render, trzeba dopisać do listy. Liczba proxy nie jest obsługiwana: Fastify jej celowo nie stosuje, bo nie sprawdza, kto się łączy.
- Nieobsłużony wyjątek albo odrzucona obietnica bez `.catch()` kończy proces tak samo z Sentry i bez niego: linia `fatal` w logu, łagodne zamknięcie (do 10 s), wyjście z kodem 1 (`apps/api/src/fatal-errors.ts`). Platforma uruchamia instancję od nowa.

### Sentry

- Sentry działa tylko z ustawionym `SENTRY_DSN`. Pusta wartość albo brak zmiennej wyłącza Sentry, lokalnie zwykle niepotrzebne.
- Inicjalizacja jest w `apps/api/src/instrument.ts`, ładowanym przed resztą aplikacji: `pnpm --filter @biddy/api start` uruchamia `node --import ./dist/instrument.js dist/main.js`.
- Do Sentry trafiają tylko błędy serwera (5xx) z tagiem `request_id`. Błędy 4xx i świadome 503 `SERVICE_UNAVAILABLE` (np. z `/ready`) nie trafiają. Sentry nie dostaje danych użytkownika, ciasteczek ani treści żądań (RODO).
- Pozostałe zmienne: `SENTRY_ENVIRONMENT` (domyślnie `NODE_ENV`), `SENTRY_TRACES_SAMPLE_RATE` (domyślnie 0) i `APP_RELEASE` (wersja w Sentry, logach i `/health`).

### Baza danych i migracje

- Drizzle ORM na `pg`. Migracje SQL leżą w `apps/api/drizzle`, generuje je drizzle-kit, a stosuje zadanie `db:migrate` (`apps/api/src/infra/db/migrate.ts`). Pierwsza migracja (`0000_init`) włącza rozszerzenie `ltree`.
- Identyfikatory encji to UUIDv7 generowane w aplikacji (ADR-10): kolumna `idColumn()` i funkcja `newId()` z `apps/api/src/infra/db/ids.ts`.
- Tabele modułu leżą w `src/modules/<moduł>/db/*.schema.ts`, tabele infrastruktury w `src/infra/<nazwa>/db/*.schema.ts` (np. `outbox` i `processed_events`, migracja `0001_outbox`). Każdy taki plik dopisz w `src/infra/db/schema.ts`.
- Moduł wstrzykuje Drizzle tokenem `DRIZZLE` i typuje go własnymi tabelami: `Database<typeof ordersTables>` (z `import * as ordersTables from './db/orders.schema.js'`). Typ nie zna tabel innych modułów, więc `db.query.<cudza tabela>` się nie skompiluje.
- `db:migrate` działa pod blokadą doradczą Postgresa: równoległe uruchomienia (np. nakładające się deploye) czekają na siebie. Przed migracją sprawdza dziennik (`drizzle/meta/_journal.json`), a po niej, czy każda migracja z dziennika ma wpis w bazie.

Zmiana schematu:

```bash
# 1. Zmień tabele w apps/api/src/modules/<moduł>/db/*.schema.ts
pnpm --filter @biddy/api db:generate   # 2. nowa migracja SQL w apps/api/drizzle (przejrzyj ją i commituj)
pnpm format                            #    drizzle-kit zapisuje pliki meta bez formatowania Prettiera
pnpm db:reset                          # 3a. odtwarza lokalną bazę od zera ze wszystkich migracji
pnpm --filter @biddy/api db:migrate    # 3b. albo stosuje tylko nowe migracje na istniejącej bazie
```

Własny SQL (rozszerzenie, funkcja, indeks, którego drizzle-kit nie generuje) dodasz pustą migracją: `pnpm --filter @biddy/api exec drizzle-kit generate --custom --name <nazwa>`. Zastosowanych migracji nie edytuj. Drizzle zapisuje je w tabeli `drizzle.__drizzle_migrations` i drugi raz nie uruchomi, więc każda poprawka to nowa migracja.

Drizzle stosuje tylko migracje z czasem `when` późniejszym niż ostatnio zastosowana. Migracja wygenerowana na gałęzi przed cudzą, a scalona po niej, zostałaby po cichu pominięta. Test jednostkowy i `db:migrate` odrzucają taki dziennik. Wtedy usuń swoją migrację (plik SQL, snapshot i wpis w dzienniku) i wygeneruj ją ponownie na aktualnym `main`.

### Kolejki, workery i outbox

Efekty uboczne (powiadomienia, indeksowanie, maile) i joby z terminem (zamknięcie aukcji, terminy zamówień) działają asynchronicznie w osobnym procesie, workerze ([PROJECT.md §10.4](docs/PROJECT.md#104-procesy-uruchomieniowe), ADR-4). Kod leży w `apps/api/src/infra/queues`, `src/infra/outbox` i `src/infra/worker`.

| Proces                       | Co robi                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| API (`src/main.ts`)          | Zapisuje eventy domenowe w outboxie (w transakcji zmiany) i może dodawać joby (`JobQueues`). Jobów nie wykonuje.                                  |
| Worker (`src/worker.ts`)     | Workery BullMQ dla kolejek z handlerami, konsumenci eventów, joby cykliczne i relay outboxa. Nie startuje, gdy Redis kolejek nie ma `noeviction`. |
| Bull Board (`bull-board.ts`) | Podgląd kolejek w przeglądarce, tylko lokalnie (`127.0.0.1`, odmawia przy `NODE_ENV=production`, bo nie ma logowania).                            |

**Eventy domenowe (transactional outbox).** Event zapisujemy w tej samej transakcji co zmianę, którą opisuje. Wycofana transakcja nie zostawia eventu, zatwierdzona zostawia go na pewno. Relay w workerze przekazuje go do kolejki `domain-events`, osobnym jobem dla każdego konsumenta:

```ts
// Moduł, który publikuje event (definicja eksportowana przez jego index.ts):
export const AuctionEnded = defineDomainEvent({
  type: 'AuctionEnded', // PascalCase, czas przeszły
  version: 1,
  aggregateType: 'auction',
  payload: z.object({ winnerId: z.uuid().nullable() }), // tylko typy JSON
});

await db.transaction(async (tx) => {
  await tx.update(auctions).set({ status: 'ENDED_SOLD' }).where(eq(auctions.id, id));
  await outbox.add(tx, AuctionEnded.create({ aggregateId: id, payload: { winnerId } }));
});

// Moduł, który reaguje (provider w dowolnym module):
@OnDomainEvent(AuctionEnded, { consumer: 'notifications.auction-ended' })
async onAuctionEnded(event: DomainEventOf<typeof AuctionEnded>, { tx }: DomainEventContext) {}
```

- Konsument dostaje event **co najmniej raz**. Worker wykonuje go w transakcji, która najpierw zapisuje parę (konsument, ID eventu) w `processed_events`, więc ponowne dostarczenie nie powtarza efektu w bazie. Efekty poza bazą (mail, SMS) przekazują `event.id` jako klucz idempotencji dostawcy.
- Kolejność dostarczania nie jest gwarantowana. Konsument, dla którego ma znaczenie, porównuje stan encji.
- Metadane eventu (`requestId` żądania HTTP, `causationId` eventu, który go wywołał) `Outbox.add` uzupełnia sam z kontekstu logów.
- Konwencja eventów (nazwy, wersje, payload) jest opisana w `src/infra/outbox/domain-event.ts`.

**Joby.** Handler to metoda providera oznaczona `@JobHandler('kolejka', 'nazwa.joba')`, a job dodaje `JobQueues.add(kolejka, nazwa, dane, { jobId, runAt })`. Kolejki są w katalogu `src/infra/queues/queue-catalog.ts` (nowa kolejka = nowy wpis). Job z terminem dostaje ID z terminem, `deadlineJobId('close', auctionId, endsAt)` → `close-{id}-{ms}` ([PROJECT.md §15.2](docs/PROJECT.md#152-zamykanie-aukcji)): nowy termin to nowy job (także dodany z wnętrza wykonującego się joba), ten sam termin dodany dwa razy to jeden job. Handler musi być idempotentny.

**Joby cykliczne.** `@ScheduledJob({ queue, name, every })` albo `{ pattern: '0 3 * * *' }` (cron, czas polski). Worker przy starcie rejestruje harmonogramy z kodu i usuwa te, których w kodzie już nie ma. Przykład: `outbox.cleanup` co godzinę usuwa przekazane eventy starsze niż 7 dni i wpisy `processed_events` starsze niż 30 dni.

**Ponowienia i dead-letter queue.** Domyślnie 10 prób z wykładniczym odstępem od 2 s (łącznie ok. 17 minut). Job, który wyczerpie próby albo rzuci `UnrecoverableError` z bullmq, trafia jako kopia do kolejki `dead-letter` (oryginał zostaje 14 dni w zbiorze „failed”), a błąd do Sentry z tagami `queue` i `job_name`. Wpis da się ponowić przez `DeadLetterQueue.replay(id)` (panel administracyjny w F-34) albo obejrzeć w Bull Board. Nieudane wykonanie joba cyklicznego nie trafia do DLQ (następne przyjdzie za chwilę), ale trafia do Sentry.

**Logi.** Logi z kodu wykonywanego w jobie mają pola `queue`, `jobId`, `jobName`, `attempt`, a w konsumentach także `consumer`, `eventId`, `eventType` i `requestId` żądania, w którym powstał event. Pole `service` odróżnia procesy: `biddy-api` i `biddy-worker`.

**Redis kolejek.** Osobna instancja z `maxmemory-policy noeviction` (`REDIS_QUEUE_URL`): przy eviction Redis po zapełnieniu pamięci usuwa joby. Worker sprawdza politykę przy starcie i bez `noeviction` kończy się kodem 1. Lokalnie ustawia ją `infra/docker-compose.yml`, na Render trzeba ją wybrać w ustawieniach Key Value. Klucze BullMQ mają prefiks `QUEUE_PREFIX` (domyślnie `biddy`).

### Konta i logowanie (F-07)

Konta, sesje, weryfikacja e-maila, reset hasła i logowanie Google/Apple obsługuje [Better Auth](https://www.better-auth.com) pod `/v1/auth/*` (moduł `identity`, `apps/api/src/modules/identity`). Pełny spec: [F-07](docs/features/F-07-rejestracja-logowanie.md).

- **Sesja:** web dostaje ciasteczko `biddy.session_token` (httpOnly, `SameSite=Lax`, 30 dni, przedłużane raz na dobę), mobile token Bearer z nagłówka `set-auth-token` odpowiedzi logowania. Na produkcji ciasteczko ma wspólną domenę web i API (`AUTH_COOKIE_DOMAIN`).
- **Endpointy Biddy:** `GET /v1/session` (zawsze 200, `{ "user": null }` dla gościa; nagłówek web), `GET /v1/me` (401 bez sesji), `POST /v1/me/terms-acceptances` z `{ "adultDeclaration": true }` (akceptacja regulaminu z oświadczeniem 18+ po pierwszym logowaniu Google/Apple), `GET /v1/auth-options` (dostawcy, klucz Turnstile, minimalna długość hasła).
- **Błędy** Better Auth API zamienia na Problem Details z komunikatem po polsku, np. 401 `INVALID_EMAIL_OR_PASSWORD`. Kody Biddy: `TERMS_NOT_ACCEPTED`, `CAPTCHA_REQUIRED`, `CAPTCHA_FAILED`, `EMAIL_NOT_VERIFIED`, `PHONE_NOT_VERIFIED`, `PHONE_NUMBER_TAKEN`, `PHONE_CODE_INVALID`, `PHONE_CODE_EXPIRED`, `ADDRESS_LIMIT_REACHED`.
- **Ochrona przed botami:** Cloudflare Turnstile (token w nagłówku `x-turnstile-token`) przy rejestracji i resecie hasła, a przy logowaniu po 5 nieudanych próbach na adres e-mail. Od tego progu rośnie też przerwa między próbami (2 s do 5 min, 429 `RATE_LIMITED` z `Retry-After`); próg dla adresu IP to 20. Lokalnie działają klucze testowe Cloudflare (widżet zawsze przechodzi, API sprawdza token bez sieci).
- **CSRF:** żądanie zmieniające stan (POST, PUT, PATCH, DELETE) z ciasteczkiem sesji musi mieć nagłówek `Origin` z listy zaufanych (`CORS_ORIGINS` i `WEB_URL`), inaczej 403. Żądania z tokenem Bearer (mobile) nie mają ciasteczka, więc ich to nie dotyczy.
- **E-maile** idą przez kolejkę `emails` (worker, Resend albo SMTP). Bez działającego workera link weryfikacyjny nie przyjdzie.
- **Profil i adresy (F-10):** `PATCH /v1/me` `{ name }` zmienia imię wyświetlane (2–60 znaków, bez numeru telefonu i adresu strony; reguły w `@biddy/shared`, także przy rejestracji). Trasa Better Auth `/v1/auth/update-user` jest zablokowana. `GET /v1/users/{id}` to profil publiczny bez danych kontaktowych (konto zablokowane: 404). Adresy: `GET/POST /v1/me/addresses`, `PATCH/DELETE /v1/me/addresses/{id}`; najwyżej 10, po jednym domyślnym do dostawy i nadania, kod pocztowy `NN-NNN`. Inne moduły pobierają adresy przez `AddressService` z `modules/identity`. Spec: [F-10](docs/features/F-10-profil-i-adresy.md).
- **Telefon (F-08):** `POST /v1/me/phone-verification` `{ phoneNumber }` wysyła SMS z 6-cyfrowym kodem (tylko polskie numery komórkowe, wymagany potwierdzony e-mail), `POST /v1/me/phone-verification/confirm` `{ code }` przypisuje numer do konta. Jeden numer = jedno konto. Kod ważny 5 minut, 5 prób. Limity wysyłki: kolejny SMS po 60 s, 3 na numer na godzinę, 10 z IP na godzinę, 10 na konto na dobę. SMS-y wysyła SMSAPI (`SMSAPI_TOKEN`), lokalnie atrapa z kodem w logu API. Spec: [F-08](docs/features/F-08-weryfikacja-telefonu.md).

Endpoint wymagający sesji, potwierdzonego e-maila albo konta gotowego do handlu:

```ts
@Controller('auctions')
export class BidsController {
  @Post(':id/bids')
  // 401 bez sesji, potem 403: EMAIL_NOT_VERIFIED, TERMS_NOT_ACCEPTED (brak 18+), PHONE_NOT_VERIFIED
  @RequireVerifiedPhone()
  placeBid(@CurrentUser() user: AuthenticatedUser) {}

  @Post('watched/:id/alerts')
  @RequireVerifiedEmail() // 403 EMAIL_NOT_VERIFIED bez potwierdzonego adresu
  watchAlert(@CurrentUser() user: AuthenticatedUser) {}

  @Get('watched')
  @RequireSession() // wystarczy zalogowanie
  watched(@CurrentUser() user: AuthenticatedUser) {}
}
```

Konto zablokowane (`BANNED`) dostaje 403 `FORBIDDEN` na każdym endpoincie z sesją.

### Kategorie i atrybuty (F-11)

Moduł `catalog` (`apps/api/src/modules/catalog`): drzewo kategorii (`ltree`, ścieżki ze slugów) z atrybutami zależnymi od kategorii. Spec: [F-11](docs/features/F-11-kategorie-i-atrybuty.md).

- **Atrybuty** to definicje w formacie z `@biddy/shared` (`text`, `number`, `select`, `boolean`, z etykietą, wymagalnością, limitami i opcjami), dziedziczone po ścieżce od kategorii głównej. Ta sama funkcja `validateAttributes` sprawdza wartości w API i w formularzu web; z definicji powstaje też JSON Schema.
- **API:** `GET /v1/categories` (aktywne kategorie w kolejności drzewa, z flagami) i `GET /v1/categories/{id}/schema` (atrybuty, flagi, zasady, JSON Schema). Inne moduły walidują atrybuty przedmiotu przez `CategoryService.validateItemAttributes` (przedmiot tylko w aktywnym liściu).
- **Flagi** `is_restricted` (moderacja przed publikacją) i `is_brand_sensitive` (więcej zdjęć) dziedziczą się w dół drzewa.
- **Drzewo** z seeda pochodzi z migracji danych (`drizzle/0006_initial_categories.sql`), więc jest w każdym środowisku. Zmiany kategorii i atrybutów to nowe migracje (do czasu panelu admina, F-34). Przedmioty przechowują atrybuty tak, jak je zapisano: walidacja działa przy zapisie, a wyświetlanie (`describeAttributes`) toleruje zmiany schematu.
- **Web:** `CategoryPicker` i `AttributeFields` (`apps/web/src/components/catalog`) z `attributesSchema` (`src/lib/catalog`) dla kreatora wystawiania (F-14).

### Zdjęcia (F-12)

Moduł `media` (`apps/api/src/modules/media`): upload prosto z przeglądarki do magazynu S3, przetwarzanie w workerze, moderacja i sprzątanie. Spec: [F-12](docs/features/F-12-zdjecia.md).

```
przeglądarka ── POST /v1/media/uploads ──► API: rekord PENDING_UPLOAD + presigned PUT (15 min)
             ── PUT (plik) ──────────────► kubełek uploads: incoming/{właściciel}/{id}
             ── POST /v1/media/{id}/complete ► API: PROCESSING, job media.process (kolejka media)
worker (sharp) ─ format z treści, limit 40 MP, obrót z EXIF, WebP bez metadanych, warianty
             ├─ READY:    warianty w kubełku media (publiczne, niezmienne)
             ├─ FLAGGED:  kopia w uploads/quarantine/, event MediaFlagged (outbox), nic publicznego
             └─ REJECTED: powód po polsku (nie obraz, za małe, za duże)
przeglądarka ── GET /v1/media/{id} co 1 s, aż status przestanie być PROCESSING
```

- **Typy i limity:** JPEG, PNG, WebP do 15 MB (podpisane w presigned PUT: typ i dokładny rozmiar; R2 nie ma presigned POST z limitem). HEIC z iPhone'a Safari zamienia na JPEG przy wyborze pliku. 50 uploadów na konto na godzinę (429).
- **Warianty:** zdjęcie przedmiotu `thumb` 320, `medium` 800, `large` 1600 px (min. 300 px na krótszym boku); zdjęcie profilowe kwadrat `small` 96 i `large` 256 px. Adresy: `MEDIA_PUBLIC_URL/{items|avatars}/{id}/{wariant}.webp`.
- **Moderacja:** adapter `ImageModerator`; atrapa oznacza obrazy prawie w całości czerwone (do testów i ręcznego sprawdzenia). Prawdziwy dostawca przed startem.
- **Przypisanie i sprzątanie:** inne moduły oznaczają zdjęcia jako użyte przez `MediaService.attach` (przedmiot w F-14). Job `media.orphans-cleanup` co godzinę usuwa nieprzypisane zdjęcia starsze niż 24 h (oznaczone przez moderację po 30 dniach) razem z plikami.
- **Zdjęcie profilowe:** `PUT /v1/me/avatar` `{ mediaId }` (zdjęcie `AVATAR` w stanie `READY`) i `DELETE /v1/me/avatar`. Adres trafia do `avatarUrl` w `/v1/me`, `/v1/session` i profilu publicznym.
- **Web:** `PhotoUploader` (`apps/web/src/components/media`: wiele zdjęć, postęp, zdjęcie główne, kolejność, statusy; dla F-14) i `AvatarSettings` na `/konto/profil`. Upload i odpytywanie statusu: `src/lib/media/upload.ts`.

### POK i kroki przebicia (F-13)

Jedna implementacja dla web, mobile i API w `@biddy/shared` (`src/pricing`). Spec: [F-13](docs/features/F-13-pok-i-cenniki.md).

- **`calculatePok(kwota, cennik)`**: Pakiet Ochrony Kupujących = opłata stała + progi krańcowe (startowo 2,99 zł + 7% do 1000 zł + 4% nadwyżki), jedno zaokrąglenie half-up do grosza, rozbicie na netto i VAT. Monotoniczność i brak skoków na granicach progów sprawdzają testy property-based (fast-check).
- **`bidIncrement(cena)` i `minimumNextBid({ startPrice, currentPrice })`**: tabela kroków przebicia z PROJECT.md §6.3. Jest w kodzie, a nie w bazie, bo silnik licytacji przelicza historię ofert od nowa.
- **Cenniki** w tabeli `fee_schedules` (moduł `payments`): wersje z okresem `[valid_from, valid_to)`, w walucie zawsze dokładnie jedna obowiązująca (ograniczenie wykluczające). Wiersz jest niezmienny (trigger), bo zamówienie zapisuje `fee_schedule_id` i przelicza się według niego (`FeeScheduleService.recalculate`). Startowy cennik pochodzi z migracji `0009_initial_fee_schedule`.
- **API:** `GET /v1/fee-schedules/current` (publiczny, cache 60 s). Inne moduły biorą POK z `FeeScheduleService.quote` (razem z `feeScheduleId` do zapisania w zamówieniu).
- **Web:** `TotalPrice` (`apps/web/src/components/pricing`): „Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł” i rozwijane „Skąd ta kwota?”.

**Zmiana stawek** (bez deployu, do czasu panelu admina F-34): zapisz cennik w pliku JSON i uruchom podgląd, a potem to samo z `--confirm`:

```bash
pnpm --filter @biddy/api fees:publish -- --file cennik.json --from 2027-01-01T00:00:00+01:00
```

Plik: `{"currency":"PLN","fixedFee":299,"tiers":[{"upTo":100000,"bp":700},{"upTo":null,"bp":400}],"vatRateBp":2300}` (kwoty w groszach, stawki w punktach bazowych: 700 = 7%). Podgląd pokazuje POK dla przykładowych kwot według bieżącego i nowego cennika. Publikacja zamyka bieżący cennik dokładnie w chwili `--from` (najwcześniej teraz). Na stagingu: powłoka usługi API w Render, `node dist/fees-publish.js --file … --from … --confirm`.

### Wystawianie aukcji (F-14)

Kreator aukcji i model przedmiotu oraz aukcji. Spec: [F-14](docs/features/F-14-kreator-aukcji.md).

- **Moduły:** `catalog` trzyma przedmiot (`items`, `item_media`), `auctions` aukcję i cały proces (`ListingService`), `shipping` przewoźników z gabarytami (`shipping_carriers`, start z migracji `0011_initial_carriers`), `trust-safety` filtr słów, `identity` stan sprzedawcy (`SellerStandingService`: poziom i limity §4.1, KYC, blokada wystawiania, potwierdzenie informacji o KYC). `auctions` woła publiczne API pozostałych modułów w swojej transakcji (`tx`), z blokadą wiersza aukcji.
- **Reguły** w `@biddy/shared` (`validateListing`): zdjęcia 1–20 (4 i marka w kategoriach narażonych na podróbki), kategoria-liść z atrybutami, tytuł 10–80, opis 30–5000 znaków, stan, gabaryt (XL z wymiarami i wagą), przewoźnicy obsługujący gabaryt, cena wywoławcza ≥ 1 zł, minimalna ≥ wywoławczej, Kup teraz ≥ 130% i ≥ minimalnej, czas 1/3/5/7/10 dni, limit wartości aukcji. Te same komunikaty w kreatorze i w API.
- **Statusy:** `DRAFT` → `ACTIVE` albo `PENDING_REVIEW` (kategoria z ograniczeniami, słowo niejednoznaczne; akceptacja w F-35) → `ENDED_*` (F-16) albo `CANCELLED`.
- **API:** `POST /v1/auctions` (szkic), `PATCH /v1/auctions/{id}` (autozapis szkicu; aukcja bez ofert z pełną walidacją), `DELETE` (szkic), `POST …/publish`, `…/cancel`, `…/relist`; odczyt sprzedającego `GET /v1/me/auctions`, `GET /v1/me/auctions/{id}`, `GET /v1/me/selling-limits`; `GET /v1/shipping/carriers`. Eventy: `AuctionPublished`, `AuctionSubmittedForReview`, `AuctionUpdated`, `AuctionCancelled`.
- **Publikacja** wymaga zweryfikowanego telefonu, przy pierwszej publikacji potwierdzenia informacji o weryfikacji tożsamości (zapisanego z datą), braku blokady wystawiania (`LISTING_BLOCKED`) i miejsca w limicie aktywnych aukcji (`LISTING_LIMIT_REACHED`; nowe konto: 5 aukcji, wartość do 5000 zł; powyżej 5000 zł potrzebne KYC). Po pierwszej ofercie aukcji nie da się zmienić (`AUCTION_HAS_BIDS`), a z ofertami nie da się jej anulować w ostatnich 12 h (`AUCTION_CANCEL_TOO_LATE`).
- **Filtr słów** (`apps/api/src/modules/trust-safety/content-filter/listing-terms.ts`): lista startowa z §17. `BLOCK` odrzuca publikację z błędem pola, `REVIEW` kieruje aukcję do moderacji. Zmiana listy to zmiana tego pliku (do czasu konfiguracji moderacji w F-35).
- **Web:** `/wystaw` (szkice, nowa aukcja, limity), `/wystaw/{id}?krok=…` (kreator w 6 krokach z autozapisem po 1 s), `/konto/aukcje` (Moje aukcje: edycja, anulowanie, ponowne wystawienie).

### Silnik licytacji (F-15)

Licytacja automatyczna, Kup teraz, anti-sniping i unieważnianie ofert. Spec: [F-15](docs/features/F-15-silnik-licytacji.md).

- **`resolve(stan, oferta)`** w `@biddy/shared` (`bidding`): czysta funkcja z regułami §6.4 (maksimum, odpowiedź lidera, remis dla wcześniejszej oferty, cena minimalna, podniesienie maksimum bez podnoszenia ceny). `replay` przelicza aukcję od zera. Testy property-based porównują wynik z niezależnie liczonym wzorem.
- **Oferta** (`POST /v1/auctions/{id}/bids` `{ maxAmount }`) to jedna transakcja z blokadą wiersza aukcji; czas z `clock_timestamp()`. Wymaga zweryfikowanego telefonu i nagłówka `Idempotency-Key` (ponowienie zwraca tę samą ofertę z nagłówkiem `idempotent-replayed: true`). Oferty mają numer kolejny w aukcji (`bids.sequence`), więc replay nie zależy od zegara. Klient API przekazuje klucz w `options.headers`.
- **Anti-sniping:** oferta w ostatnich `AUCTION_ANTI_SNIPING_SECONDS` (domyślnie 120 s), która zmieniła cenę albo lidera, przesuwa koniec na teraz + to okno.
- **Limity kupującego** (§4.1, nowe konto): maksimum oferty 500 zł, 10 aukcji z aktywną ofertą (`BID_LIMIT_EXCEEDED`); blokada licytowania `users.bidding_blocked_until` (`BIDDING_BLOCKED`, nadawana w F-61).
- **Kup teraz** (`POST /v1/auctions/{id}/buy-now`): do pierwszej oferty, kończy aukcję jako `ENDED_SOLD` (zamówienie dołoży F-16).
- **Historia** (`GET /v1/auctions/{id}/bids?before=`): po 50, licytujący zanonimizowani („k***a”), bez maksimów.
- **Unieważnienie** (`POST /v1/admin/bids/{id}/cancel`, role `support`, `moderator`, `admin`): oferta i wszystkie automatyczne → `CANCELLED`, replay pozostałych, koniec aukcji bez zmian. Do czasu osobnej sesji panelu admina (F-34) rola pochodzi ze zwykłej sesji (`@RequireStaff`).
- **Eventy:** `BidPlaced`, `UserOutbid`, `AuctionExtended`, `AuctionEnded` (Kup teraz), `BidCancelled`.

### Zamykanie aukcji i zamówienia (F-16)

Każda aukcja kończy się na czas i dokładnie raz. Spec: [F-16](docs/features/F-16-zamykanie-aukcji.md).

- **Planowanie:** konsumenci eventów `auctions.schedule-close` (`AuctionPublished`) i `auctions.reschedule-close` (`AuctionExtended`) dodają opóźniony job `auction.close` w kolejce `auctions` z ID zawierającym termin (`close-{auctionId}-{endsAtMs}`).
- **Zamknięcie** w transakcji z blokadą wiersza aukcji: aukcja nie `ACTIVE` → nic; przed `ends_at` (przedłużona) → job na nowy termin; po `ends_at` → `ENDED_SOLD` (lider i osiągnięta cena minimalna) albo `ENDED_UNSOLD`, event `AuctionEnded`.
- **Sweeper** `auctions.close-sweeper` co 10 s zamyka aukcje spóźnione o ponad 5 s (zaginiony job). W logu: „Sweeper zamknął aukcję”.
- **Zamówienie** (moduł `orders`, `OrderService.createForAuction`) powstaje w tej samej transakcji co zakończenie (także przy Kup teraz): `AWAITING_PAYMENT`, POK według cennika z chwili zakończenia, termin płatności 24 h, snapshot przedmiotu w `order_items.item_snapshot`. Unikalny indeks częściowy `order_items(auction_id) WHERE is_active` gwarantuje jedno aktywne zamówienie na aukcję. Event `OrderCreated`.
- **Moderacja:** `POST /v1/admin/auctions/{id}/cancel` `{ note }` (role `moderator`, `admin`) anuluje aukcję aktywną albo w moderacji, także z ofertami; event `AuctionCancelled` z `cancelledBy: MODERATOR` i uzasadnieniem.

### Realtime (F-17)

Cena, liczba ofert i koniec aukcji aktualizują się na żywo. Spec: [F-17](docs/features/F-17-realtime.md).

- **Serwer:** Socket.IO na serwerze HTTP API pod `/v1/realtime`, tylko transport WebSocket (bez sticky sessions), adapter Redis na instancji cache (`REDIS_CACHE_URL`), więc zdarzenie z dowolnej instancji API albo z workera trafia do wszystkich klientów. Połączenie z przeglądarki tylko z originów `CORS_ORIGINS`; sesja z ciasteczka albo z tokenu Bearer (`auth.token`, mobile). Bez sesji połączenie jest anonimowe.
- **Rooms:** `user:{id}` dołącza serwer przy połączeniu (`user.outbid`, `user.won`); `auction:{id}` klient subskrybuje sam (`auction:subscribe` z UUID aukcji, najwyżej 50 na połączenie): `auction.updated` (z `version`), `auction.extended`, `auction.ended`, `auction.viewers` (F-63). `time:ping` zwraca czas serwera.
- **Oglądający (F-63):** strona aukcji zgłasza `auction:view` (ack `{ ok, viewers }`, najwyżej 5 aukcji na połączenie) i `auction:unview`. API trzyma identyfikatory gniazd w zbiorze posortowanym w Redisie cache (`realtime:viewers:{auctionId}`, wynik to czas potwierdzenia), odnawia je co 30 s, a wpisy bez potwierdzenia przez 90 s (instancja padła) wypadają. `auction.viewers` (`{ auctionId, count }`) idzie do roomu aukcji najwyżej raz na 5 s i tylko po zmianie liczby.
- **Publikacja:** `AuctionLiveEvents` (moduł `auctions`) buduje wiadomości w transakcji oferty, Kup teraz, unieważnienia, zamknięcia i anulowania, a `RealtimePublisher` wysyła je przez Redis zaraz po zatwierdzeniu. Błąd Redisa nie psuje operacji; klient po reconnect dociąga stan przez REST.
- **`@biddy/realtime`** (`packages/realtime`): typy zdarzeń i `createRealtimeClient` (bez Reacta, dla web i Expo): subskrypcje z licznikiem odwołań, ponowna subskrypcja i `onReconnect` po zerwaniu połączenia, synchronizacja zegara (`serverNow()`).
- **Web:** `RealtimeProvider` w `AppProviders` łączy się leniwie (dopiero przy pierwszej subskrypcji, klient ładowany dynamicznym importem). Hooki `useAuctionChannel`, `useAuctionViewers` (F-63), `useUserRealtimeEvents`, `useRealtimeStatus`; zegar z WebSocket zasila `ServerClockProvider`.

### Strona aukcji (F-18)

Strona `/a/{slug}-{publicId}` sprzedaje przedmiot i jest miejscem licytacji. Spec: [F-18](docs/features/F-18-strona-aukcji.md).

- **API:** `GET /v1/auctions/{id}` (UUID albo `publicId`): publiczny widok aukcji z przedmiotem, kategorią, atrybutami, zdjęciami, przewoźnikami i sprzedawcą, bez maksimów i ceny minimalnej. Szkic, aukcja w moderacji i aukcja zablokowanego sprzedawcy: 404. `GET /v1/me/bids/{id}`: stan zalogowanego (prowadzi, maksimum, wynik `WON`/`LOST`/`RESERVE_NOT_MET`, zamówienie zwycięzcy).
- **Adres:** `auctionSlug`, `auctionPath` i `parseAuctionPath` w `@biddy/shared`; stary slug (zmiana tytułu przed pierwszą ofertą) przekierowuje 308 na kanoniczny.
- **ISR:** strona nie czyta ciasteczek, odświeża się co 60 s, a po `AuctionPublished`, `AuctionUpdated`, `BidPlaced`, `BidCancelled`, `AuctionEnded` i `AuctionCancelled` worker planuje job `auction.revalidate-page` (kolejka `web`, okno 5 s w ID joba) i woła `POST {WEB_URL}/api/revalidate` z `WEB_REVALIDATE_SECRET` i tagiem `auction:{publicId}`. Route Handler unieważnia tag z `expire: 0`, więc HTML bez JavaScriptu pokazuje cenę nie starszą niż ok. 10 s. Bez sekretu (lokalnie) rewalidacji nie ma.
- **Panel licytacji** (w przeglądarce): cena, licznik z zegara serwera, końcówka (okno anti-snipingu), oferta z maksimum, ceną łączną z POK i potwierdzeniem (`Idempotency-Key`), Kup teraz, stany gościa, braku telefonu, sprzedającego, wygranej i przegranej. Zdarzenia na żywo (F-17) aktualizują stan według `version`; historia ofert pobiera się w przeglądarce.
- **SEO:** schema.org `Product` z `Offer` (JSON-LD), adres kanoniczny, obrazek OG ze zdjęcia głównego, `noindex` dla anulowanych.

### Wyszukiwarka i przeglądanie (F-19)

Kupujący szuka aukcji z literówkami, filtrami i fasetami. Spec: [F-19](docs/features/F-19-wyszukiwarka.md).

- **Indeks** (moduł `search`, Meilisearch): tylko aktywne aukcje, dokument z §15.5 (tytuł, opis, marka, kategorie, atrybuty, stan, cena, liczba ofert, koniec, zdjęcie). Konsumenci `AuctionPublished`, `AuctionUpdated`, `BidPlaced`, `BidCancelled`, `AuctionEnded` i `AuctionCancelled` planują job `search.index-auction` w kolejce `search` na koniec 5-sekundowego okna (debounce cen); job zapisuje pełny dokument albo go usuwa. Nocny `search.reindex` (3:00) wyrównuje indeks. Ustawienia indeksu (pola wyszukiwania, filtry, sortowania) worker zapisuje przed pierwszym zapisem w procesie.
- **API:** `GET /v1/auctions` z `q`, `category`, `condition`, `priceMin`/`priceMax`, `attr` (`klucz:wartość`, `klucz:od..do`, tylko atrybuty wybranej kategorii), `seller`, `sort` (`relevance`, `ending`, `newest`, `price_asc`, `price_desc`, `bids`) i stronicowaniem; odpowiedź z kartami i fasetami. `GET /v1/sitemap/auctions` dla sitemap. Klient Meilisearch to cienki klient HTTP w `apps/api/src/infra/search` (bez SDK).
- **Web:** strona główna z sekcjami „Kończą się wkrótce” i „Nowe aukcje” oraz kategoriami (ISR 60 s), `/szukaj` (`noindex`) i `/kategoria/{ścieżka}` z filtrami w zwykłym formularzu GET (działa bez JavaScriptu; parametry `q`, `kategoria`, `stan`, `cena_od`, `cena_do`, `a.{klucz}`, `a.{klucz}.od`/`.do`, `sort`, `strona`), paginacją i opisem kolejności wyników (Omnibus). `/sitemap.xml` z kategoriami i aktywnymi aukcjami; profil publiczny pokazuje aktywne aukcje sprzedawcy.
- **Lokalnie:** Meilisearch z `pnpm infra:up` (klucz główny z `.env`). Testy integracyjne uruchamiają własny kontener Meilisearch.

### Obserwowane i powiadomienia (F-20)

Użytkownik nie przegapia ważnych momentów aukcji. Spec: [F-20](docs/features/F-20-obserwowane-powiadomienia.md).

- **Obserwowanie:** `PUT`/`DELETE /v1/me/watchlist/{auctionId}` (tabela `watchlist`, moduł `auctions`; stan w `GET /v1/me/bids/{id}` jako `watching`) i `PUT`/`DELETE`/`GET /v1/me/followed-sellers/{userId}` (tabela `user_follows`, moduł `identity`).
- **Powiadomienia** (moduł `notifications`): `OUTBID`, `ENDING_SOON` (job 1 h przed końcem dla obserwujących i licytujących), `WON` i `SOLD` (z `OrderCreated`), `UNSOLD`, `AUCTION_CANCELLED`, `FOLLOWED_SELLER_NEW_AUCTION`. Konsument eventu zapisuje powiadomienie w transakcji z kluczem deduplikacji (unikalny `(user_id, dedupe_key)`); event `NotificationCreated` dostarcza je po zatwierdzeniu: `notification.new` przez Socket.IO (licznik w dzwonku) i e-mail według preferencji. E-mail o przebiciu najwyżej raz na 15 min na aukcję (`emailed_at`, blokada doradcza).
- **Centrum i preferencje:** `GET /v1/me/notifications`, `GET /v1/me/notifications/summary`, `POST /v1/me/notifications/read`, `GET`/`PUT /v1/me/notification-preferences` (konfigurowalny kanał `EMAIL`; wygrana i sprzedaż zawsze). Web: dzwonek w nagłówku, `/powiadomienia`, `/konto/powiadomienia`, przyciski „Obserwuj” na stronie aukcji i profilu.
- **Wypisanie:** e-maile z powiadomieniami mają `List-Unsubscribe` i `List-Unsubscribe-Post: One-Click` (RFC 8058) z adresem `{WEB_URL}/api/wypisz?token=…` (Route Handler w web woła API, które przyjmuje tylko JSON) i link do `/wypisz?token=…`. Token: HMAC z kluczem wyprowadzonym z `BETTER_AUTH_SECRET`, więc worker na produkcji wymaga tego sekretu.
- **E-maile:** szablony React Email w `packages/emails` (`notificationEmail`, e-maile kont z F-07); HTML i tekst, kolory z design tokens. Lokalnie podgląd w Mailpit (`http://localhost:8025`).

### Moje Biddy (F-21)

Jedno miejsce na licytacje i sprzedaże. Spec: [F-21](docs/features/F-21-moje-biddy.md).

- **API:** `GET /v1/me/bids?status=ACTIVE|WON|LOST` (aukcje z moimi ważnymi ofertami: moje maksimum, czy prowadzę, wynik, zamówienie zwycięzcy; po 24), `GET /v1/me/watchlist` (obserwowane, aktywne najpierw) i `order` przy sprzedanych w `GET /v1/me/auctions`.
- **Web:** `/moje-biddy` z zakładkami Licytuję (filtr prowadzę/przebito, przegrane), Wygrane, Obserwowane, Moje aukcje (`/moje-biddy/aukcje`, dawne `/konto/aukcje` przekierowuje) i Sprzedane. Każda pozycja ma następną akcję (`apps/web/src/lib/my-biddy/next-action.ts`); „Zapłać” i „Nadaj paczkę” są widoczne, ale nieaktywne do F-25 i F-26.
- **Na żywo:** `user.outbid`, `user.won` i `notification.new` odświeżają listy; aktywne aukcje na liście (do 40) subskrybują kanał aukcji i aktualizują cenę bez odświeżania.

### Ledger (F-22)

Księga podwójnego zapisu wszystkich ruchów pieniędzy (moduł `ledger`, plan kont z [PROJECT.md §7.7](docs/PROJECT.md#77-księga-ledger)). Spec: [F-22](docs/features/F-22-ledger.md).

- **Księgowanie przez szablony:** inne moduły wołają `LedgerService.post(tx, posting)` w swojej transakcji, podając zdarzenie z kwotami (`PAYMENT_RECEIVED`, `ORDER_COMPLETED`, `ORDER_REFUNDED`, `NOT_PICKED_UP_REFUNDED`, `ORDER_PARTIALLY_REFUNDED`, `PAYOUT_*`, `DISPUTE_COSTS_CHARGED`, chargebacki, rekompensaty, `CARRIER_CLAIM_SETTLED`, `RECEIVABLE_WRITTEN_OFF`…), a nie wpisy. Szablony są w `apps/api/src/modules/ledger/domain/postings.ts`. Każde księgowanie ma `idempotencyKey`: ponowienie nie dubluje wpisów. Korekta to storno (`LedgerService.reverse`), nigdy edycja.
- **Salda:** `sellerBalances(sellerId)` (dostępne, w trakcie, należność, wypłaty w drodze), `heldForOrder(orderId)`, `balance(konto)`. Uznanie sprzedającego najpierw spłaca `seller_receivable`, obciążenie bierze z salda dostępnego do zera, a niedobór staje się należnością. Błędy: `LedgerError` (`INSUFFICIENT_FUNDS`, `IDEMPOTENCY_CONFLICT`, `ACCOUNT_MISMATCH`…) przerywa transakcję wywołującego.
- **Gwarancje w bazie** (migracja `0015_ledger`): transakcja ma ≥ 2 wpisy sumujące się do zera (trigger przy zatwierdzeniu), `ledger_accounts.balance` zmienia tylko trigger przy wstawieniu wpisu, CHECK nie pozwala saldom użytkowników i zamówień zejść poniżej zera, a UPDATE, DELETE i TRUNCATE na wpisach, transakcjach i kontach są odrzucane.
- **Spójność:** `LedgerIntegrity.verify()` liczy salda od nowa z wpisów; job `ledger.verify-integrity` (kolejka `maintenance`, codziennie o 4:30) kończy się błędem w Sentry, gdy coś się nie zgadza.
- **Testy:** szablony na przykładach z §7.4, property-based niezmienniki w modelu w pamięci (`apps/api/test/support/ledger-model.ts`) i te same losowe sekwencje porównane z Postgresem (`test/integration/ledger.int.test.ts`).

### Płatności: port i FakeGateway (F-23)

Domena rozmawia z operatorem płatności wyłącznie przez port `PaymentGateway` ([PROJECT.md §7.8](docs/PROJECT.md#78-moduł-płatności-adapter)). Do czasu umowy z operatorem działa adapter testowy FakeGateway. Spec: [F-23](docs/features/F-23-port-platnosci.md).

- **Płatność:** `PaymentService.createPayment` (moduł `payments`) zakłada wiersz `PENDING` idempotentny po kluczu wywołującego, woła operatora z kluczem `payment:{id}` i zapisuje wynik. Sprzedający musi mieć konto u operatora (`SellerAccountService.register`).
- **Webhooki:** `POST /v1/webhooks/payments/:provider` (surowe body, podpis adaptera).
  - Każde zdarzenie we własnej transakcji: wpis `processed_webhooks` (duplikat jest pomijany), stan płatności, księgowanie w ledgerze i event `PaymentSucceeded` / `PaymentFailed` / `SellerKycStatusChanged`.
  - Błąd obsługi to 500, a operator ponawia.
- **Polling zapasowy:** job `payments.poll-pending` (kolejka `payments`, co minutę) dociąga przez `getPayment()` płatności w `PENDING` starsze niż 15 minut.
- **FakeGateway lokalnie** (`pnpm dev` + `pnpm dev:worker`): worker rozlicza płatność po `PAYMENTS_FAKE_WEBHOOK_DELAY_MS` (2 s) i wysyła podpisany webhook na API.
  - Kody BLIK: `777123` udana, `111111` odrzucona, `222222` bez odpowiedzi (polling); inny kod jest od razu odrzucony.
  - Karta, przelew i BLIK bez kodu kierują na testową stronę płatności `http://localhost:3000/dev/fake-pay/{id}`.
  - Sprzedawca z `+kyc-pending` albo `+kyc-rejected` w adresie e-mail zaczyna z weryfikacją w toku albo odrzuconą.
- **Panel deweloperski:** `http://localhost:3000/dev/fake-gateway` (po zalogowaniu).
  - Pokazuje płatności, sprzedawców, wypłaty i webhooki ze stanem dostarczenia.
  - Zdarzenia na żądanie: chargeback, odrzucona wypłata, zmiana weryfikacji, ponowny webhook, „rozlicz bez webhooka” (test pollingu).
- **Produkcja:** `DEPLOYMENT_ENV` odróżnia staging od produkcji (oba mają `NODE_ENV=production`).
  - Przy `DEPLOYMENT_ENV=production` (domyślnie przy `NODE_ENV=production`) `PAYMENTS_DEFAULT_PROVIDER` jest wymagany, a `fake` zatrzymuje start z komunikatem.
  - Trasy `/v1/dev/fake-gateway/*` odpowiadają wtedy 404.
  - Staging ma `DEPLOYMENT_ENV=staging` i działa na FakeGateway.
- **Testy kontraktowe:** `describeGatewayContract` w `apps/api/test/support/payment-gateway-contract.ts`; FakeGateway przechodzi go w `test/integration/payments-contract.int.test.ts`. Każdy nowy adapter (F-31) musi przejść ten sam zestaw.

### Dostawy: port, FakeShipping i Furgonetka (F-24)

Domena rozmawia z przewoźnikami wyłącznie przez port `ShippingProvider` ([PROJECT.md §8](docs/PROJECT.md#8-dostawa)). Adaptery to Furgonetka (MVP) i testowy FakeShipping. Spec: [F-24](docs/features/F-24-dostawy.md).

- **Opcje i ceny:**
  - `ShippingQuoteService.options` zwraca usługi zaakceptowane przez sprzedającego, pasujące do gabarytu (XL w limitach wagi, najdłuższego boku i obwodu) i z ceną w cenniku Biddy (`shipping_rates`);
  - strona aukcji pokazuje ceny i „+ dostawa od”;
  - kupujący pobiera opcje zamówienia przez `GET /v1/orders/:id/shipping-options`.
- **Przesyłka:**
  - `ShipmentService.prepare` zapisuje wybór kupującego (`PENDING`; woła go checkout F-25);
  - „Nadaj” to `POST /v1/orders/:id/shipment` (sprzedający, zamówienie `PAID`);
  - job `shipping.create` tworzy przesyłkę u dostawcy z kluczem `shipment:{id}:{próba}` i zapisuje etykietę PDF w prywatnym kubełku;
  - sprzedający dostaje kod nadania albo etykietę (`GET /v1/orders/:id/label`);
  - dane odrzucone przez przewoźnika wracają do formularza.
- **Tracking:**
  - webhook `POST /v1/webhooks/shipping/:provider` jest tylko wskazówką, a job `shipping.sync-tracking` pobiera historię z API dostawcy;
  - polling zapasowy `shipping.poll-tracking` co 10 minut obejmuje przesyłki niesprawdzane od 2 godzin;
  - każda zmiana statusu to event `ShipmentStatusChanged` (przy zwrocie z powodem `NOT_COLLECTED` albo `OTHER`), który konsumuje F-26.
- **FakeShipping lokalnie** (`pnpm dev` + `pnpm dev:worker`): automat dodaje kolejny status co `SHIPPING_FAKE_STEP_DELAY_MS` (20 s) i wysyła podpisany webhook na API, więc cały cykl trwa około 2 minut.
  - Punkty `…-NOPICKUP` i `…-LOST` prowadzą paczkę ścieżką nieodebranej albo zagubionej przesyłki.
  - Telefon nadawcy `500 000 000`: przewoźnik odrzuca dane; `500 000 001`: przewoźnik niedostępny.
- **Panel deweloperski:** `http://localhost:3000/dev/fake-shipping` (po zalogowaniu).
  - Przesyłka testowa bez zamówienia z tym samym formularzem „Nadaj” co strona zamówienia.
  - Następny albo dowolny status, zmiana scenariusza, synchronizacja bez webhooka, etykieta.
- **Strona nadania:** `/zamowienia/{numer}/nadaj` (link z powiadomienia „Opłacono” i z „Moje Biddy → Sprzedane”).
- **Furgonetka:** zmienne `FURGONETKA_*` (komplet albo żadna). Konto loguje się raz, a token z refresh tokenem leży zaszyfrowany w bazie. Bez danych dostępu adapter jest wyłączony, a sandbox ma własne testy kontraktowe (`FURGONETKA_SANDBOX_*`).
- **Produkcja:** przy `DEPLOYMENT_ENV=production` `SHIPPING_DEFAULT_PROVIDER` jest wymagany i różny od `fake`, a trasy `/v1/dev/fake-shipping/*` odpowiadają 404.
- **Testy kontraktowe:** `describeShippingProviderContract` w `apps/api/test/support/shipping-provider-contract.ts`; FakeShipping przechodzi go w `test/integration/shipping-contract.int.test.ts`.

### Kontrakt OpenAPI i klient API (packages/api-client)

Web i mobile nie piszą wywołań API ręcznie. Kontrakt powstaje z kodu API, a klient z kontraktu ([PROJECT.md §11.1](docs/PROJECT.md#111-wspólne)):

```
DTO (nestjs-zod) + @ZodResponse  →  apps/api/openapi.json  →  orval  →  packages/api-client
        pnpm api:generate: openapi:export (apps/api)  +  generate (packages/api-client)
```

- Wejście endpointu opisuje DTO z `createZodDto` (walidacja i OpenAPI), wyjście `@ZodResponse({ type: Dto })`. Odpowiedź przechodzi przez schemat DTO, więc pola spoza kontraktu nie trafiają do klienta, a niezgodność z DTO kończy się błędem 500.
- `operationId` to nazwa metody kontrolera, np. `getServerTime` daje w kliencie funkcję `getServerTime()` i hooki `useGetServerTime()` i `useGetServerTimeSuspense()`. Nazwy metod muszą być unikalne w całym API: powtórzenie przerywa start API z błędem `OpenApiContractError`.
- Każda operacja ma w kontrakcie odpowiedź `default` z `ProblemDetails`, więc błąd w kliencie ma typ `ApiError<ProblemDetails>` z polem `code`.
- Pole tekstowe z `null` zapisuj z formatem albo ograniczeniem: `z.uuid().nullable()`, `z.e164().nullable()`, `z.string().min(1).nullable()`. Samo `z.string().nullable()` nestjs-zod przekazuje do Swaggera tak, że w kliencie wychodzi `string[]`; API odmawia startu z `OpenApiContractError` i wskazuje pole.
- Po zmianie endpointu albo DTO uruchom `pnpm api:generate` i commituj `apps/api/openapi.json` razem z `packages/api-client/src/generated`. Plików wygenerowanych nie edytuj. `pnpm api:check` (w `pnpm check` i w CI) generuje oba w katalogu tymczasowym i porównuje z repozytorium.
- `apps/api/openapi.json` nie zależy od środowiska (stała konfiguracja, wersja z `package.json`), więc w diffie pull requesta widać tylko zmiany kontraktu.

Użycie w aplikacji (web w F-06, mobile w F-37):

```tsx
import { configureApiClient, useGetServerTime } from '@biddy/api-client';

// Raz przy starcie. Web: ciasteczko sesji (credentials: 'include' domyślnie).
configureApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL });
// Mobile: token sesji jako Authorization: Bearer.
configureApiClient({ baseUrl, getAccessToken: () => SecureStore.getItemAsync('session') });

function ServerClock() {
  const { data, error } = useGetServerTime(); // data: ServerTimeDto, error: ApiError<ProblemDetails>
  if (error) {
    return <p>{error.code === 'SERVICE_UNAVAILABLE' ? 'Spróbuj za chwilę' : error.message}</p>;
  }
  return <p>{data?.serverTime}</p>;
}
```

Hooki wymagają `QueryClientProvider` z `@tanstack/react-query` (peer dependency, tak jak `react`). Poza Reactem, np. w Server Components, wołaj wygenerowane funkcje (`await getServerTime({ headers: { cookie } })`) albo przekaż nagłówki przez `configureApiClient({ headers })`. Każdy błąd klienta to `ApiError`: `status` (0, gdy odpowiedź nie dotarła), `code` i `problem` z Problem Details oraz `requestId` do zgłoszenia w supporcie.

### Granice modułów

Moduły domenowe leżą w `apps/api/src/modules/<moduł>/`: 16 modułów z [PROJECT.md §10.3](docs/PROJECT.md#103-moduły-backendu-bounded-contexts). Publiczne API modułu to wyłącznie jego `index.ts`. ESLint (eslint-plugin-boundaries, reguły w `apps/api/eslint.config.js`) zgłasza błąd, gdy:

- moduł importuje wewnętrzny plik innego modułu, np. `../auctions/auctions.module.js` zamiast `../auctions/index.js`,
- moduł importuje pliki aplikacji (`src/*.ts`) albo rejestr modułów (`src/modules/index.ts`),
- infrastruktura (`src/infra/*`) importuje moduły domenowe. Jedyny wyjątek to `src/infra/db/schema.ts`, który zbiera pliki tabel `*.schema.ts`,
- moduł importuje `src/infra/db/schema.ts` (tabele wszystkich modułów),
- dowolny inny plik w `src/` (np. przyszłe `src/common/`) importuje wewnętrzny plik modułu, a nie jego `index.ts`. Reguła obejmuje każdy plik `.ts`, `.mts` i `.cts`, więc nie da się „przemycić” wnętrza modułu przez plik pomocniczy.

Przykładowy komunikat `pnpm lint`:

```
Moduł „orders” importuje wewnętrzny plik modułu „auctions” (../auctions/auctions.module.js). Korzystaj z publicznego API src/modules/auctions/index.ts albo z eventów domenowych (PROJECT.md §10.3).
```

Testy (`*.test.ts` i katalog `test/`) mogą importować wszystko.

### Testy API

| Polecenie                                          | Co sprawdza                                                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @biddy/api test`                    | Testy jednostkowe i testy aplikacji w procesie (`fastify.inject()`). Bez Dockera i bez bazy.                                                                                                              |
| `pnpm test:integration`                            | Testy integracyjne z `apps/api/test/integration`. Testcontainers uruchamia własny Postgres 17, Redis 7.4 i RustFS, stosuje migracje i testuje API oraz worker (także jako osobny proces). Wymaga Dockera. |
| `pnpm --filter @biddy/api-client test`             | Fetcher i wygenerowane hooki w komponencie React (happy-dom), z podmienionym `fetch`.                                                                                                                     |
| `pnpm --filter @biddy/api-client test:integration` | Klient na prawdziwym API (proces `apps/api`) ze strony pod originem web: ścieżki, typy odpowiedzi, Problem Details i CORS. Bez Dockera (uruchamia go też `pnpm test:integration`).                        |

Testy integracyjne nie korzystają z `pnpm infra:up` ani z `.env`. Kontenery znikają po zakończeniu testów. Każdy plik testów workera dostaje własną bazę, a każdy worker własny prefiks kluczy BullMQ, więc pliki działają równolegle.

## Aplikacja web (apps/web)

Next.js 16 (App Router, Server Components, Turbopack), Tailwind CSS 4 i shadcn/ui, teksty przez `next-intl` ([PROJECT.md §11.3](docs/PROJECT.md#113-web-appsweb)). Pełny spec: [F-06](docs/features/F-06-szkielet-web.md).

### Uruchomienie

```bash
pnpm dev                              # razem z API, workerem i Bull Board; web pod http://localhost:3000
pnpm --filter @biddy/web dev          # sama aplikacja web (Turbopack, odświeżanie na żywo)
pnpm build && pnpm --filter @biddy/web start   # wersja produkcyjna lokalnie
```

Web czyta zmienne z `.env` w katalogu głównym (sekcja „Web” w [`.env.example`](.env.example)). Lokalnie nic nie trzeba ustawiać: API to domyślnie http://localhost:3001. Server Components mogą wołać API innym adresem (`API_INTERNAL_URL`, czytany przy starcie, np. sieć prywatna platformy). Zmienne `NEXT_PUBLIC_*` trafiają do kodu przeglądarki przy buildzie, więc ich zmiana wymaga ponownego `pnpm build` (w `pnpm dev` restartu). Błędna wartość przerywa `next build` z listą problemów. `NEXT_PUBLIC_ENVIRONMENT=production` jako jedyne pozwala wyszukiwarkom indeksować stronę.

### Design tokens i style

- Wzorzec wyglądu to **design system Biddy** (F-62): tokeny, komponenty z podglądem, wzorce UX i mapowanie na kod w artefakcie <https://claude.ai/artifact/Hg6ZTSbvwaN5j7GiQD2cPn>; makiety źródłowe w `design/`.
- Kolory, typografia, promienie, cienie i szerokości kontenerów są w [`packages/design-tokens/src/tokens.ts`](packages/design-tokens/src/tokens.ts). Build pakietu generuje z nich `theme.css` dla Tailwinda, a test sprawdza kontrast WCAG AA par tekst/tło.
- Tailwind nie ma domyślnej palety ani fontów: `bg-blue-500` czy `text-red-600` nie dadzą żadnego stylu. Używaj nazw semantycznych (`bg-primary`, `text-foreground-secondary`, `border-input`, `bg-urgent-soft`) albo skal z tokenów (`bg-violet-100`). Test `apps/web/src/design-tokens.test.ts` odrzuca wartości dowolne (`bg-[#fff]`, `text-[13px]`, `font-[…]`), literały kolorów i klasy dawnej palety.
- Typografia: style semantyczne `text-h1`, `text-h3`, `text-title`, `text-body`, `text-body-sm`, `text-caption`, `text-label`, `text-overline` (z `uppercase`), `text-price-xl`, `text-price` (z `tabular-nums`) niosą rozmiar, interlinię i grubość; font Plus Jakarta Sans przez `next/font`. `cn()` zna te nazwy (tailwind-merge rozszerzony o tokeny).
- Role kolorów: gradient `Button variant="cta"` tylko dla jednej głównej akcji widoku, granat (`default`) dla akcji w kartach, fiolet (`brand`) dla zaznaczenia, czerwień (`live`, `urgent`, `destructive`) dla LIVE, pilności i usuwania. Tło stron konta to `bg-canvas` z białymi kartami.
- Komponenty shadcn/ui leżą w `apps/web/src/components/ui`. Nowy komponent: `pnpm dlx shadcn@4.21.2 add <nazwa>` w katalogu `apps/web`, potem `pnpm --filter @biddy/web typecheck` (CLI zdarza się wpisać zły import `cn`; poprawny to `@/lib/utils`) i `pnpm format`.

### Teksty, monitoring, analityka

- Teksty są w `apps/web/messages/pl.json`, a komponenty czytają je przez `useTranslations('sekcja')`. Klucze są typowane: literówka to błąd kompilacji.
- Sentry działa, gdy ustawiony jest `NEXT_PUBLIC_SENTRY_DSN`. W przeglądarce SDK ładuje się osobnym fragmentem JS po starcie strony.
- PostHog startuje dopiero po zgodzie na analitykę: ciasteczko `biddy_consent` z kategorią `analytics` (baner zgód powstanie w F-41). Bez zgody kod PostHog nawet nie trafia do przeglądarki.
- Klient API (`@biddy/api-client`) jest skonfigurowany w layoucie (`src/components/providers/app-providers.tsx`). W Server Components wygenerowane funkcje dostają ciasteczko sesji przez `withSessionCookies()` z `src/lib/api/server.ts`.

### Konta w web

| Strona                   | Co robi                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `/logowanie`             | E-mail i hasło, Google, Apple. Turnstile pojawia się, gdy API go zażąda. Powrót: `?next=`.  |
| `/rejestracja`           | Konto e-mail: regulamin, oświadczenie 18+, Turnstile, potem „Sprawdź skrzynkę”.             |
| `/weryfikacja-email`     | Tu wraca link weryfikacyjny z e-maila (sukces albo link wygasły).                           |
| `/reset-hasla`           | Prośba o link do nowego hasła (Turnstile).                                                  |
| `/nowe-haslo`            | Ustawienie nowego hasła z linku; wylogowuje ze wszystkich urządzeń.                         |
| `/akceptacja-regulaminu` | Regulamin i 18+ po pierwszym logowaniu Google/Apple.                                        |
| `/weryfikacja-telefonu`  | Numer → SMS z kodem → potwierdzenie (wymaga potwierdzonego e-maila). Powrót: `?next=`.      |
| `/konto`                 | Renderowane na serwerze z sesją; bez sesji przekierowuje na logowanie.                      |
| `/konto/profil`          | Zdjęcie profilowe (F-12) i imię wyświetlane (reguły z `@biddy/shared`, te same w API).      |
| `/konto/adresy`          | Adresy dostawy i nadania: dodawanie, edycja, domyślne, usuwanie z potwierdzeniem.           |
| `/konto/aukcje`          | Moje aukcje (F-14): szkice, aktywne, w moderacji, zakończone; edycja, anulowanie, ponownie. |
| `/wystaw`                | Start wystawiania: szkice, nowa aukcja, limity sprzedawcy (F-14).                           |
| `/wystaw/{id}`           | Kreator aukcji w 6 krokach z autozapisem i publikacją (F-14).                               |
| `/u/{id}`                | Profil publiczny (SSR): zdjęcie, imię, data dołączenia, znaczek telefonu; bez kontaktu.     |

Szkielet ładowania (`app/konto/loading.tsx`) jest tylko w segmentach konta. Strony publiczne renderują się w całości przed odpowiedzią, dzięki czemu `notFound()` daje prawdziwe 404 (przy globalnym `loading.tsx` Next wysyła 200, zanim strona się wyrenderuje).

Formularze wołają Better Auth przez `src/lib/auth/auth-api.ts` (zwykłe `apiFetch`, bez klienta Better Auth w paczce), walidacja to Zod i React Hook Form z komunikatami po polsku (`src/lib/auth/schemas.ts`). Nagłówek pokazuje „Moje konto” albo „Zaloguj się” według `GET /v1/session`.

### Testy web

| Polecenie                             | Co sprawdza                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @biddy/web test`       | Vitest i Testing Library: konfiguracja, komponenty layoutu, formularze kont, zegar, zgody, „tylko tokeny”. API podmienia `mockApi()` z `src/test/api.ts`.                                                                |
| `pnpm --filter @biddy/web test:e2e`   | Playwright na zbudowanej aplikacji (`next start`): szerokości 360–1440 px, axe-core (WCAG 2.1 AA), klawiatura, 404, robots.txt, nagłówki, brak PostHog bez zgody, logowanie i rejestracja (z Turnstile), `/konto` z SSR. |
| `pnpm --filter @biddy/web lighthouse` | Lighthouse strony głównej (profil mobilny, mediana z 3 pomiarów), progi 90 dla wydajności i dostępności, raport w `apps/web/.lighthouse/`. Uruchamiany ręcznie.                                                          |

E2E i Lighthouse wymagają wcześniejszego `pnpm build` i przeglądarki: `pnpm --filter @biddy/web exec playwright install chromium`. W e2e przeglądarka rozmawia z API podmienionym przez `page.route` (`e2e/support.ts`, także atrapa skryptu Turnstile), a renderowanie na serwerze z atrapą `e2e/mock-api.ts` (port 3901, `API_INTERNAL_URL`). Prawdziwe API ani sieć nie są potrzebne.

## CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) działa dla każdego pull requesta i każdego pusha do `main`:

- job `checks`: `pnpm build` i `pnpm check` (lint, typecheck, testy jednostkowe, formatowanie, aktualność kontraktu i klienta API),
- job `integration`: `pnpm build` i `pnpm test:integration` (Docker jest na runnerach GitHub z Ubuntu),
- job `api-image`: obraz API z `apps/api/Dockerfile` (ten sam co na Render) i test dymny gotowego obrazu: migracje, `/health`, `/ready` i start workera ([`.github/scripts/smoke-api-image.sh`](.github/scripts/smoke-api-image.sh)),
- job `web`: build aplikacji web i testy e2e w Playwright (Chromium); przy błędzie raport Playwright jako artefakt.

Joby korzystają z cache magazynu pnpm i cache Turborepo (zdalnego, gdy repozytorium ma `TURBO_TOKEN` i `TURBO_TEAM`), a obraz API z cache warstw Docker. Nowy push do pull requesta anuluje poprzedni przebieg.

## Wdrożenia

Staging wdraża się sam z `main`, a każdy pull request ma preview aplikacji web ([docs/deployment.md](docs/deployment.md), F-09):

- **API i worker:** Render ([`render.yaml`](render.yaml)), jeden obraz Docker ([`apps/api/Dockerfile`](apps/api/Dockerfile)). Deploy rusza po zielonym CI na commicie z `main`. Migracje wykonuje krok przed startem nowej wersji; nieudana migracja zatrzymuje deploy, a poprzednia wersja działa dalej.
- **Web:** Vercel ([`apps/web/vercel.json`](apps/web/vercel.json)): `main` to staging (https://staging.biddy.pl), pull requesty to preview na API stagingu.
- **Wersja** w Sentry i w `/health` to SHA commita (`RENDER_GIT_COMMIT`, `VERCEL_GIT_COMMIT_SHA`).

Obraz API lokalnie: `docker build -f apps/api/Dockerfile -t biddy-api .` (z katalogu głównego). Plik [`.pnpmfile.cjs`](.pnpmfile.cjs) usuwa z `better-auth` opcjonalne peery innych frameworków (Next.js, React, Vitest), które inaczej trafiałyby do obrazu.

## Struktura repozytorium

```
biddy/
├─ apps/
│  ├─ web/                 # Next.js: biddy.pl (App Router, Tailwind 4, shadcn/ui, next-intl)
│  │  ├─ src/app/          # strony, layout, 404, błędy, robots.txt, ikona
│  │  ├─ src/components/   # layout, ui (shadcn/ui), dostawcy (TanStack Query, zegar serwera)
│  │  ├─ messages/pl.json  # teksty
│  │  └─ e2e/              # testy Playwright
│  └─ api/                 # backend NestJS (Fastify); później admin i mobile
│     ├─ src/modules/      # 16 modułów domenowych, publiczne API każdego w index.ts
│     ├─ src/infra/        # config, db (Drizzle), http (Problem Details), logger, health, openapi,
│     │                    # queues (BullMQ), outbox (eventy domenowe), worker
│     ├─ src/main.ts       # proces API; src/worker.ts: proces workera; src/bull-board.ts: podgląd kolejek
│     ├─ drizzle/          # migracje SQL (drizzle-kit)
│     ├─ Dockerfile        # obraz API i workera (Render), budowany z katalogu głównego
│     ├─ openapi.json      # kontrakt OpenAPI (pnpm api:generate), źródło klienta API
│     └─ test/             # testy: unit/ (bez Dockera), integration/ (Testcontainers)
├─ packages/
│  ├─ api-client/          # klient API z orval: funkcje, hooki TanStack Query, fetcher (ApiError)
│  ├─ config/              # wspólna konfiguracja: tsconfig, ESLint, Prettier
│  ├─ design-tokens/       # kolory, typografia, promienie → motyw Tailwind 4 (web) i wartości JS (mobile)
│  ├─ emails/              # szablony e-maili w React Email (powiadomienia, konta): HTML i tekst
│  ├─ realtime/            # typy zdarzeń WebSocket i klient Socket.IO z reconnectem i zegarem serwera
│  └─ shared/              # logika współdzielona: Money, POK i kroki przebicia, dni robocze, kody błędów API
├─ infra/
│  ├─ docker-compose.yml   # usługi lokalne: Postgres, 2× Redis, Meilisearch, RustFS, Mailpit
│  └─ scripts/             # bootstrap, env:check, infra:up, storage:setup, db:reset, mail:test
├─ docs/                   # PROJECT.md (specyfikacja), FEATURES.md, features/ (specy), deployment.md
├─ .github/workflows/      # CI (GitHub Actions); scripts/: test dymny obrazu API
├─ render.yaml             # Blueprint Render: staging API, worker, Postgres, Key Value
├─ .env.example            # szablon zmiennych środowiskowych
├─ turbo.json              # zadania Turborepo
└─ pnpm-workspace.yaml     # pakiety workspace i catalog: wspólne wersje narzędzi
```

Docelowa struktura: [PROJECT.md §12](docs/PROJECT.md#12-struktura-repozytorium).

## Rozwiązywanie problemów

**Port jest zajęty** (`address already in use` przy `pnpm infra:up`). Zwykle to lokalnie zainstalowany Postgres albo Redis. Zmień w `.env` zmienną `*_PORT` i ten sam port w powiązanym adresie URL, np.:

```bash
POSTGRES_PORT=5433
DATABASE_URL=postgres://biddy:biddy@localhost:5433/biddy
```

Potem `pnpm env:check` (wykryje niezgodny port) i `pnpm infra:up` (compose odtworzy kontener z nowym portem).

**Docker nie działa.** Uruchom Docker Desktop albo usługę Dockera (`sudo systemctl start docker`). Na Linuksie bez `sudo` dodaj użytkownika do grupy `docker` i zaloguj się ponownie.

**Chcę zacząć od zera albo dane się popsuły.** `pnpm infra:reset` usuwa wszystkie wolumeny (bazę, kolejki, indeksy Meilisearch, pliki w RustFS, maile w Mailpit). Potem `pnpm bootstrap`.

**Zmiana `POSTGRES_USER` albo `POSTGRES_PASSWORD` nie działa.** Postgres tworzy użytkownika tylko przy pierwszym starcie z pustym wolumenem. Po zmianie tych wartości uruchom `pnpm infra:reset` i `pnpm bootstrap`.

**`pnpm db:reset` odmawia działania.** Reset działa tylko wtedy, gdy `DATABASE_URL` wskazuje na `localhost`, `127.0.0.1` albo `::1`, nie zawiera parametrów zmieniających cel połączenia (`?host=`, `?port=`, `?dbname=`, `?user=` i podobnych), a `NODE_ENV` nie jest `production`. To celowe zabezpieczenie przed skasowaniem zdalnej bazy.

**`pnpm storage:setup` odmawia działania albo `pnpm infra:up` pomija kubełki.** Kubełki i reguła CORS powstają tylko w lokalnym RustFS (`S3_ENDPOINT` na `localhost`, `127.0.0.1` albo `::1`) i poza `NODE_ENV=production`. Chroni to kubełki w Cloudflare R2, które używają tych samych nazw zmiennych. Sprawdź, czy w powłoce nie zostały zmienne `S3_*` z innego środowiska (`env | grep S3_`).

**API nie startuje: „Nieprawidłowa konfiguracja API”.** Komunikat wymienia każdą złą zmienną z przyczyną. Popraw je w `.env` (wzór w `.env.example`). Zmienne ustawione w powłoce mają pierwszeństwo przed `.env`, więc sprawdź też `env | grep -E 'DATABASE_URL|API_|LOG_|SENTRY_|REDIS_|QUEUE_|OUTBOX_'`.

**Worker nie startuje: „Redis kolejek (REDIS_QUEUE_URL) ma maxmemory-policy …”.** Instancja Redisa spod `REDIS_QUEUE_URL` ma politykę inną niż `noeviction`, więc mogłaby usuwać joby. Sprawdź, czy adres nie wskazuje na Redis cache (`REDIS_CACHE_URL`, `allkeys-lru`), a na Render ustaw w Key Value „Maxmemory Policy: noeviction”. Gdy worker zgłasza, że Redis nie odpowiedział, uruchom usługi (`pnpm infra:up`).

**Job albo event „utknął”.** Otwórz Bull Board (http://localhost:3002): job z błędem ma w zakładce „Failed” powód i stos, a po wyczerpaniu prób jego kopia leży w kolejce `dead-letter`. Event, który nie dotarł do kolejki, ma w tabeli `outbox` puste `published_at`. Wtedy sprawdź, czy worker działa i czy w jego logach nie ma błędów `Relay outboxa`.

**`/ready` zwraca 503.** API działa, ale nie łączy się z bazą. Uruchom usługi (`pnpm infra:up`) i sprawdź `DATABASE_URL`. Przyczynę zapisuje log `Sonda /ready: baza danych nie odpowiada`.

**`pnpm api:check`: „Klient API jest nieaktualny”.** Kod API (endpoint, DTO, nazwa metody) zmienił się bez regeneracji klienta. Uruchom `pnpm api:generate` i dodaj do commita `apps/api/openapi.json` oraz `packages/api-client/src/generated`. Komunikat wymienia pliki, które się różnią. Generowanie wymaga zbudowanego `@biddy/shared` (`pnpm build`).

**`pnpm test:integration` nie może uruchomić kontenera.** Testy integracyjne potrzebują działającego Dockera (`docker info`). Testcontainers pobiera przy pierwszym uruchomieniu obrazy `postgres:17-alpine`, `redis:7.4-alpine`, `rustfs/rustfs` i `testcontainers/ryuk` (sprząta kontenery po przerwanych testach). Jeśli `testcontainers/ryuk` nie da się pobrać, uruchom testy z `TESTCONTAINERS_RYUK_DISABLED=true`. Kontenery znikają wtedy tylko po normalnym zakończeniu testów.

**Klasa Tailwinda nic nie robi (np. `bg-blue-500`, `font-serif`).** Motyw ma tylko wartości z design tokens. Użyj klasy semantycznej (`bg-primary`) albo dodaj token w `packages/design-tokens/src/tokens.ts` i przebuduj pakiet (`pnpm build`).

**`pnpm --filter @biddy/web test:e2e` nie startuje.** Najpierw `pnpm build` (testy działają na `next start`) i `pnpm --filter @biddy/web exec playwright install chromium`. Port testów to 3100 (`E2E_PORT`).

**Zła wersja Node.** `node -v` powinno pokazać `v24.x`. Przełącz wersję: `nvm use` (albo `fnm use`).

## Wersje narzędzi

- **Node.js 24 LTS:** wersja w `.nvmrc`, zakres w `engines` (`>=24.11 <25`). Skrypty korzystają z API Node 24 (np. `util.parseEnv`). Node 24 ma jeszcze wbudowany corepack.
- **pnpm 10 przez corepack:** wersja przypięta w `packageManager`. Wspólne wersje narzędzi są w `catalog:` w `pnpm-workspace.yaml`, a pakiety odwołują się do nich przez `"catalog:"`.
- **TypeScript 6.0, nie 7.x:** typescript-eslint 8.x wspiera TypeScript < 6.1. TypeScript 7 (natywny kompilator) poczeka, aż typescript-eslint będzie go wspierał. Typed linting (np. `no-floating-promises`) jest dla nas ważniejszy niż szybszy kompilator.
- **Turborepo 2, ESLint 10 (flat config), Prettier 3, Vitest, tsdown** (build pakietów do ESM i CJS). Uzasadnienia: [PROJECT.md §11.1](docs/PROJECT.md#111-wspólne).
