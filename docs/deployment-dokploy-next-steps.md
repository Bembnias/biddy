# Staging na Dokploy: kolejne kroki po scaleniu PR

Ten dokument prowadzi od stanu „kroki 1–5 zrobione, kod na `main`” do działającego https://staging.biddy.pl wdrażanego automatycznie po każdym zielonym CI. Uzupełnia [deployment-dokploy.md](deployment-dokploy.md) (tam jest uzasadnienie, architektura i rozwiązywanie problemów); tutaj jest tylko kolejność prac i dokładne polecenia.

Numeracja poniżej jest własna. Odwołania do tamtego dokumentu mają postać „tamten dokument, krok N”.

Nazwy przycisków w panelach Dokploy, Cloudflare, Resend i SMSAPI zmieniają się między wersjami. Jeśli czegoś nie ma pod podaną ścieżką, szukaj podobnej nazwy w tej samej sekcji panelu.

## Stan wyjściowy (2026-11-02)

| Co | Stan |
| --- | --- |
| Serwer Oracle, Dokploy, backup Dokploy do R2, baza Postgres z backupem | zrobione (tamten dokument, kroki 1–5) |
| Kod na `main` | tak, commit `a2a297e` (PR #2) |
| CI na `main` | zielone |
| Workflow „Deploy (Dokploy)” po merge'u | **pominięty (`skipped`)**. To oczekiwane: zmienna `DOKPLOY_ENABLED` jeszcze nie istnieje. |
| Zmienne i sekrety GitHub (`DOKPLOY_*`, środowisko `staging`) | brak |
| Usługa Compose w Dokploy | brak |
| Rekordy DNS `staging` i `api.staging` | do sprawdzenia (krok 1) |

Nic jeszcze nie jest wdrożone, więc nic nie trzeba cofać ani sprzątać po wcześniejszych próbach.

## Przegląd kroków

| Krok | Co | Gdzie | Orientacyjny czas |
| --- | --- | --- | --- |
| 1 | Rekordy DNS `staging` i `api.staging` | OVH | 5 min + czekanie na DNS |
| 2 | Konta i klucze: Resend, Turnstile, SMSAPI | Resend, Cloudflare, SMSAPI | 30–60 min (weryfikacja domeny w Resend bywa najdłuższa) |
| 3 | Kubełki R2 aplikacji i token | Cloudflare R2 | 15 min |
| 4 | Sekrety i arkusz wartości | terminal, menedżer haseł | 10 min |
| 5 | Usługa Compose `biddy-staging` | Dokploy | 15 min |
| 6 | Klucz API Dokploy | Dokploy | 3 min |
| 7 | Środowisko `staging` w GitHubie | GitHub | 10 min |
| 8 | Pierwsze wdrożenie | GitHub Actions | 15–25 min |
| 9 | Weryfikacja techniczna | terminal, Dokploy | 10 min |
| 10 | Test dymny aplikacji | przeglądarka | 30–45 min |
| 11 | Porządki po pierwszym wdrożeniu | różne | 30 min, może poczekać |

Kolejność ma znaczenie. DNS idzie pierwszy, bo propaguje się w tle, a Resend potrzebuje DNS do weryfikacji domeny. Zmienną `DOKPLOY_ENABLED` ustawiasz dopiero w kroku 8, bo od tej chwili każdy zielony push na `main` wdraża się sam.

Całość to około 2–3 godzin pracy, z czego sporo to czekanie na DNS i weryfikacje.

## Krok 1. DNS

**Cel:** `staging.biddy.pl` i `api.staging.biddy.pl` wskazują na serwer, zanim Traefik zacznie prosić Let's Encrypt o certyfikaty. Kilka nieudanych weryfikacji z rzędu blokuje wydawanie certyfikatu dla tej nazwy na około godzinę, więc DNS musi być gotowy przed pierwszym wdrożeniem.

1. Sprawdź, co jest teraz (adres `IP_SERWERA` to publiczny IP instancji z Oracle Cloud → Compute → Instances):

   ```bash
   dig +short dokploy.biddy.pl @1.1.1.1
   dig +short staging.biddy.pl @1.1.1.1
   dig +short api.staging.biddy.pl @1.1.1.1
   dig +short AAAA staging.biddy.pl @1.1.1.1
   dig +short AAAA api.staging.biddy.pl @1.1.1.1
   ```

   Pierwsze trzy mają zwrócić `IP_SERWERA`. Dwa ostatnie (`AAAA`) mają być puste albo wskazywać ten sam serwer.

2. Jeśli którejś nazwy brakuje: panel OVH → Domeny → `biddy.pl` → **Strefa DNS → Dodaj wpis** → rodzaj `A`, subdomena `staging` (bez `.biddy.pl`), cel `IP_SERWERA`, TTL domyślne. To samo dla `api.staging`.

3. Jeśli te nazwy już istnieją i wskazują gdzie indziej (typowo `CNAME` na Vercel albo Render z poprzedniego stagingu), zastąp je rekordami `A`. Na tę samą nazwę nie może być jednocześnie `CNAME` i `A`. **To przełącza istniejący staging na nowy serwer**, więc rób to dopiero wtedy, gdy stary staging nie jest już potrzebny. Rekordy `AAAA` na inny serwer usuń, bo przeglądarki preferują IPv6.

4. Czekaj, aż odpowiedzi są poprawne najpierw na serwerze DNS OVH, potem publicznie. Serwer nazw strefy sprawdzisz tak:

   ```bash
   dig +short NS biddy.pl
   dig +short staging.biddy.pl @dns103.ovh.net
   ```

   (zamiast `dns103.ovh.net` użyj jednego z serwerów zwróconych przez pierwsze polecenie). Potem powtórz polecenia z punktu 1.

**Punkt kontrolny:** `staging.biddy.pl` i `api.staging.biddy.pl` zwracają `IP_SERWERA` zarówno z `@1.1.1.1`, jak i z serwera OVH.

## Krok 2. Konta i klucze usług zewnętrznych

**Cel:** zebrać wartości, bez których stos się nie uruchomi albo nie da się przetestować aplikacji. Wszystkie klucze zapisuj od razu w menedżerze haseł; do repozytorium nie trafia żaden z nich.

| Usługa | Czy wymagana | Do czego | Zmienne |
| --- | --- | --- | --- |
| Resend | **tak** (Compose przerywa deploy bez klucza) | e-maile: potwierdzenie konta, reset hasła, powiadomienia | `RESEND_API_KEY`, `MAIL_FROM` |
| Cloudflare Turnstile | **tak** | CAPTCHA przy rejestracji, logowaniu i resecie hasła | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| SMSAPI | token **albo** `SMS_LOG_ONLY=true` (kod w logu API, bez wysyłki) | SMS z kodem weryfikacji telefonu | `SMSAPI_TOKEN`, `SMS_LOG_ONLY` |
| Sentry | nie | raportowanie błędów | `SENTRY_DSN` (zostaw puste) |
| Google, Apple (logowanie) | nie | logowanie społecznościowe | `GOOGLE_*`, `APPLE_*` (zostaw puste) |
| PostHog | nie | analityka | `NEXT_PUBLIC_POSTHOG_KEY` (zostaw puste) |

Sentry, PostHog i logowanie społecznościowe można dodać później. Zmiana `SENTRY_DSN` to zmiana zmiennej w Dokploy i redeploy; zmiana zmiennych `NEXT_PUBLIC_*` wymaga ponownego zbudowania obrazu web (czyli uruchomienia workflow).

### 2.1 Resend

1. [resend.com](https://resend.com) → **Domains → Add Domain** → `staging.biddy.pl` (region UE, jeśli jest do wyboru).
2. Resend pokaże rekordy DNS do dodania (zwykle MX i TXT dla SPF oraz TXT dla DKIM). Dodaj **dokładnie** takie, jak podane, w OVH: **Strefa DNS → Dodaj wpis**, w polu subdomeny wpisz nazwę bez `.biddy.pl` (nazwy będą zawierały `.staging`). Istniejących wpisów poczty `biddy.pl` nie ruszaj.
3. W Resend kliknij **Verify**. Status `Verified` bywa kwestią minut, a czasem godzin. Bez niego Resend odrzuci wysyłkę z adresu w tej domenie.
4. **API Keys → Create API Key**: uprawnienie „Sending access” ograniczone do domeny `staging.biddy.pl`. Skopiuj klucz (widać go tylko raz): to `RESEND_API_KEY`.
5. `MAIL_FROM` ma adres w zweryfikowanej domenie: `Biddy Staging <no-reply@staging.biddy.pl>`.

### 2.2 Cloudflare Turnstile

1. Cloudflare → **Turnstile → Add widget**: nazwa `biddy-staging`, **Hostname** `staging.biddy.pl`, tryb **Managed**.
2. Skopiuj **Site Key** (`TURNSTILE_SITE_KEY`) i **Secret Key** (`TURNSTILE_SECRET_KEY`).

Skrót na pierwsze wdrożenie: Cloudflare publikuje klucze testowe, które zawsze przechodzą (`1x00000000000000000000AA` jako klucz witryny i `1x0000000000000000000000000000000AA` jako klucz tajny). API wystartuje z nimi, ale CAPTCHA przestaje wtedy chronić przed botami. Użyj ich tylko, jeśli prawdziwy widżet blokuje Cię w tej chwili, i wymień na prawdziwe w kroku 11.

Klucz witryny web pobiera z API w czasie działania, więc nie wchodzi do obrazu web i nie trzeba go dodawać w GitHubie.

### 2.3 SMSAPI

Licytować i wystawiać może tylko konto ze zweryfikowanym numerem telefonu ([F-08](features/F-08-weryfikacja-telefonu.md)), więc bez działających SMS-ów nie sprawdzisz licytacji ani wystawiania. Do czasu aktywacji konta w SMSAPI użyj atrapy z kodem w logu (niżej, „Atrapa do czasu aktywacji konta”).

1. Załóż konto na [smsapi.pl](https://www.smsapi.pl) i doładuj je minimalną kwotą (SMS-y są płatne; cennik sprawdź u dostawcy).
2. W panelu wygeneruj token API (OAuth) z uprawnieniem do wysyłki SMS. To `SMSAPI_TOKEN`.
3. **Filtr IP.** Panel zaproponuje ograniczenie użycia API do wskazanych adresów („Dodaj filtr IP”). Dodaj `IP_SERWERA` (publiczny IPv4 maszyny z Oracle Cloud). Wtedy wyciek tokenu nie pozwala nikomu wysyłać SMS-ów na Twój koszt z innego miejsca. Adres, z którego SMSAPI zobaczy żądania, sprawdzisz na serwerze poleceniem `curl -4 -s https://api.ipify.org`; ma zwrócić `IP_SERWERA`. Dwie konsekwencje: próba użycia tokenu z własnego komputera zostanie odrzucona (to zamierzone), a po utworzeniu instancji od nowa (nowy adres) trzeba zaktualizować filtr, bo inaczej wysyłka kodu zwróci błąd 503.
4. `SMSAPI_SENDER` zostaw puste. Własna nazwa nadawcy wymaga rejestracji w SMSAPI; do tego czasu SMS-y idą z nadawcy domyślnego.

Co warto wiedzieć przed testami (z opisu F-08):

- działają tylko polskie numery komórkowe (`+48`),
- jeden numer to jedno konto, więc test z dwoma kontami (kupujący i sprzedający) wymaga dwóch numerów,
- limity: kolejny SMS dla konta najwcześniej po 60 s, maks. 3 SMS-y na numer na godzinę.

**Atrapa do czasu aktywacji konta.** Konto SMSAPI, które nie jest jeszcze aktywne, odrzuca SMS-y z kodem błędu 94 (`Not allowed to send messages with link`): linia `@staging.biddy.pl #kod` w treści wygląda dla SMSAPI jak link. W tym czasie ustaw w Environment `SMS_LOG_ONLY=true`. API nie wysyła wtedy SMS-a, tylko zapisuje go w logu (Dokploy → Logs → `api`, szukaj `SMS (atrapa)`), a token może zostać pusty. Kod weryfikacyjny skopiuj z tej linii i wpisz na stronie. Po aktywacji konta ustaw `SMS_LOG_ONLY=false` (albo usuń zmienną), wpisz prawdziwy `SMSAPI_TOKEN` i zrób Deploy. Opcja jest dostępna dopiero po wdrożeniu commita, który ją wprowadza; na produkcji konfiguracja ją odrzuca.

**Punkt kontrolny:** masz zapisane `RESEND_API_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` i `SMSAPI_TOKEN` (albo decyzję o `SMS_LOG_ONLY=true`); domena w Resend ma status `Verified` (albo wiesz, że czeka na DNS).

## Krok 3. Kubełki R2 aplikacji

**Cel:** miejsce na zdjęcia. Kubełki aplikacji są osobne od kubełka backupów (`biddy-backups`) i mają osobny token: wyciek klucza aplikacji nie daje dostępu do backupów. Szczegóły i uzasadnienie: [deployment.md, „Cloudflare R2”](deployment.md#cloudflare-r2-pliki).

1. Cloudflare → **R2 → Create bucket**, dwa razy, z lokalizacją w jurysdykcji **EU**:
   - `biddy-staging-uploads` (prywatny: oryginały zdjęć przed przetworzeniem),
   - `biddy-staging-media` (przetworzone zdjęcia, publiczne).

   Kubełek `biddy-staging-documents` z dokumentu o R2 jest przeznaczony na etykiety i dowody w sporach; konfiguracja API nie czyta jeszcze jego nazwy, więc pomiń go na razie.

2. **`biddy-staging-uploads` → Settings → CORS Policy → Add**: przeglądarka wysyła zdjęcie bezpośrednio do R2 (żądanie `PUT`), więc bez tej reguły upload kończy się błędem CORS.

   ```json
   [
     {
       "AllowedOrigins": ["https://staging.biddy.pl"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. **`biddy-staging-uploads` → Settings → Object lifecycle rules → Add**: prefiks `incoming/`, usuwanie po 2 dniach (zabezpieczenie przed porzuconymi uploadami).

4. **`biddy-staging-media` → Settings → Public Development URL → Enable** (Cloudflare poprosi o wpisanie potwierdzenia). Skopiuj adres `https://pub-….r2.dev` **bez ukośnika na końcu**: to `MEDIA_PUBLIC_URL`.

   Dlaczego `r2.dev`, a nie `media.staging.biddy.pl`: własna domena kubełka działa tylko dla domeny, której strefa DNS jest w Cloudflare, a `biddy.pl` jest w OVH. Cloudflare ogranicza przepustowość `r2.dev` i nie cache'uje go w CDN, co wystarcza na staging, ale nie na produkcję ([tamten dokument, krok 8](deployment-dokploy.md#zdjęcia-z-r2-a-dns-w-ovh)).

5. **R2 → Manage API tokens → Create API token**: uprawnienie **Object Read & Write**, zakres **Apply to specific buckets only** z dwoma kubełkami: `biddy-staging-uploads` i `biddy-staging-media`.
   - **TTL** zostaw `Forever`. Token z terminem wygaśnięcia po prostu przestałby działać, a upload zdjęć by się zepsuł.
   - **Client IP Address Filtering** zostaw puste (inaczej niż filtr IP w SMSAPI). Przeglądarki wysyłają zdjęcia bezpośrednio do R2 pod podpisanymi adresami, więc żądania nie pochodzą z adresu serwera, a filtr mógłby je odrzucić.
   - Po **Create Account API Token** skopiuj od razu **Access Key ID** i **Secret Access Key** (sekret widać tylko raz). Pole „Token value” nie jest potrzebne.

6. Endpoint S3 to `https://ID_KONTA.eu.r2.cloudflarestorage.com`. Identyfikator konta (Account ID) jest na stronie głównej R2 w panelu Cloudflare.

**Punkt kontrolny:** masz zapisane `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` i `MEDIA_PUBLIC_URL`; nazwy kubełków to `biddy-staging-media` i `biddy-staging-uploads`.

## Krok 4. Sekrety i arkusz wartości

**Cel:** mieć w jednym miejscu wszystko, co za chwilę wkleisz do Dokploy.

1. Wygeneruj trzy sekrety aplikacji (lokalnie w terminalu) i od razu zapisz w menedżerze haseł:

   ```bash
   for name in BETTER_AUTH_SECRET WEB_REVALIDATE_SECRET MEILI_MASTER_KEY; do
     echo "$name=$(openssl rand -base64 32)"
   done
   ```

   - `BETTER_AUTH_SECRET`: podpis sesji (API i worker używają tego samego). Późniejsza zmiana wylogowuje wszystkich i unieważnia linki wypisania z e-maili.
   - `WEB_REVALIDATE_SECRET`: sekret, którym worker odświeża strony aukcji w web (ta sama wartość w web i workerze, Compose przekazuje ją obu).
   - `MEILI_MASTER_KEY`: klucz główny wyszukiwarki, wymagane co najmniej 16 znaków.

2. Skopiuj `DATABASE_URL`: Dokploy → Projects → Biddy → `biddy-postgres` → **Internal Connection URL**. Ma postać `postgresql://biddy:…@biddy-postgres-xxxxxx:5432/biddy`. Hasło nie może zawierać znaków `$`, `@`, `:` ani `/`: `$` Compose próbowałby interpretować jako zmienną, a pozostałe psują adres.

3. Arkusz (uzupełnij, zanim przejdziesz do kroku 5):

   | Zmienna | Skąd | Wartość |
   | --- | --- | --- |
   | `DATABASE_URL` | punkt 2 | |
   | `BETTER_AUTH_SECRET` | punkt 1 | |
   | `WEB_REVALIDATE_SECRET` | punkt 1 | |
   | `MEILI_MASTER_KEY` | punkt 1 | |
   | `S3_ENDPOINT` | krok 3 | |
   | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | krok 3 | |
   | `MEDIA_PUBLIC_URL` | krok 3 | |
   | `RESEND_API_KEY` | krok 2.1 | |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | krok 2.2 | |
   | `SMSAPI_TOKEN` | krok 2.3 | |
   | `DOKPLOY_COMPOSE_ID` | krok 5 | |
   | `DOKPLOY_API_KEY` | krok 6 | |

## Krok 5. Usługa Compose w Dokploy

**Cel:** utworzyć usługę, którą workflow będzie wdrażał. Pierwszego deployu **nie uruchamiaj z panelu Dokploy**: obrazów jeszcze nie ma w GHCR i deploy zakończyłby się błędem pobierania. Pierwszy deploy zlecisz z GitHub Actions w kroku 8.

1. Dokploy (https://dokploy.biddy.pl) → **Projects → Biddy → Create Service → Compose**.
2. **Name:** `biddy-staging`. **Compose Type:** `Docker Compose` (nie `Stack`). Zapisz.
3. Zakładka **General → Provider: Git** (publiczne repozytorium nie potrzebuje klucza SSH ani tokena):

   | Pole | Wartość |
   | --- | --- |
   | Repository URL | `https://github.com/Bembnias/biddy.git` |
   | Branch | `main` |
   | Compose Path | `./infra/dokploy/docker-compose.yml` |

   **Save.** Dokploy pobiera z repozytorium tylko plik compose; obrazy są gotowe w GHCR.

4. **Autodeploy:** wyłączony. Deploy zleca workflow dopiero po zbudowaniu obrazów; autodeploy przy pushu pobrałby jeszcze stare obrazy.
5. **Advanced → Enable Isolated Deployment:** wyłączone (przełącznik w lewej pozycji, tak jest domyślnie). Nowsze wersje Dokploy oznaczają tę opcję jako `Deprecated`; to tylko informacja, zostaw wyłączoną. Compose sam dołącza usługi do `dokploy-network`, gdzie są baza i Traefik.

   W tej samej zakładce sekcja **Networks** może pokazywać czerwony komunikat „Could not load the compose services”. Przed pierwszym deployem to normalne: Dokploy nie sklonował jeszcze repozytorium. Kliknij **Reload services** (według opisu przycisku klonuje repozytorium i wczytuje usługi, bez deployu): na liście mają się pojawić `migrate`, `api`, `worker`, `web`, `redis-queue`, `redis-cache` i `meilisearch`. Jeśli komunikat wróci, sprawdź pola Git z punktu 3 (adres, gałąź, ścieżka compose). Niczego w **Networks** nie zmieniaj: sieci każdej usługi są zadeklarowane w pliku compose i `api`, `web`, `worker` oraz `migrate` muszą zostać w `dokploy-network`.
6. Zakładka **Environment**: wklej poniższy blok, zastąp każde `<…>` wartością z arkusza (kroku 4) i **Save**. Szablon bazowy to [`infra/dokploy/.env.example`](../infra/dokploy/.env.example).

   ```dotenv
   BIDDY_ENV=staging
   BIDDY_REGISTRY=ghcr.io/bembnias
   BIDDY_TAG=staging

   WEB_URL=https://staging.biddy.pl
   API_PUBLIC_URL=https://api.staging.biddy.pl
   AUTH_COOKIE_DOMAIN=staging.biddy.pl
   OPENAPI_ENABLED=true

   DATABASE_URL=<Internal Connection URL>

   BETTER_AUTH_SECRET=<sekret>
   WEB_REVALIDATE_SECRET=<sekret>
   MEILI_MASTER_KEY=<sekret>

   S3_ENDPOINT=https://<ID_KONTA>.eu.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_ACCESS_KEY_ID=<klucz>
   S3_SECRET_ACCESS_KEY=<sekret>
   S3_BUCKET_MEDIA=biddy-staging-media
   S3_BUCKET_UPLOADS=biddy-staging-uploads
   MEDIA_PUBLIC_URL=https://pub-<…>.r2.dev

   RESEND_API_KEY=<klucz>
   MAIL_FROM=Biddy Staging <no-reply@staging.biddy.pl>
   TURNSTILE_SITE_KEY=<klucz witryny>
   TURNSTILE_SECRET_KEY=<klucz tajny>
   # Do czasu aktywacji konta w SMSAPI: SMS_LOG_ONLY=true i pusty token (krok 2.3).
   SMS_LOG_ONLY=true
   SMSAPI_TOKEN=
   SMSAPI_SENDER=
   SENTRY_DSN=
   SENTRY_TRACES_SAMPLE_RATE=0.2
   LOG_LEVEL=info

   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   APPLE_CLIENT_ID=
   APPLE_CLIENT_SECRET=
   ```

   Zasady:
   - `BIDDY_TAG` ma być **`staging`**. Workflow przestawia ten tag na najnowszy obraz; inna wartość (np. `sha-…` po ręcznym wycofaniu) sprawia, że kolejne wdrożenia z CI nie zmieniają wersji.
   - `BIDDY_REGISTRY` małymi literami.
   - Wartości bez cudzysłowów, bez spacji na końcu linii. Spacje w środku `MAIL_FROM` są poprawne.
   - Brak wymaganej zmiennej przerywa deploy komunikatem, której brakuje (`${ZMIENNA:?…}` w compose).

7. Zakładka **Domains → Add Domain**, dwa razy:

   | Service | Host | Path | Container Port | HTTPS | Certificate |
   | --- | --- | --- | --- | --- | --- |
   | `web` | `staging.biddy.pl` | `/` | 3000 | tak | Let's Encrypt |
   | `api` | `api.staging.biddy.pl` | `/` | 3001 | tak | Let's Encrypt |

   Nazwy usług (`web`, `api`) pochodzą z pliku compose; pomyłka portu daje później 502 albo 504. Dokploy dopisze etykiety Traefika przy deployu (podgląd: **Preview Compose**).

8. Zapisz **identyfikator usługi** (`DOKPLOY_COMPOSE_ID`): to ostatni segment adresu strony usługi w przeglądarce (`…/services/compose/<identyfikator>`).

**Punkt kontrolny:** usługa `biddy-staging` istnieje, ma zapisane Environment i dwie domeny, a Ty masz zapisany `DOKPLOY_COMPOSE_ID`. Nie ma jeszcze żadnego deployu.

## Krok 6. Klucz API Dokploy

**Cel:** pozwolić workflow zlecać deploy.

1. Dokploy → **Profil** (prawy górny róg) → **API/CLI → Generate**: nazwa `github-actions-staging`. Skopiuj klucz (widać go tylko raz). To `DOKPLOY_API_KEY`.
2. Klucz ma uprawnienia konta administratora panelu, które zarządza całym serwerem. Trzymaj go wyłącznie w menedżerze haseł i w sekretach środowiska `staging` w GitHubie. Unieważnienie: ten sam ekran w profilu.
3. Opcjonalny test przed budowaniem obrazów (żeby nie czekać kilku minut na błąd klucza). Podaj klucz bez zapisywania go w historii powłoki:

   ```bash
   read -rs DOKPLOY_API_KEY && export DOKPLOY_API_KEY
   curl -sS -o /dev/null -w '%{http_code}\n' -H "x-api-key: $DOKPLOY_API_KEY" \
     "https://dokploy.biddy.pl/api/compose.one?composeId=TWÓJ_DOKPLOY_COMPOSE_ID"
   unset DOKPLOY_API_KEY
   ```

   Oczekiwany wynik to `200`. Wynik `401` albo `403` oznacza zły klucz. Nie sprawdzałem tej ścieżki na Twojej wersji Dokploy; jeśli zwróci `404`, pomiń test, bo pierwszy przebieg workflow też sprawdza klucz.

## Krok 7. Środowisko `staging` w GitHubie

**Cel:** zmienne i sekrety, których potrzebuje workflow ([`deploy-dokploy.yml`](../.github/workflows/deploy-dokploy.yml)). Zmienne `WEB_URL` i `API_PUBLIC_URL` trafiają do obrazu web przy budowaniu (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`). **Muszą być ustawione przed pierwszym uruchomieniem**, inaczej walidacja konfiguracji web przerwie build.

Możesz to zrobić w przeglądarce (repozytorium → **Settings → Environments → New environment** → `staging`, potem **Add environment variable** i **Add environment secret**) albo poleceniami `gh`:

```bash
gh api --method PUT repos/Bembnias/biddy/environments/staging

gh variable set WEB_URL --env staging --body 'https://staging.biddy.pl'
gh variable set API_PUBLIC_URL --env staging --body 'https://api.staging.biddy.pl'
gh variable set DOKPLOY_COMPOSE_ID --env staging --body 'TWÓJ_DOKPLOY_COMPOSE_ID'

gh secret set DOKPLOY_URL --env staging --body 'https://dokploy.biddy.pl'
gh secret set DOKPLOY_API_KEY --env staging
```

Ostatnie polecenie samo poprosi o wartość (wklej klucz z kroku 6). Dzięki temu klucz nie trafia do historii powłoki.

Zmienne opcjonalne (puste = wyłączone; dodasz je później):

| Zmienna | Znaczenie |
| --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN projektu `biddy-web` (Sentry w przeglądarce) |
| `NEXT_PUBLIC_POSTHOG_KEY` | klucz PostHog |
| `SENTRY_ORG`, `SENTRY_PROJECT_WEB` | wysyłka source map do Sentry |
| sekret `SENTRY_AUTH_TOKEN` | token organizacji Sentry (bez niego bez source map) |

Opcjonalnie w środowisku `staging`: **Deployment branches → Selected branches → `main`**. Ręczne wdrożenie z innej gałęzi wymaga wtedy zmiany tej reguły.

Sprawdzenie:

```bash
gh variable list --env staging
gh secret list --env staging
```

Pierwsze polecenie ma pokazać `WEB_URL`, `API_PUBLIC_URL` i `DOKPLOY_COMPOSE_ID`, drugie `DOKPLOY_URL` i `DOKPLOY_API_KEY` (wartości sekretów nie są wyświetlane).

**Nie ustawiaj jeszcze `DOKPLOY_ENABLED`.** To krok 8.

## Krok 8. Pierwsze wdrożenie

**Cel:** zbudować obrazy, wysłać je do GHCR i uruchomić stos.

### 8.1 Włączenie i start

1. Włącz workflow zmienną repozytorium (nie środowiska):

   ```bash
   gh variable set DOKPLOY_ENABLED --body true
   ```

   Ustawienie jej nie uruchamia niczego wstecz: workflow reaguje na nowe przebiegi CI, a ostatni na `main` już się skończył.

2. Uruchom wdrożenie ręcznie z `main`:

   ```bash
   gh workflow run deploy-dokploy.yml -f ref=main
   ```

   Albo w przeglądarce: **Actions → Deploy (Dokploy) → Run workflow** (gałąź `main`, ref `main`).

3. Śledź przebieg:

   ```bash
   gh run list --workflow deploy-dokploy.yml --limit 1
   gh run watch <ID_PRZEBIEGU>
   ```

### 8.2 Co powinno się wydarzyć

| Job | Czas | Co robi |
| --- | --- | --- |
| Wersja do wdrożenia | ok. 10 s | ustala SHA commita i rejestr |
| Obraz api (linux/arm64) | kilka minut | buduje i wysyła `ghcr.io/bembnias/biddy-api` |
| Obraz web (linux/arm64) | pierwszy raz ok. 5–8 min | buduje i wysyła `ghcr.io/bembnias/biddy-web-staging` |
| Wdrożenie w Dokploy | do 12 min czekania | zleca deploy i czeka, aż `/health` pokaże ten commit |

W logu jobu „Wdrożenie w Dokploy”:

- „Na stagingu działa wersja: brak odpowiedzi API” to **normalne przy pierwszym wdrożeniu** (nie ma jeszcze czego pytać). Z tego powodu pierwsze wdrożenie nie ma też wersji, do której można wrócić: jeśli się nie uda, po prostu popraw przyczynę i uruchom workflow ponownie.
- „Dokploy przyjął deploy wersji …” znaczy, że klucz API i identyfikator usługi są poprawne.
- Kolejne linie „API: brak odpowiedzi” co 10 s są w porządku, dopóki Dokploy pobiera obrazy, uruchamia migracje na pustej bazie i startuje usługi.
- Sukces to „Wersja … działa: API i web odpowiadają.”

### 8.3 Pakiety GHCR muszą być publiczne

Pierwszy push tworzy pakiety w GHCR i mogą być **prywatne**. Wtedy serwer nie pobierze obrazów (bez logowania do rejestru). Objawy: w Dokploy → `biddy-staging` → **Deployments** deploy ma status błędu z komunikatem `pull access denied` albo `unauthorized`, a workflow czeka do końca limitu.

1. Gdy oba joby „Obraz …” skończą się sukcesem, otwórz https://github.com/Bembnias?tab=packages.
2. Dla **`biddy-api`** i **`biddy-web-staging`**: wejdź w pakiet → **Package settings → Danger Zone → Change visibility → Public** (GitHub poprosi o wpisanie nazwy pakietu). Repozytorium jest publiczne, a obrazy nie zawierają sekretów (sekrety dostają kontenery przy starcie).
3. Jeśli job „Wdrożenie w Dokploy” już się zaczął i widzisz błąd pobierania, **anuluj przebieg** (Actions → przebieg → Cancel workflow), żeby nie czekać 12 minut. Po zmianie widoczności uruchom ponownie: **Re-run failed jobs** albo `gh workflow run deploy-dokploy.yml -f ref=main`. Obrazy są już w GHCR (albo w cache budowania), więc powtórka jest szybka.

Jeśli GitHub od razu utworzył pakiety jako publiczne, ten punkt możesz pominąć.

Alternatywa dla pakietów prywatnych (token `read:packages` i `docker login ghcr.io` na serwerze) jest opisana w [tamtym dokumencie, krok 6](deployment-dokploy.md#6-obrazy-w-ghcr).

**Punkt kontrolny:** przebieg „Deploy (Dokploy)” kończy się zielono, a w ostatnim kroku widać „Wersja … działa”.

## Krok 9. Weryfikacja techniczna

1. Wersja API musi być SHA wdrożonego commita:

   ```bash
   curl -s https://api.staging.biddy.pl/health
   git fetch origin && git rev-parse origin/main
   ```

   Pole `release` w odpowiedzi ma równać się wynikowi drugiego polecenia, jeśli od merge'a nic nowego nie weszło na `main`.

2. Gotowość (sprawdza m.in. bazę) i strona:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://api.staging.biddy.pl/ready
   curl -s -o /dev/null -w '%{http_code}\n' https://staging.biddy.pl/
   ```

   Oba mają zwrócić `200`. W przeglądarce adres `https://staging.biddy.pl` ma pokazywać zamek (certyfikat Let's Encrypt). Swagger API jest pod https://api.staging.biddy.pl/docs (włączony przez `OPENAPI_ENABLED=true`).

3. Kontenery na serwerze (`ssh ubuntu@IP_SERWERA`):

   ```bash
   sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}'
   ```

   Usługi `api`, `web`, `worker`, `redis-queue`, `redis-cache` i `meilisearch` mają status `Up` (a te z healthcheckiem `healthy`). Kontener `migrate` jest `Exited (0)`: tak ma być, migracje działają raz na wdrożenie.

4. `TRUST_PROXY` (adres klienta w logach i limity zależne od IP): wykonaj `curl -H 'X-Forwarded-For: 203.0.113.7' https://api.staging.biddy.pl/health`, a potem w Dokploy → `biddy-staging` → **Logs** → `api` sprawdź, że `req.remoteAddress` to Twój publiczny adres, nie `203.0.113.7` ani adres wewnętrzny ([tamten dokument, krok 10](deployment-dokploy.md#10-po-pierwszym-wdrożeniu)).

5. Wartości zastępcze w Environment: upewnij się, że nie został żaden `<…>`.

## Krok 10. Test dymny aplikacji

**Cel:** przejść jedną ścieżką przez wszystkie usługi, żeby wykryć błąd w konfiguracji zewnętrznej, zanim ktoś inny na niego trafi. Potrzebujesz dwóch kont, więc dwóch przeglądarek (zwykłe i prywatne okno) i dwóch polskich numerów telefonu (jeden numer to jedno konto).

| # | Co zrobić | Co sprawdza | Jeśli nie działa |
| --- | --- | --- | --- |
| 1 | Zarejestruj konto A na https://staging.biddy.pl | web → API, cookie sesji, Turnstile | widżet pokazuje błąd domeny: klucz witryny ma inną domenę (krok 2.2) |
| 2 | Potwierdź e-mail z linku w wiadomości | Resend, worker, kolejka | wiadomość nie dochodzi: Resend → Logs, status domeny (krok 2.1), spam |
| 3 | Zweryfikuj telefon kodem SMS (z atrapą: kod z linii `SMS (atrapa)` w logach `api`) | SMSAPI albo atrapa | błąd 503: zły token, brak środków albo konto bez aktywacji (kod 94 w logach `api`) |
| 4 | Zmień zdjęcie profilowe na `/konto/profil` | upload do R2, worker, media | błąd CORS w konsoli: krok 3 punkt 2; zdjęcie się nie pokazuje: `MEDIA_PUBLIC_URL` albo wyłączony `r2.dev` |
| 5 | Jako konto A wystaw przedmiot ze zdjęciem | kreator aukcji | |
| 6 | Wyszukaj ten przedmiot na stronie głównej albo w wyszukiwarce | Meilisearch, indeksowanie przez workera | brak wyniku: logi `worker` |
| 7 | Konto B: zarejestruj, zweryfikuj, licytuj; konto A ma widzieć ofertę bez odświeżania | licytacja, Socket.IO, Redis | brak aktualizacji na żywo: logi `api`, `redis-cache` |
| 8 | Konto B: „Kup teraz” → checkout → płatność BLIK kodem `777123` na panelu atrapy | FakeGateway, webhook worker → API siecią wewnętrzną | płatność „w toku” bez końca: patrz niżej |
| 9 | Przesyłki: panel atrapy `/dev/fake-shipping` | FakeShipping | jak wyżej |

Scenariusze płatności i przesyłek w szczegółach, z kwotami i kodami BLIK, są w [docs/qa/F-25-checkout-scenariusze.md](qa/F-25-checkout-scenariusze.md). Ten plik leży lokalnie w `docs/qa/` i nie jest jeszcze w repozytorium.

Jeśli płatność nie przechodzi po kodzie `777123`, sprawdź, dokąd worker wysyła webhooki (adres ma być wewnętrzny):

```bash
sudo docker exec "$(sudo docker ps --format '{{.Names}}' | grep worker | head -n 1)" \
  printenv PAYMENTS_FAKE_WEBHOOK_URL SHIPPING_FAKE_WEBHOOK_URL
```

Oczekiwany wynik: `http://staging-api:3001/v1/webhooks/payments/fake` i `http://staging-api:3001/v1/webhooks/shipping/fake`.

## Krok 11. Porządki po pierwszym wdrożeniu

Te rzeczy nie blokują stagingu, ale warto je zrobić w pierwszym tygodniu:

1. **Automatyczne wdrożenie.** Potwierdź, że działa bez Twojego udziału: następny merge do `main` powinien po zielonym CI uruchomić „Deploy (Dokploy)” sam. Wyłączenie w razie potrzeby: `gh variable set DOKPLOY_ENABLED --body false`.
2. **Prawdziwy Turnstile**, jeśli na start użyto kluczy testowych (krok 2.2): wymień oba klucze w Environment w Dokploy i zrób Deploy.
3. **Prawdziwy token SMSAPI** zamiast atrapy: po aktywacji konta `SMS_LOG_ONLY=false`, token w `SMSAPI_TOKEN` i Deploy (krok 2.3).
4. **Monitoring z zewnątrz.** Panel Dokploy nie powie, że cały serwer leży. Darmowy monitor (np. Better Stack Uptime albo UptimeRobot) na `https://api.staging.biddy.pl/ready` i `https://staging.biddy.pl`, co 3–5 minut, z powiadomieniem e-mail.
5. **Ćwiczenie odtworzenia bazy** do nowej, pustej bazy testowej, z zapisaniem, ile trwało ([tamten dokument, krok 5](deployment-dokploy.md#5-baza-danych)). To jedyny sposób, żeby wiedzieć, że backup działa.
6. **Ochrona gałęzi `main`** z wymaganymi checkami `Lint, typecheck, testy i build`, `Testy integracyjne (Testcontainers)`, `Obraz API (Docker)` i `Aplikacja web (Playwright)` ([deployment.md, „GitHub”](deployment.md#5-github)). Dzięki temu na staging nie trafi kod, który nie przeszedł CI.
7. **Stary staging** (Render, Vercel), jeśli istniał: wstrzymaj usługi i odepnij domenę, żeby nie płacić za dwa stagingi.
8. **Sentry** (opcjonalnie): `SENTRY_DSN` w Dokploy → Environment → Deploy, a `NEXT_PUBLIC_SENTRY_DSN` jako zmienna środowiska `staging` w GitHubie i ponowne uruchomienie workflow, bo trafia do obrazu web przy budowaniu.
9. **Uprawnienia do repozytorium.** Sekrety środowiska `staging` czyta workflow uruchomiony przez osobę z prawem zapisu, a klucz Dokploy daje kontrolę nad serwerem. Nie dodawaj współpracowników z prawem zapisu bez potrzeby.

## Rozwiązywanie problemów przy pierwszym wdrożeniu

Ogólna lista błędów jest w [tamtym dokumencie, „Rozwiązywanie problemów”](deployment-dokploy.md#rozwiązywanie-problemów). Poniżej to, co najczęściej zdarza się na samym początku.

| Objaw | Przyczyna | Co zrobić |
| --- | --- | --- |
| „Deploy (Dokploy)” ma status `skipped` | brak zmiennej repozytorium `DOKPLOY_ENABLED=true` (tak było po merge'u PR #2) | krok 8.1; przy ręcznym uruchomieniu workflow też wymaga tej zmiennej |
| Job „Obraz web” kończy się błędem walidacji konfiguracji | brak `WEB_URL` albo `API_PUBLIC_URL` w zmiennych środowiska `staging` | krok 7, potem uruchom ponownie |
| „Dokploy odrzucił deploy (HTTP 401 / 403)” | zły `DOKPLOY_API_KEY` albo `DOKPLOY_URL` | wygeneruj klucz od nowa (krok 6) i ustaw sekret |
| „Dokploy odrzucił deploy” z informacją o nieznanej usłudze | zły `DOKPLOY_COMPOSE_ID` | porównaj z adresem strony usługi w Dokploy |
| W Dokploy: „required variable … is missing” | brakuje zmiennej w Environment | uzupełnij zmienną o nazwie z komunikatu, potem uruchom workflow ponownie |
| W Dokploy: `pull access denied` / `unauthorized` | pakiety GHCR są prywatne | krok 8.3 |
| Usługa `migrate` kończy się błędem | zły `DATABASE_URL` (host, hasło) albo baza poza `dokploy-network` | log usługi `migrate`; test sieci niżej |
| `api` restartuje się albo jest `unhealthy` | niepoprawna konfiguracja; API wypisuje w logu listę błędnych zmiennych | Dokploy → Logs → `api`; popraw Environment i Deploy |
| Certyfikat się nie wydaje albo przeglądarka ostrzega | DNS jeszcze nie wskazuje serwera, stary `CNAME` lub `AAAA`, port 80 zamknięty | krok 1; `sudo docker logs dokploy-traefik` |
| 502 albo 504 po zielonym wdrożeniu | zły port w Domains (web 3000, API 3001) albo usługa jeszcze startuje | krok 5 punkt 7; `sudo docker ps` |
| Workflow czeka na `/health` do końca limitu, a w Dokploy deploy się udał | `BIDDY_TAG` w Environment nie jest `staging` | przywróć `staging` i Deploy |
| Kolejny push na `main` nie wdraża | zmienna `DOKPLOY_ENABLED` nie jest `true` albo CI było uruchomione z pull requesta | wdrażamy tylko push na `main` po zielonym CI |
| Weryfikacja telefonu: błąd 503, w logach `api` `kod 94: Not allowed to send messages with link` | konto SMSAPI nie jest jeszcze aktywne (linia `@host #kod` w SMS-ie wygląda jak link) | `SMS_LOG_ONLY=true` w Environment i Deploy (krok 2.3) |

Test, czy kontener widzi bazę w sieci Dokploy (podstaw nazwę hosta z `DATABASE_URL`):

```bash
sudo docker run --rm --network dokploy-network postgres:17 \
  pg_isready -h biddy-postgres-xxxxxx -p 5432
```

Odpowiedź `accepting connections` znaczy, że sieć i nazwa są dobre, a problem leży w użytkowniku, haśle albo nazwie bazy.

Po wdrożeniu poprawki nie trzeba nic sprzątać: workflow jest idempotentny, a Compose przy każdym deployu odtwarza kontenery.

## Co dalej

Po zielonym teście dymnym staging jest gotowy do zwykłej pracy: merge do `main` oznacza wdrożenie. Codzienne czynności (ręczne wdrożenie wskazanej wersji, wycofanie, logi, konsola w kontenerze) są opisane w [tamtym dokumencie, krok 9.4](deployment-dokploy.md#94-codzienna-praca). Produkcja to osobny etap: [tamten dokument, „Produkcja później”](deployment-dokploy.md#produkcja-później).
