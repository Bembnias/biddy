# Biddy

Biddy to marketplace C2C z licytacjami czasowymi. Kupujący płaci za Pakiet Ochrony Kupujących, a Biddy wstrzymuje środki do czasu odbioru przedmiotu, obsługuje dostawę i spory.

- Specyfikacja produktu i architektury: [docs/PROJECT.md](docs/PROJECT.md)
- Lista feature speców z szacunkami i zależnościami: [docs/FEATURES.md](docs/FEATURES.md)

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
pnpm dev               # uruchamia infrastrukturę (infra:up), potem tryb deweloperski wszystkich pakietów
pnpm infra:down        # zatrzymuje usługi, dane zostają w wolumenach Dockera
pnpm check             # lint, typecheck, testy i formatowanie przed pull requestem
pnpm test:integration  # testy integracyjne z Testcontainers (wymaga Dockera)
```

API działa wtedy pod http://localhost:3001 (sonda http://localhost:3001/health, dokumentacja http://localhost:3001/docs). Szczegóły: [API (apps/api)](#api-appsapi).

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

- `biddy-media`: zdjęcia aukcji. Reguła CORS pozwala przeglądarce z `http://localhost:3000` (zmienna `S3_CORS_ORIGINS`) na `PUT`, `GET` i `HEAD`, czyli upload przez presigned URL.
- `biddy-documents`: dokumenty prywatne (etykiety, dowody w sporach, faktury), bez CORS.

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
| `pnpm dev`              | `pnpm infra:up`, a potem `turbo run dev` (tryb deweloperski wszystkich pakietów).                                                     |
| `pnpm build`            | Build wszystkich pakietów i aplikacji (Turborepo z cache).                                                                            |
| `pnpm lint`             | ESLint (flat config, reguły z informacją o typach).                                                                                   |
| `pnpm typecheck`        | `tsc --noEmit` we wszystkich pakietach.                                                                                               |
| `pnpm test`             | Testy jednostkowe (Vitest).                                                                                                           |
| `pnpm test:integration` | Testy integracyjne (Testcontainers): własny Postgres w kontenerze i migracje. Wymaga Dockera, nie wymaga `pnpm infra:up`.             |
| `pnpm check`            | `lint`, `typecheck`, `test` i `format:check` razem.                                                                                   |
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

Migracje (`db:migrate`) definiuje API: `pnpm db:reset` odtwarza bazę z migracji Drizzle z `apps/api/drizzle` (patrz [Baza danych i migracje](#baza-danych-i-migracje)). Seed (`db:seed`) pojawi się z kontami użytkowników (F-07). Do tego czasu `pnpm db:reset` informuje, że tego zadania jeszcze nie ma.

Dla autorów `db:migrate` i `db:seed`: skrypt w pakiecie czyta adres bazy ze zmiennej `DATABASE_URL`. Turborepo 2 działa w trybie strict, więc `turbo.json` przekazuje tym zadaniom `DATABASE_URL` i `NODE_ENV` (`passThroughEnv`). `pnpm db:reset` podaje adres zbudowany z celu sprawdzonego przez bezpiecznik (bez parametrów zapytania), więc zadania łączą się dokładnie z bazą, którą reset odtworzył.

## API (apps/api)

Backend to modularny monolit NestJS na adapterze Fastify ([PROJECT.md §10](docs/PROJECT.md#10-architektura-systemu), [§11.2](docs/PROJECT.md#112-backend)).

### Uruchomienie

```bash
pnpm dev                        # infra:up, potem tryb deweloperski wszystkich pakietów, w tym API
pnpm --filter @biddy/api dev    # samo API (po pnpm infra:up); restart po każdej zmianie pliku
```

API czyta zmienne z `.env` w katalogu głównym (tworzy go `pnpm bootstrap`). Baza potrzebuje migracji przed pierwszym startem: `pnpm bootstrap` robi to sam, później wystarczy `pnpm db:reset` albo `pnpm --filter @biddy/api db:migrate`. API importuje zbudowany pakiet `@biddy/shared` (`packages/shared/dist`), więc na świeżym klonie uruchom najpierw `pnpm build`.

Konfigurację sprawdza schemat Zod przy starcie (`apps/api/src/infra/config/config.ts`). Brakująca lub błędna zmienna kończy start kodem 1, a na stderr trafia lista wszystkich złych zmiennych. Dzieje się to, zanim API połączy się z czymkolwiek. Wymagana jest tylko `DATABASE_URL` (na produkcji także `CORS_ORIGINS`). Pozostałe zmienne i ich wartości domyślne opisuje sekcja „API” w [`.env.example`](.env.example).

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
- API przyjmuje tylko JSON. Formularze (`application/x-www-form-urlencoded`), `text/plain` i `multipart/form-data` dostają 415 `UNSUPPORTED_MEDIA_TYPE`. Przeglądarka wysyła takie treści między domenami bez preflightu CORS, więc to także pierwsza linia obrony przed CSRF. Trasa, która potrzebuje formularza (callback Apple Sign In, F-07), zarejestruje parser tylko dla siebie.
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
- Tabele modułu leżą w `src/modules/<moduł>/db/*.schema.ts`. Każdy taki plik dopisz w `src/infra/db/schema.ts`.
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

| Polecenie                       | Co sprawdza                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @biddy/api test` | Testy jednostkowe i testy aplikacji w procesie (`fastify.inject()`). Bez Dockera i bez bazy.                                                                       |
| `pnpm test:integration`         | Testy integracyjne z `apps/api/test/integration`. Testcontainers uruchamia własny Postgres 17, stosuje migracje i testuje API na prawdziwej bazie. Wymaga Dockera. |

Testy integracyjne nie korzystają z `pnpm infra:up` ani z `.env`. Kontener z bazą znika po zakończeniu testów.

## CI

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) działa dla każdego pull requesta i każdego pusha do `main`:

- job `checks`: `pnpm build` i `pnpm check` (lint, typecheck, testy jednostkowe, formatowanie),
- job `integration`: `pnpm build` i `pnpm test:integration` (Docker jest na runnerach GitHub z Ubuntu).

Oba joby korzystają z cache magazynu pnpm i cache Turborepo. Nowy push do pull requesta anuluje poprzedni przebieg. Wdrożenia (staging, preview, migracje przed deployem) dojdą w F-09.

## Struktura repozytorium

```
biddy/
├─ apps/
│  └─ api/                 # backend NestJS (Fastify); później web (F-06), admin i mobile
│     ├─ src/modules/      # 16 modułów domenowych, publiczne API każdego w index.ts
│     ├─ src/infra/        # config, db (Drizzle), http (Problem Details), logger, health, openapi
│     ├─ drizzle/          # migracje SQL (drizzle-kit)
│     └─ test/             # testy: unit/ (bez Dockera), integration/ (Testcontainers)
├─ packages/
│  ├─ config/              # wspólna konfiguracja: tsconfig, ESLint, Prettier
│  └─ shared/              # logika współdzielona: Money, dni robocze i święta, kody błędów API
├─ infra/
│  ├─ docker-compose.yml   # usługi lokalne: Postgres, 2× Redis, Meilisearch, RustFS, Mailpit
│  └─ scripts/             # bootstrap, env:check, infra:up, storage:setup, db:reset, mail:test
├─ docs/                   # PROJECT.md (specyfikacja), FEATURES.md (feature specy)
├─ .github/workflows/      # CI (GitHub Actions)
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

**API nie startuje: „Nieprawidłowa konfiguracja API”.** Komunikat wymienia każdą złą zmienną z przyczyną. Popraw je w `.env` (wzór w `.env.example`). Zmienne ustawione w powłoce mają pierwszeństwo przed `.env`, więc sprawdź też `env | grep -E 'DATABASE_URL|API_|LOG_|SENTRY_'`.

**`/ready` zwraca 503.** API działa, ale nie łączy się z bazą. Uruchom usługi (`pnpm infra:up`) i sprawdź `DATABASE_URL`. Przyczynę zapisuje log `Sonda /ready: baza danych nie odpowiada`.

**`pnpm test:integration` nie może uruchomić kontenera.** Testy integracyjne potrzebują działającego Dockera (`docker info`). Testcontainers pobiera przy pierwszym uruchomieniu obrazy `postgres:17-alpine` i `testcontainers/ryuk` (sprząta kontenery po przerwanych testach). Jeśli `testcontainers/ryuk` nie da się pobrać, uruchom testy z `TESTCONTAINERS_RYUK_DISABLED=true`. Kontener z bazą znika wtedy tylko po normalnym zakończeniu testów.

**Zła wersja Node.** `node -v` powinno pokazać `v24.x`. Przełącz wersję: `nvm use` (albo `fnm use`).

## Wersje narzędzi

- **Node.js 24 LTS:** wersja w `.nvmrc`, zakres w `engines` (`>=24.11 <25`). Skrypty korzystają z API Node 24 (np. `util.parseEnv`). Node 24 ma jeszcze wbudowany corepack.
- **pnpm 10 przez corepack:** wersja przypięta w `packageManager`. Wspólne wersje narzędzi są w `catalog:` w `pnpm-workspace.yaml`, a pakiety odwołują się do nich przez `"catalog:"`.
- **TypeScript 6.0, nie 7.x:** typescript-eslint 8.x wspiera TypeScript < 6.1. TypeScript 7 (natywny kompilator) poczeka, aż typescript-eslint będzie go wspierał. Typed linting (np. `no-floating-promises`) jest dla nas ważniejszy niż szybszy kompilator.
- **Turborepo 2, ESLint 10 (flat config), Prettier 3, Vitest, tsdown** (build pakietów do ESM i CJS). Uzasadnienia: [PROJECT.md §11.1](docs/PROJECT.md#111-wspólne).
