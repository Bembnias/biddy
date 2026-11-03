# Staging na własnym serwerze: Oracle Cloud + Dokploy

Walkthrough od pustej maszyny wirtualnej do stagingu wdrażanego automatycznie po każdym zielonym CI na `main`. Uzupełnia [deployment.md](deployment.md) (usługi zewnętrzne, R2, migracje, `TRUST_PROXY`), decyzja [PROJECT.md §22 nr 89](PROJECT.md#22-rejestr-decyzji).

Pliki w repozytorium:

| Plik | Rola |
| --- | --- |
| [`infra/dokploy/docker-compose.yml`](../infra/dokploy/docker-compose.yml) | stos aplikacji: migracje, API, worker, web, 2× Redis, Meilisearch |
| [`infra/dokploy/.env.example`](../infra/dokploy/.env.example) | szablon zmiennych stosu do wklejenia w Dokploy |
| [`.github/workflows/deploy-dokploy.yml`](../.github/workflows/deploy-dokploy.yml) | CD: obrazy ARM64 → GHCR → deploy w Dokploy → sprawdzenie wersji |
| [`.github/scripts/dokploy-deploy.sh`](../.github/scripts/dokploy-deploy.sh) | wywołanie API Dokploy i czekanie na nową wersję (też do użytku ręcznego) |
| [`apps/web/Dockerfile`](../apps/web/Dockerfile) | obraz web: samodzielny serwer Next.js (`output: 'standalone'`, ok. 320 MB) |

## Czy to dobry pomysł

**Tak, na staging i wczesną fazę projektu.** Darmowa instancja Ampere A1 (do 4 OCPU i 24 GB RAM w Always Free) to więcej mocy niż płatne plany startowe Render i Vercel razem, a Dokploy daje panel, certyfikaty, logi, backupy i powiadomienia bez pisania własnej infrastruktury.

| Za | Przeciw (i co z tym robimy) |
| --- | --- |
| Koszt 0 zł zamiast kilkudziesięciu do kilkuset zł miesięcznie (Render, Vercel, Meilisearch Cloud) | Jeden serwer to pojedynczy punkt awarii, bez SLA. Backupy bazy i samego Dokploy idą poza serwer (R2), odtworzenie od zera trwa ok. godziny według tego dokumentu. |
| Cały stos w jednym miejscu: Postgres, oba Redisy i Meilisearch obok aplikacji, sieć wewnętrzna bez opóźnień | Oracle może odebrać „bezczynną” instancję Always Free. Konto Pay As You Go (dalej 0 zł w limitach Always Free) wyłącza ten mechanizm (krok 1.3). |
| Ten sam obraz i ten sam compose lokalnie i na serwerze (sprawdzone na ARM64) | Aktualizacje systemu, Dockera i Dokploy są po naszej stronie (krok 2: automatyczne poprawki bezpieczeństwa). |
| Wdrożenie z CI w kilka minut, z automatycznym wycofaniem nieudanej wersji | Każde wdrożenie restartuje kontenery: kilka sekund przerwy (zmierzone lokalnie: API ok. 4 s, web ok. 6 s). Na stagingu bez znaczenia. |
| Obrazy w GHCR z tagiem na każdy commit: wycofanie to jeden deploy | Postgres ma nocny backup, ale bez PITR (odtworzenia do dowolnej sekundy). Na produkcję z prawdziwymi pieniędzmi rozważ WAL archiving albo bazę zarządzaną. |

Czego **nie** robimy na serwerze: budowania obrazów. Build Next.js zjada kilka GB RAM i kilka minut CPU; robi go GitHub Actions na natywnym runnerze ARM (dla publicznego repozytorium bezpłatnym), a serwer tylko pobiera gotowe obrazy. Dzięki temu deploy jest szybki i nie obciąża działającej aplikacji.

Zostaje na zewnątrz: **Cloudflare R2** (zdjęcia i backupy: dane poza serwerem), **Resend**, **SMSAPI**, **Turnstile**, **Sentry**. Konfiguracja tych usług jest w [deployment.md, „Usługi zewnętrzne”](deployment.md#1-usługi-zewnętrzne) i [„Cloudflare R2”](deployment.md#cloudflare-r2-pliki) i nie zmienia się. Meilisearch Cloud nie jest potrzebny: wyszukiwarka działa w stosie.

## Architektura

```
                         DNS w OVH (rekordy A na IP serwera)
                                       │
VM Oracle Cloud (Ubuntu 24.04, ARM64)  ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Traefik (Dokploy) :80 :443, certyfikaty Let's Encrypt                      │
│   staging.biddy.pl      → web:3000                                          │
│   api.staging.biddy.pl  → api:3001                                          │
│   dokploy.biddy.pl      → panel Dokploy                                     │
│                                                                            │
│ Stos Compose „biddy-staging” (infra/dokploy/docker-compose.yml)            │
│   migrate → api, worker → web          redis-queue (AOF, noeviction)       │
│                                        redis-cache (LRU, w pamięci)        │
│                                        meilisearch (wolumen)               │
│ Baza Dokploy: Postgres 17 ── backup co noc ──► R2 (biddy-backups)          │
└────────────────────────────────────────────────────────────────────────────┘
        │ zdjęcia (S3)          │ e-maile, SMS, CAPTCHA, błędy
        ▼                       ▼
   Cloudflare R2        Resend, SMSAPI, Turnstile, Sentry
```

Przepływ wdrożenia:

```
push na main ──► CI (lint, testy, integracja, obraz API, Playwright)
                   │ zielone
                   ▼
                 Deploy (Dokploy)
                   1. obrazy linux/arm64 → GHCR: biddy-api i biddy-web-staging, tagi sha-<commit> i staging
                   2. POST /api/compose.deploy → Dokploy: git pull, docker compose pull i up
                      (migrate → api i worker → web)
                   3. czekanie, aż /health API pokaże nowy commit, i sprawdzenie web
                      └─ nie wstało? tag staging wraca na poprzedni obraz i ponowny deploy
```

Każdy krok jest w logach GitHub Actions (zakładka Actions → „Deploy (Dokploy)”) i w Dokploy (usługa → Deployments).

## 0. Co przygotować

- Konto Oracle Cloud z instancją albo limitem na Ampere A1 w regionie domowym (najlepiej Frankfurt: blisko Polski i w UE).
- Dostęp do strefy DNS domeny `biddy.pl` w OVH (panel OVH → Domeny → `biddy.pl` → Strefa DNS). Domena może zostać w OVH; wyjątek to własna domena zdjęć z R2 (krok 8, „Zdjęcia z R2 a DNS w OVH”).
- Usługi zewnętrzne stagingu z [deployment.md, krok 1](deployment.md#1-usługi-zewnętrzne): Sentry, Resend, Turnstile, SMSAPI, kubełki R2 z kluczem.
- Klucz SSH (np. `ssh-keygen -t ed25519 -C biddy-oracle`).
- Około 1,5 godziny na pierwszą konfigurację.

## 1. Maszyna w Oracle Cloud

### 1.1 Instancja

Compute → Instances → **Create instance**:

| Pole | Wartość |
| --- | --- |
| Image | **Canonical Ubuntu 24.04** (wersja aarch64 wybiera się sama dla A1) |
| Shape | **VM.Standard.A1.Flex**, 4 OCPU, 24 GB RAM (albo mniej, jeśli część limitu jest zajęta; minimum na ten stos to 2 OCPU i 12 GB) |
| Networking | nowa albo istniejąca VCN z publiczną podsiecią, **Assign a public IPv4 address** |
| SSH keys | wklej klucz publiczny (`~/.ssh/id_ed25519.pub`) |
| Boot volume | **100 GB** (Always Free obejmuje łącznie 200 GB dysków) |

Jeśli instancja już istnieje z innym systemem, najprościej utworzyć nową z Ubuntu 24.04 (Dokploy oficjalnie wspiera Ubuntu 24.04, 22.04 i Debian 12) i usunąć starą.

Zanotuj publiczny adres IP (dalej `IP_SERWERA`). Adres efemeryczny zostaje przy restarcie instancji i przepada dopiero przy jej usunięciu; wtedy zmieniasz rekordy DNS.

### 1.2 Zapora Oracle (Security List)

Networking → Virtual Cloud Networks → VCN → podsieć → Security List → **Add Ingress Rules**:

| Źródło | Protokół | Port | Po co |
| --- | --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 | HTTP (Let's Encrypt i przekierowanie na HTTPS) |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | UDP | 443 | HTTP/3 (opcjonalnie) |
| Twój adres IP `/32` | TCP | 22 | SSH (domyślna reguła 22 z `0.0.0.0/0` może zostać, jeśli logujesz się z różnych miejsc: SSH przyjmuje tylko klucze) |

**Nie otwieraj portu 3000** (panel Dokploy przed ustawieniem domeny): w kroku 3 wejdziesz na niego tunelem SSH. Portów baz (5432, 6379, 7700) też nie: usługi rozmawiają w sieci wewnętrznej Dockera.

Docker omija zaporę systemu (`ufw`), więc **Security List Oracle jest jedyną zaporą, która naprawdę działa dla kontenerów**. Dlatego compose nie wystawia żadnych portów na hosta (`expose` zamiast `ports`), a bazy w Dokploy nie mają ustawionego portu zewnętrznego.

### 1.3 Konto Pay As You Go (zalecane)

Oracle może odebrać instancję Always Free uznaną za bezczynną: gdy przez 7 dni 95. percentyl użycia CPU, sieci i (dla A1) pamięci jest poniżej 20%. Staging bez ruchu łatwo się na to łapie. **Billing → Upgrade and Manage Payment → Pay As You Go** wyłącza ten mechanizm, a zasoby w limitach Always Free dalej są bezpłatne.

Po przejściu na PAYG ustaw **Billing → Budgets → Create Budget** z alertem przy np. 1 USD, żeby od razu zobaczyć, gdyby coś zaczęło kosztować.

## 2. Przygotowanie systemu

Zaloguj się: `ssh ubuntu@IP_SERWERA`. Wszystkie polecenia poniżej na serwerze.

```bash
# Aktualizacje i strefa czasowa (logi w czasie polskim; crony Dokploy działają w UTC).
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone Europe/Warsaw

# Automatyczne poprawki bezpieczeństwa (na obrazie Ubuntu zwykle już włączone).
sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

**Zapora systemowa obrazu Oracle.** Obrazy Ubuntu w Oracle mają reguły `iptables` przepuszczające tylko SSH. Dopuść HTTP i HTTPS i zapisz reguły, żeby przetrwały restart:

```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT -p udp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
sudo netfilter-persistent save
```

**Swap** (zapas przy chwilowym skoku pamięci, np. reindeksie):

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Rotacja logów Dockera.** Domyślnie logi kontenerów rosną bez limitu i potrafią zapełnić dysk. Ustaw limit **przed** instalacją Dokploy (dotyczy kontenerów tworzonych później):

```bash
sudo mkdir -p /etc/docker
echo '{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }' | sudo tee /etc/docker/daemon.json
```

## 3. Dokploy

### 3.1 Instalacja

```bash
curl -sSL https://dokploy.com/install.sh | sudo sh
```

Skrypt instaluje Dockera (jeśli go nie ma), inicjuje Docker Swarm i uruchamia Dokploy, jego bazę i Traefika. Wymaga wolnych portów 80, 443 i 3000.

### 3.2 Konto administratora przez tunel SSH

Na swoim komputerze:

```bash
ssh -N -L 3000:localhost:3000 ubuntu@IP_SERWERA
```

Otwórz http://localhost:3000 i załóż konto administratora (silne hasło z menedżera haseł). Potem **Profil → włącz 2FA**. Panel daje pełną kontrolę nad serwerem, więc to jedyne konto z dostępem.

### 3.3 Domena panelu

1. Panel OVH → Domeny → `biddy.pl` → **Strefa DNS → Dodaj wpis**: rodzaj `A`, subdomena `dokploy` (bez `.biddy.pl`), cel (IPv4) `IP_SERWERA`, TTL domyślne. Podgląd ma pokazać `dokploy.biddy.pl. IN A IP_SERWERA`; **Dodaj**. Przy okazji dodaj od razu rekordy z kroku 8 (`staging`, `api.staging`): DNS potrzebuje chwili, a rekordy nie przeszkadzają przed wdrożeniem stosu. Istniejących wpisów (`@`, `www`, MX, NS, SPF) nie ruszaj.
2. Poczekaj, aż rekord odpowiada, najpierw na serwerze DNS OVH, potem publicznie (zwykle kilka minut, OVH podaje do 24 h):
   ```bash
   dig +short dokploy.biddy.pl @dns103.ovh.net
   dig +short dokploy.biddy.pl @1.1.1.1
   ```
   Oba mają zwrócić `IP_SERWERA` (serwer `dns103.ovh.net` to wpis NS strefy; jeśli Twoja strefa ma inny, użyj go). Nie przechodź dalej wcześniej: kilka nieudanych weryfikacji z rzędu Let's Encrypt blokuje dla tej nazwy na około godzinę.
3. Dokploy (przez tunel z kroku 3.2) → **Settings → Web Server → Server Domain**: `dokploy.biddy.pl`, HTTPS, Let's Encrypt, e-mail do powiadomień certyfikatu.
4. Sprawdź, że https://dokploy.biddy.pl działa (certyfikat pojawia się po kilkudziesięciu sekundach). Jeśli nie: `sudo docker logs dokploy-traefik`, najczęściej port 80 zamknięty w Security List albo `iptables` (krok 1.2 i 2).
5. Dopiero wtedy wyłącz port 3000 na serwerze:
   ```bash
   sudo docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy
   ```

### 3.4 Ustawienia serwera

- **Docker Cleanup** (ustawienia serwera w Settings): włącz codzienne czyszczenie nieużywanych obrazów i kontenerów (każde wdrożenie pobiera nowe obrazy, stare zajmują setki MB).
- **Monitoring**: metryki serwera (CPU, RAM, dysk) i progi alertów, np. 80% (próg 0 wyłącza alert).
- **Settings → Notifications**: dodaj kanał (Discord, Slack, Telegram albo e-mail) dla błędów wdrożeń, backupów, czyszczenia Dockera i przekroczenia progów serwera.
- Nazwy pozycji w panelu zmieniają się między wersjami Dokploy; jeśli czegoś nie ma pod podaną ścieżką, szukaj w Settings.

## 4. Backupy poza serwer (R2)

1. Cloudflare → R2 → **Create bucket** `biddy-backups` (jurysdykcja EU, prywatny). **Settings → Object lifecycle rules**: usuwanie po 30 dniach.
2. R2 → **Manage API tokens → Create API token**: „Object Read & Write” **tylko** dla `biddy-backups` (osobny token niż aplikacji: wyciek klucza aplikacji nie daje dostępu do backupów).
3. Dokploy → **Settings → S3 Destinations → Add**: nazwa `r2-backups`, provider Cloudflare, endpoint `https://ID_KONTA.eu.r2.cloudflarestorage.com`, region `auto`, kubełek `biddy-backups`, klucz i sekret z kroku 2. **Test connection**.
4. Dokploy → **Settings → Web Server → Backups → Create Backup**: destynacja `r2-backups`, harmonogram `0 2 * * *`. To kopia samego Dokploy (jego baza i `/etc/dokploy`: projekty, zmienne, domeny), potrzebna do odtworzenia serwera.

## 5. Baza danych

Dokploy → **Projects → Create Project** `Biddy` → **Create Service → Database → PostgreSQL**:

| Pole | Wartość |
| --- | --- |
| Name | `biddy-postgres` |
| Database Name | `biddy` |
| Database User | `biddy` |
| Database Password | wygenerowane, długie (bez znaków `@`, `:` i `/`, które psują adres połączenia) |
| Docker Image | `postgres:17` (ta sama wersja główna co lokalnie i w testach) |

**Deploy**. Bez ustawiania **External Port**: baza ma być dostępna tylko w sieci wewnętrznej. Z zakładki bazy skopiuj **Internal Connection URL** (`postgresql://biddy:…@biddy-postgres-xxxxxx:5432/biddy`): to `DATABASE_URL` stosu.

**Backups → Create Backup**: destynacja `r2-backups`, baza `biddy`, harmonogram `0 3 * * *` (codziennie, UTC), prefiks `staging/postgres`. Kliknij **Test** i sprawdź, że w kubełku pojawił się plik.

Odtworzenie: zakładka bazy → **Backups → Restore** (wybór pliku z R2). Ćwiczenie raz po konfiguracji (odtworzenie do nowej, pustej bazy testowej) to jedyny sposób, żeby wiedzieć, że backup działa.

Konta testowe: seed odmawia przy `NODE_ENV=production`, więc na stagingu konta zakłada się przez rejestrację (jak na Render).

## 6. Obrazy w GHCR

Obrazy buduje workflow i wysyła do GitHub Container Registry (`ghcr.io/bembnias/biddy-api`, `ghcr.io/bembnias/biddy-web-staging`). Serwer musi móc je pobrać:

- **Zalecane: pakiety publiczne.** Repozytorium jest publiczne, a obrazy nie zawierają sekretów (sekrety dostają kontenery przy starcie, `NEXT_PUBLIC_*` i tak są w kodzie strony). Po pierwszym przebiegu workflow: GitHub → profil → **Packages** → `biddy-api` → **Package settings → Change visibility → Public**; to samo dla `biddy-web-staging`.
- **Alternatywa: pakiety prywatne.** Token GitHub (classic) z uprawnieniem tylko `read:packages`, na serwerze `sudo docker login ghcr.io -u <login GitHub>` z tym tokenem jako hasłem.

## 7. Stos aplikacji w Dokploy

Projekt `Biddy` → **Create Service → Compose**:

1. **Name** `biddy-staging`, typ **Docker Compose** (nie Stack).
2. **General → Provider: Git**: repozytorium `https://github.com/Bembnias/biddy.git`, gałąź `main`, **Compose Path** `./infra/dokploy/docker-compose.yml`. Dokploy pobiera repozytorium tylko po plik compose; obrazy są gotowe w GHCR.
3. **Autodeploy: wyłączony.** Deploy zleca workflow dopiero po zbudowaniu obrazów; autodeploy przy pushu pobrałby jeszcze stare obrazy.
4. **Advanced → Isolated Deployments: wyłączone.** Compose sam dołącza usługi do `dokploy-network` (tam jest baza i Traefik).
5. **Environment**: wklej [`infra/dokploy/.env.example`](../infra/dokploy/.env.example) i uzupełnij:
   - `DATABASE_URL`: Internal Connection URL z kroku 5.
   - `BETTER_AUTH_SECRET`, `WEB_REVALIDATE_SECRET`, `MEILI_MASTER_KEY`, `DATA_ENCRYPTION_KEY`: każdy z `openssl rand -base64 32`. `DATA_ENCRYPTION_KEY` szyfruje dane do wypłat (F-27): nie zmieniaj go po zapisaniu danych.
   - R2 aplikacji, Resend, Turnstile, SMSAPI, Sentry: jak w [deployment.md](deployment.md#1-usługi-zewnętrzne).
   - SMS: prawdziwy `SMSAPI_TOKEN` albo, do czasu aktywacji konta w SMSAPI, `SMS_LOG_ONLY=true`: kod weryfikacyjny trafia do logu API (Dokploy → Logs → `api`, linia `SMS (atrapa)`), a SMS nie jest wysyłany. Na produkcji `SMS_LOG_ONLY` jest odrzucane.
   - `MEDIA_PUBLIC_URL`: przy DNS w OVH adres `r2.dev` kubełka media (krok 8, „Zdjęcia z R2 a DNS w OVH”), nie `media.staging.biddy.pl`.
   - `BIDDY_TAG=staging`.

   Brak wymaganej zmiennej przerywa deploy z komunikatem, której brakuje (`${ZMIENNA:?…}` w compose).
6. **Domains → Add Domain** (dwa razy):

   | Service | Host | Path | Container Port | HTTPS | Certificate |
   | --- | --- | --- | --- | --- | --- |
   | `web` | `staging.biddy.pl` | `/` | 3000 | tak | Let's Encrypt |
   | `api` | `api.staging.biddy.pl` | `/` | 3001 | tak | Let's Encrypt |

   Dokploy dopisuje etykiety Traefika przy deployu (podgląd: **Preview Compose**).
7. Zanotuj **identyfikator usługi** (`DOKPLOY_COMPOSE_ID`): ostatni segment adresu strony usługi w panelu (`…/services/compose/<identyfikator>`).

Pierwszy deploy zrób z GitHub Actions (krok 9), bo obrazów w GHCR jeszcze nie ma.

## 8. DNS

Panel OVH → Domeny → `biddy.pl` → **Strefa DNS → Dodaj wpis** (rodzaj `A`, TTL domyślne), tak jak w kroku 3.3:

| Rodzaj | Subdomena | Cel (IPv4) |
| --- | --- | --- |
| A | `staging` | `IP_SERWERA` |
| A | `api.staging` | `IP_SERWERA` |
| A | `dokploy` | `IP_SERWERA` (krok 3.3) |

Sprawdzenie: `dig +short staging.biddy.pl @1.1.1.1` (i tak samo `api.staging`) zwraca `IP_SERWERA`. Traefik wydaje certyfikaty dla `staging` i `api.staging` przy pierwszym deployu stosu (krok 9.3), więc rekordy muszą odpowiadać wcześniej.

Jeśli `staging` i `api.staging` wskazywały wcześniej Vercel i Render (rekordy `CNAME`), zastąp je rekordami A: na tę samą nazwę nie może być jednocześnie `CNAME` i `A`. Zmiana przełącza staging; potem wyłącz tam autodeploy (Render: Suspend usług, Vercel: odpięcie domeny), żeby nie płacić za dwa stagingi.

OVH nie ma proxy przed serwerem (jak pomarańczowa chmurka Cloudflare), więc adres serwera jest publiczny, a jedyną zaporą jest Security List (krok 1.2). Na staging to wystarcza.

### Zdjęcia z R2 a DNS w OVH

Własna domena kubełka R2 (`media.staging.biddy.pl`, [deployment.md, „Cloudflare R2”](deployment.md#cloudflare-r2-pliki)) działa tylko dla domeny, której strefa DNS jest w Cloudflare. Przy DNS w OVH są dwie drogi:

- **Na staging: publiczny adres `r2.dev`.** Cloudflare → R2 → `biddy-staging-media` → **Settings → Public Development URL → Enable**, a w Environment stosu `MEDIA_PUBLIC_URL=https://pub-….r2.dev` (adres z tego ekranu, bez ukośnika na końcu). Cloudflare ogranicza przepustowość `r2.dev` i nie cache'uje go w CDN: dobre do testów, nie do produkcji.
- **Na produkcję: serwery DNS domeny w Cloudflare.** Cloudflare → **Add a domain** `biddy.pl` (plan Free) importuje obecne rekordy; sprawdź, że są wszystkie (MX i SPF poczty OVH, `www`, `staging`, `api.staging`, `dokploy`), potem w OVH → Domeny → `biddy.pl` → **Serwery DNS → Modyfikuj** wpisz dwa serwery podane przez Cloudflare. Domena dalej jest zarejestrowana i opłacana w OVH, zmienia się tylko miejsce edycji strefy. Rekordy serwera ustaw wtedy jako **DNS only** (szara chmurka); proxy Cloudflare przed serwerem wymaga trybu SSL **Full (strict)** i dopisania zakresów Cloudflare do `TRUST_PROXY` (sekcja „Weryfikacja `TRUST_PROXY`” niżej).

## 9. GitHub: CI/CD

### 9.1 Środowisko `staging`

GitHub → repozytorium → **Settings → Environments → New environment** `staging`. Opcjonalnie **Deployment branches: Selected branches → `main`** (ręczne wdrożenie z innej gałęzi wymaga wtedy zmiany tej reguły).

**Environment variables:**

| Zmienna | Wartość |
| --- | --- |
| `WEB_URL` | `https://staging.biddy.pl` |
| `API_PUBLIC_URL` | `https://api.staging.biddy.pl` |
| `DOKPLOY_COMPOSE_ID` | identyfikator z kroku 7 |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN projektu `biddy-web` (puste = bez Sentry w przeglądarce) |
| `NEXT_PUBLIC_POSTHOG_KEY` | klucz PostHog (opcjonalnie) |
| `SENTRY_ORG`, `SENTRY_PROJECT_WEB` | organizacja Sentry i `biddy-web` (upload source map) |

**Environment secrets:**

| Sekret | Wartość |
| --- | --- |
| `DOKPLOY_URL` | `https://dokploy.biddy.pl` |
| `DOKPLOY_API_KEY` | Dokploy → **Profil → API/CLI → Generate** |
| `SENTRY_AUTH_TOKEN` | token organizacji Sentry (opcjonalnie; bez niego bez source map) |

### 9.2 Włączenie

**Settings → Secrets and variables → Actions → Variables → New repository variable** `DOKPLOY_ENABLED` = `true`. Bez tej zmiennej workflow się nie uruchamia (repozytorium działa bez serwera, np. w forkach).

### 9.3 Pierwsze wdrożenie

1. Actions → **Deploy (Dokploy)** → **Run workflow** → gałąź `main`, ref `main`.
2. Job „Obraz web” trwa najdłużej (pierwszy raz ok. 5–8 minut, potem cache). Po nim job „Wdrożenie w Dokploy” zleca deploy i czeka na `/health`.
3. Jeśli pakiety GHCR są prywatne, ustaw je teraz jako publiczne (krok 6) i uruchom workflow jeszcze raz.
4. Sprawdź https://staging.biddy.pl i https://api.staging.biddy.pl/health (`release` = SHA commita).

Od teraz każdy commit na `main`, który przejdzie CI, trafia na staging sam.

### 9.4 Codzienna praca

- **Wdrożenie:** merge do `main`. Status: Actions → „Deploy (Dokploy)”, środowisko `staging` w zakładce Deployments repozytorium.
- **Ręczne wdrożenie dowolnej wersji:** Actions → Deploy (Dokploy) → Run workflow → `ref` = gałąź, tag albo SHA. Workflow buduje obrazy tej wersji (zwykle z cache) i ustawia je jako `staging`.
- **Wycofanie:** to samo z SHA poprzedniego dobrego commita. Szybciej, bez budowania: Dokploy → `biddy-staging` → Environment → `BIDDY_TAG=sha-<pełny SHA>` → Deploy (pamiętaj o powrocie do `BIDDY_TAG=staging`, bo inaczej kolejne wdrożenia z CI nie zmienią wersji).
- **Nieudane wdrożenie:** workflow sam wraca do wersji sprzed wdrożenia i kończy się błędem z informacją, co poszło nie tak. Przyczyna: Dokploy → `biddy-staging` → Deployments (log `docker compose`) albo Logs usługi `migrate` lub `api`.
- **Logi na żywo:** Dokploy → `biddy-staging` → Logs (wybór usługi) albo na serwerze `sudo docker logs -f <kontener>`.
- **Konsola w kontenerze** (np. `node dist/fees-publish.js …`, opis w README): terminal kontenera w panelu usługi albo na serwerze `sudo docker ps --format '{{.Names}}' | grep api`, potem `sudo docker exec -it <nazwa kontenera> sh`.

### 9.5 Jak działa deploy i co wynika z Docker Compose

Dokploy przy deployu pobiera repozytorium, zapisuje zmienne z zakładki Environment do pliku `.env` obok pliku compose i uruchamia `docker compose -p <nazwa> --env-file .env -f … up -d --build --remove-orphans`. `pull_policy: always` pobiera obrazy z tagiem `BIDDY_TAG`. Kolejność wynika z `depends_on`: Redisy i Meilisearch zdrowe → `migrate` kończy się sukcesem → `api` i `worker` → `web` po zdrowym API.

Docker Compose usuwa stare kontenery **przed** startem nowych, więc:

- każde wdrożenie to kilka sekund przerwy (zmierzone: API ok. 4 s, web ok. 6 s),
- **nieudana migracja zostawia API, workera i web wyłączone**, aż wróci poprzednia wersja. Dlatego workflow po nieudanym wdrożeniu sam przestawia tag `staging` na obrazy wersji, która działała przed wdrożeniem, i ponawia deploy (sprawdzone lokalnie: powrót trwa kilkanaście sekund). Migracje działają w transakcji, więc nieudana nie zostawia zmian w bazie, a zasady z [deployment.md, „Migracje: zasady”](deployment.md#migracje-zasady) (zgodność wstecz) dalej obowiązują.

Wdrożenia bez przerwy (rolling update) wymagałyby trybu Swarm (typ Stack w Dokploy) z migracjami przy starcie API; to temat na produkcję, nie na staging.

## 10. Po pierwszym wdrożeniu

**Weryfikacja `TRUST_PROXY`.** API ufa `X-Forwarded-For` tylko od adresów prywatnych (domyślne `loopback,uniquelocal`). Traefik Dokploy łączy się z API z sieci Dockera (`10.x`), więc ustawienie pasuje bez zmian. Sprawdzenie jak w [deployment.md](deployment.md#weryfikacja-trust_proxy-na-render): `curl -H 'X-Forwarded-For: 203.0.113.7' https://api.staging.biddy.pl/health`, a w logach API (Dokploy → Logs → `api`) `req.remoteAddress` ma być Twoim publicznym adresem.

**Monitoring z zewnątrz.** Panel Dokploy nie powie, że cały serwer leży. Darmowy monitor (np. Better Stack Uptime albo UptimeRobot) na `https://api.staging.biddy.pl/ready` (baza) i `https://staging.biddy.pl` co 3–5 minut, z powiadomieniem e-mail.

**Pełna ścieżka zdjęć.** Zmiana zdjęcia profilowego na `/konto/profil` (jak w [deployment.md](deployment.md#cloudflare-r2-pliki)): sprawdza R2, kolejkę i workera naraz.

**Ćwiczenie odtworzenia bazy** (krok 5) i zapisanie, ile trwało.

## Produkcja później

Ten sam serwer albo osobny (lepiej osobny: awaria stagingu nie dotyka produkcji):

1. Drugi stos Compose `biddy-production` z tego samego pliku, `BIDDY_ENV=production`, osobna baza z backupem, osobne kubełki R2, domeny `biddy.pl` i `api.biddy.pl`, `OPENAPI_ENABLED=false`. Prefiks `BIDDY_ENV` w nazwach wewnętrznych pozwala obu stosom działać w jednej sieci `dokploy-network`.
2. Workflow: środowisko GitHub `production` (z wymaganym zatwierdzeniem) i wyzwalacz na tag wersji; obraz API przenosi się bez budowania (`sha-<commit>` → `production`), obraz web buduje się z adresami produkcji (`biddy-web-production`).
3. Płatności: compose ustawia `DEPLOYMENT_ENV` z `BIDDY_ENV`, a przy `production` FakeGateway jest zablokowany. Stos produkcyjny wystartuje dopiero z prawdziwym operatorem w `PAYMENTS_DEFAULT_PROVIDER` (adapter w F-31, PROJECT.md §7.8). Staging działa na FakeGateway, a worker wysyła jego webhooki do API w sieci wewnętrznej (`PAYMENTS_FAKE_WEBHOOK_URL`).
4. Dostawy (F-24): przy `production` FakeShipping też jest zablokowany, więc stos produkcyjny wymaga `SHIPPING_DEFAULT_PROVIDER=furgonetka` i kompletu zmiennych `FURGONETKA_*`. Staging działa na FakeShipping, a worker wysyła webhooki automatu statusów do API w sieci wewnętrznej (`SHIPPING_FAKE_WEBHOOK_URL`).
5. Przed prawdziwymi płatnościami: przegląd PITR bazy, wdrożeń bez przerwy i planu awaryjnego (PROJECT.md §11.6).

## Rozwiązywanie problemów

- **Deploy w Dokploy kończy się „required variable … is missing”:** brakuje zmiennej w zakładce Environment (komunikat mówi której). Szablon: `infra/dokploy/.env.example`.
- **„service migrate didn't complete successfully”:** log usługi `migrate` (`[db:migrate] Migracje nie powiodły się: …`). Workflow wrócił już do poprzedniej wersji; popraw migrację nowym commitem.
- **„pull access denied” / „unauthorized” przy pobieraniu obrazów:** pakiety GHCR są prywatne, a serwer nie jest zalogowany (krok 6), albo `BIDDY_REGISTRY` ma wielkie litery.
- **„exec format error”:** obraz zbudowany dla innej architektury. Workflow buduje `linux/arm64`; serwer x86 wymaga zmiennych repozytorium `DEPLOY_RUNNER=ubuntu-latest` i `DEPLOY_PLATFORM=linux/amd64`.
- **Certyfikat się nie wydaje:** rekord DNS jeszcze nie wskazuje serwera (`dig +short <nazwa> @1.1.1.1`, krok 3.3), na tę nazwę jest też stary `CNAME` albo `AAAA` na inny serwer, albo port 80 zamknięty w Security List lub `iptables` (krok 1.2 i 2). Logi Traefika: `sudo docker logs dokploy-traefik`.
- **Strona nie odpowiada z zewnątrz, a na serwerze `curl -H 'Host: staging.biddy.pl' http://localhost` działa:** Security List Oracle albo `iptables` (krok 1.2 i 2).
- **504 Gateway Timeout:** usługa nie jest w sieci `dokploy-network` albo jeszcze startuje (healthcheck). `sudo docker ps` pokazuje stan, a `sudo docker network inspect dokploy-network` uczestników sieci.
- **Workflow czeka na `/health` do limitu, a w Dokploy deploy się udał:** `BIDDY_TAG` w Environment nie jest `staging` (np. zostało po ręcznym wycofaniu).
- **Workflow nie startuje po CI:** zmienna repozytorium `DOKPLOY_ENABLED` nie jest `true` albo CI uruchomiło się z pull requesta (wdrażamy tylko push na `main`).
- **Worker restartuje się zaraz po starcie:** w logach `maxmemory-policy`: Redis kolejek musi mieć `noeviction` (ustawia go compose; nie zmieniaj polecenia `redis-queue`).
- **Kończy się miejsce na dysku:** Docker Cleanup (krok 3.4), `sudo docker system df`, rotacja logów (krok 2).
