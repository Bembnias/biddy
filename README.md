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
pnpm dev             # uruchamia infrastrukturę (infra:up), potem tryb deweloperski wszystkich pakietów
pnpm infra:down      # zatrzymuje usługi, dane zostają w wolumenach Dockera
pnpm check           # lint, typecheck, testy i formatowanie przed pull requestem
```

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

| Skrypt               | Co robi                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm bootstrap`     | Pierwsze uruchomienie: `.env`, walidacja, usługi, kubełki S3, reset bazy, podsumowanie.                                               |
| `pnpm dev`           | `pnpm infra:up`, a potem `turbo run dev` (tryb deweloperski wszystkich pakietów).                                                     |
| `pnpm build`         | Build wszystkich pakietów i aplikacji (Turborepo z cache).                                                                            |
| `pnpm lint`          | ESLint (flat config, reguły z informacją o typach).                                                                                   |
| `pnpm typecheck`     | `tsc --noEmit` we wszystkich pakietach.                                                                                               |
| `pnpm test`          | Testy jednostkowe (Vitest).                                                                                                           |
| `pnpm check`         | `lint`, `typecheck`, `test` i `format:check` razem.                                                                                   |
| `pnpm format`        | Formatuje repozytorium Prettierem.                                                                                                    |
| `pnpm format:check`  | Sprawdza formatowanie bez zmian w plikach.                                                                                            |
| `pnpm clean`         | Usuwa wyniki buildów i cache.                                                                                                         |
| `pnpm env:check`     | Waliduje zmienne środowiskowe z `.env`.                                                                                               |
| `pnpm infra:up`      | Sprawdza Dockera, uruchamia usługi, czeka na healthchecki i przygotowuje kubełki S3 (pomija je, gdy `S3_ENDPOINT` nie jest lokalny).  |
| `pnpm infra:down`    | Zatrzymuje usługi. Dane zostają w wolumenach.                                                                                         |
| `pnpm infra:logs`    | Logi wszystkich usług na żywo (Ctrl+C kończy).                                                                                        |
| `pnpm infra:reset`   | Zatrzymuje usługi i **usuwa wolumeny**: bazę, kolejki, indeksy, pliki S3 i maile.                                                     |
| `pnpm db:reset`      | Usuwa i tworzy od nowa lokalną bazę, potem `db:migrate` i `db:seed`. Działa tylko dla localhost i poza `NODE_ENV=production`.         |
| `pnpm storage:setup` | Tworzy brakujące kubełki S3 i regułę CORS. Można uruchamiać wielokrotnie. Działa tylko dla lokalnego S3 i poza `NODE_ENV=production`. |
| `pnpm mail:test`     | Wysyła testowy mail przez SMTP i sprawdza w API Mailpit, że dotarł. Wypisuje link do podglądu.                                        |

Migracje i seed (`db:migrate`, `db:seed`) nie są jeszcze zdefiniowane. Pojawią się z backendem (F-03) i kontami użytkowników (F-07). Do tego czasu `pnpm db:reset` tworzy pustą bazę i informuje, że tych zadań jeszcze nie ma.

Dla autorów `db:migrate` i `db:seed`: skrypt w pakiecie czyta adres bazy ze zmiennej `DATABASE_URL`. Turborepo 2 działa w trybie strict, więc `turbo.json` przekazuje tym zadaniom `DATABASE_URL` i `NODE_ENV` (`passThroughEnv`). `pnpm db:reset` podaje adres zbudowany z celu sprawdzonego przez bezpiecznik (bez parametrów zapytania), więc zadania łączą się dokładnie z bazą, którą reset odtworzył.

## Struktura repozytorium

```
biddy/
├─ apps/                   # aplikacje; na razie puste: API (F-03), web (F-06), potem admin i mobile
├─ packages/
│  ├─ config/              # wspólna konfiguracja: tsconfig, ESLint, Prettier
│  └─ shared/              # logika współdzielona: Money (grosze, zaokrąglenia), dni robocze i święta
├─ infra/
│  ├─ docker-compose.yml   # usługi lokalne: Postgres, 2× Redis, Meilisearch, RustFS, Mailpit
│  └─ scripts/             # bootstrap, env:check, infra:up, storage:setup, db:reset, mail:test
├─ docs/                   # PROJECT.md (specyfikacja), FEATURES.md (feature specy)
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

**Zła wersja Node.** `node -v` powinno pokazać `v24.x`. Przełącz wersję: `nvm use` (albo `fnm use`).

## Wersje narzędzi

- **Node.js 24 LTS:** wersja w `.nvmrc`, zakres w `engines` (`>=24.11 <25`). Skrypty korzystają z API Node 24 (np. `util.parseEnv`). Node 24 ma jeszcze wbudowany corepack.
- **pnpm 10 przez corepack:** wersja przypięta w `packageManager`. Wspólne wersje narzędzi są w `catalog:` w `pnpm-workspace.yaml`, a pakiety odwołują się do nich przez `"catalog:"`.
- **TypeScript 6.0, nie 7.x:** typescript-eslint 8.x wspiera TypeScript < 6.1. TypeScript 7 (natywny kompilator) poczeka, aż typescript-eslint będzie go wspierał. Typed linting (np. `no-floating-promises`) jest dla nas ważniejszy niż szybszy kompilator.
- **Turborepo 2, ESLint 10 (flat config), Prettier 3, Vitest, tsdown** (build pakietów do ESM i CJS). Uzasadnienia: [PROJECT.md §11.1](docs/PROJECT.md#111-wspólne).
