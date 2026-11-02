# F-07 · Rejestracja i logowanie

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-03, F-04, F-05, F-06

## Kontekst i cel

Konta użytkowników w module `identity` ([PROJECT.md §4](../PROJECT.md#4-role-użytkowników), §10.3, §11.2, §16.1): rejestracja e-mailem i hasłem albo przez Google i Apple, weryfikacja e-maila, reset hasła, sesje dla web (ciasteczko) i mobile (token Bearer), akceptacja regulaminu z wersją. Od F-07 zależy każdy feature z akcjami użytkownika (licytowanie, wystawianie, wiadomości). Telefon i 18+ z kodem SMS to F-08.

## Historyjki użytkownika

- Jako odwiedzający chcę założyć konto e-mailem albo kontem Google lub Apple, żeby obserwować aukcje i licytować.
- Jako nowy użytkownik chcę potwierdzić e-mail linkiem, żeby móc licytować i wystawiać.
- Jako użytkownik, który nie pamięta hasła, chcę je zresetować linkiem z e-maila.
- Jako użytkownik chcę wylogować się z tego urządzenia albo ze wszystkich naraz (np. po zgubieniu telefonu).
- Jako właściciel konta nie chcę, żeby ktoś zablokował mi konto, wpisując celowo złe hasło; jako platforma chcemy utrudnić zgadywanie haseł.
- Jako zespół chcemy wiedzieć, którą wersję regulaminu zaakceptował użytkownik.

## Zakres

- **Better Auth 1.7** w API (`apps/api/src/modules/identity`), adapter Drizzle, ścieżki pod `/v1/auth/*` (Fastify przekazuje żądanie do handlera Better Auth jako Fetch `Request`). Tabele: `users`, `sessions`, `accounts`, `verifications`, `rate_limits` z ID UUIDv7 (ADR-10), plus `terms_acceptances` i `login_failures`. Telemetria Better Auth wyłączona. Limity Better Auth per IP (w Postgresie) na trasach wysyłających e-maile: rejestracja 5/min, reset hasła i ponowna weryfikacja 3/min.
- **E-mail i hasło:** rejestracja (imię wyświetlane, e-mail, hasło min. 10 znaków, akceptacja regulaminu i polityki prywatności, oświadczenie 18+), logowanie, weryfikacja e-maila linkiem (ważny 24 h, ponowne wysłanie), reset hasła linkiem (ważny 1 h, unieważnia wszystkie sesje). Logowanie przed weryfikacją jest możliwe, ale bez licytowania i wystawiania.
- **Google i Apple:** włączane konfiguracją (bez kluczy przyciski się nie pokazują). Callback Apple (`form_post`) jako jedyna trasa przyjmuje `application/x-www-form-urlencoded`. Konto społecznościowe akceptuje regulamin przy pierwszym wejściu (ekran akceptacji).
- **Sesje:** web ma ciasteczko `HttpOnly`, `SameSite=Lax`, `Secure` poza local, na produkcji z domeną `.biddy.pl` (wspólne dla `biddy.pl` i `api.biddy.pl`). Sesja żyje 30 dni i przedłuża się przy użyciu. Mobile dostaje token z nagłówka `set-auth-token` (wtyczka `bearer`) i wysyła `Authorization: Bearer`. Wylogowanie z jednego urządzenia albo ze wszystkich (`revoke-sessions`).
- **Turnstile (Cloudflare):** zawsze przy rejestracji i resecie hasła; przy logowaniu po 5 nieudanych próbach na konto albo 20 z jednego IP. Token w nagłówku `x-turnstile-token`. Lokalnie i w testach klucze testowe Cloudflare (API rozpoznaje testowy klucz tajny i sprawdza token bez sieci).
- **Nieudane logowania (§16.1):** licznik per konto (e-mail) i per IP w Postgresie. Od 5. porażki na konto (20. z IP) wymagany Turnstile i rosnąca przerwa przed kolejną próbą: 2 s, 4 s, 8 s… do 5 min (odpowiedź 429 z `Retry-After`). Konto nie jest blokowane, a udane logowanie zeruje licznik konta. Próg IP jest wyższy, bo za jednym adresem bywa wiele osób (sieć firmowa, operator komórkowy z CGNAT).
- **Regulamin:** `terms_acceptances` (dokument `TERMS`/`PRIVACY`, wersja, czas, IP). Aktualne wersje są w `@biddy/shared` (`LEGAL_DOCUMENT_VERSIONS`); wersjonowanie treści i ponowna akceptacja po zmianie to F-41.
- **Ochrona CSRF:** żądania zmieniające stan (`POST`, `PUT`, `PATCH`, `DELETE`) z ciasteczkiem sesji muszą mieć nagłówek `Origin` z listy `CORS_ORIGINS` albo `WEB_URL`. Żądania z tokenem Bearer i bez ciasteczek nie podlegają sprawdzeniu, podobnie callbacki dostawców (`/v1/auth/callback/*`, Apple wysyła formularz z własnej domeny; chroni je parametr `state`). Dodatkowo API przyjmuje tylko JSON (F-03), a Better Auth sam sprawdza `Origin` na swoich trasach.
- **API własne:** `GET /v1/me` (zalogowany użytkownik), `GET /v1/session` (stan sesji dla nagłówka web: zawsze 200, `user: null` dla gościa, więc bez błędów 401 w konsoli), `POST /v1/me/terms-acceptances` (akceptacja aktualnych wersji), `GET /v1/auth-options` (włączone metody logowania, klucz witryny Turnstile, minimalna długość hasła). W OpenAPI schematy bezpieczeństwa: ciasteczko sesji i Bearer.
- **Guardy dla modułów:** `@RequireSession()` (401 `UNAUTHORIZED`) i `@RequireVerifiedEmail()` (403 `EMAIL_NOT_VERIFIED`), dekorator `@CurrentUser()`. Licytowanie (F-15) i wystawianie (F-14) użyją `@RequireVerifiedEmail()`.
- **E-maile:** weryfikacja i reset wysyłane jobem w kolejce `emails` (worker, F-04) przez adapter `MailSender`: SMTP (lokalnie Mailpit) albo Resend (produkcja). Treść zawiera link z tokenem, więc job jest usuwany od razu po wysłaniu (bez historii w Redisie).
- **Seed (`pnpm db:reset`, `db:seed`):** trzy konta testowe z potwierdzonym e-mailem i zaakceptowanym regulaminem: kupujący, sprzedający, admin (`staff_role = admin`, pod panel z F-34). Seed jest idempotentny i odmawia działania przy `NODE_ENV=production`. Dane logowania w README.
- **Web:** ekrany logowania, rejestracji, „sprawdź skrzynkę”, potwierdzenia e-maila, resetu hasła (prośba i nowe hasło), akceptacji regulaminu i konta (`/konto`, renderowane na serwerze z sesją z ciasteczka). W nagłówku menu użytkownika. Trasy `/v1/auth/*` web woła fetcherem klienta F-05 (`apiFetch`): API zamienia błędy Better Auth na Problem Details, więc obsługa błędów jest jedna, a klienta Better Auth nie ma w paczce przeglądarki. Dla `/v1/me` i `/v1/session` wygenerowany klient F-05.
- **Klucze obce między modułami:** **decyzja:** kolumny `uuid` bez FK między tabelami różnych modułów (np. `orders.buyer_id` → `users.id`), FK tylko wewnątrz modułu. Granice modułów zostają bez wyjątków w lincie; użytkownicy nie są usuwani fizycznie (anonimizacja RODO w F-41), więc osierocone wiersze nie powstają. Integralność między modułami pilnujemy w kodzie (publiczne API modułu `identity`) i eventami.

## Poza zakresem

- Telefon, kod SMS, oświadczenie 18+ z weryfikacją (F-08). W F-07 oświadczenie 18+ jest polem formularza zapisanym przy rejestracji (`is_adult_declared_at`).
- 2FA, osobna sesja i RBAC panelu admina (F-34); F-07 zapisuje tylko `staff_role`.
- Usunięcie konta i eksport danych (F-41), limity kont i blokady (F-61).
- Szablony e-maili w React Email (`packages/emails`) i powiadomienia (F-20): F-07 ma proste szablony tekst + HTML.
- Logowanie Facebookiem (§11.2): po starcie, jeśli dane pokażą potrzebę.

## UX

**Logowanie (`/logowanie`):**

```
┌──────────────────────────────────┐
│ Zaloguj się                      │
│ [ Kontynuuj z Google ]           │  (gdy włączone)
│ [ Kontynuuj z Apple ]            │
│ ───────────── lub ─────────────  │
│ E-mail     [                  ]  │
│ Hasło      [                  ]  │
│ [Turnstile]   (po 5 porażkach)   │
│ [ Zaloguj się ]                  │
│ Nie pamiętasz hasła?             │
│ Nie masz konta? Załóż konto      │
└──────────────────────────────────┘
```

**Rejestracja (`/rejestracja`):** imię wyświetlane, e-mail, hasło (podpowiedź: min. 10 znaków), dwa pola wyboru (regulamin i polityka prywatności z linkami; „Mam ukończone 18 lat”), Turnstile, przycisk „Załóż konto”. Po sukcesie ekran „Sprawdź skrzynkę” z adresem i przejściem do konta (użytkownik jest już zalogowany; ponowne wysłanie linku jest na `/konto`).

**Konto (`/konto`):** imię, e-mail i stan weryfikacji (z przyciskiem „Wyślij link ponownie”), data założenia konta, przyciski „Wyloguj się” i „Wyloguj ze wszystkich urządzeń”.

**Stany:**

| Ekran | Ładowanie | Błąd | Sukces |
|---|---|---|---|
| Logowanie | przycisk wyłączony z tekstem „Logowanie…” | komunikat przy formularzu (`role="alert"`): złe dane, wymagany Turnstile, „spróbuj za N s” | przejście na stronę, z której przyszedł użytkownik, albo `/konto` |
| Rejestracja | „Zakładanie konta…” | błędy pól (`aria-describedby`) i ogólny komunikat | „Sprawdź skrzynkę” |
| Potwierdzenie e-maila | — | „Link wygasł lub jest nieprawidłowy” + link do konta (tam ponowne wysłanie) | „E-mail potwierdzony” + link do konta |
| Reset hasła | „Wysyłanie…” | — (zawsze ten sam komunikat, żeby nie zdradzać, czy konto istnieje) | „Jeśli konto istnieje, wysłaliśmy link” |
| Nowe hasło | „Zapisywanie…” | „Link wygasł” | „Hasło zmienione, zaloguj się” |
| Konto | SSR (bez stanu ładowania) | brak sesji → przekierowanie na `/logowanie?next=/konto` | dane konta |

Nagłówek: niezalogowany widzi „Zaloguj się”, zalogowany „Moje konto” (komponent kliencki z `GET /v1/session`, żeby strony publiczne zostały statyczne).

## Model danych

Migracja `0002_identity` (moduł `identity`, `src/modules/identity/db/identity.schema.ts`):

- `users`: `id uuid`, `name`, `email` (unikalny, małe litery), `email_verified bool`, `image`, `is_adult_declared_at`, `status` (`ACTIVE`/`LIMITED`/`BANNED`), `staff_role` (null albo `support`/`moderator`/`finance`/`admin`), `created_at`, `updated_at`. Telefon i blokady dojdą w F-08 i F-61.
- `sessions`: `id`, `user_id` → `users` (FK, kaskada), `token` (unikalny), `expires_at`, `ip_address`, `user_agent`, znaczniki czasu.
- `rate_limits`: liczniki limitów Better Auth per IP i trasa (`key`, `count`, `last_request`).
- `accounts`: konta logowania (hasło albo dostawca OAuth): `provider_id`, `account_id`, `user_id` (FK), `password` (hash scrypt Better Auth), tokeny OAuth.
- `verifications`: tokeny weryfikacji e-maila i resetu hasła (`identifier`, `value`, `expires_at`).
- `terms_acceptances`: `id`, `user_id` (FK), `document`, `version`, `accepted_at`, `ip`; indeks (`user_id`, `document`, `accepted_at`).
- `login_failures`: `key` (np. `email:jan@x.pl`, `ip:1.2.3.4`), `failures`, `last_failure_at`; wpis po 24 h bez porażek jest nieaktualny (sprząta go job cykliczny).

## API i zdarzenia

- Better Auth (`/v1/auth/*`): `sign-up/email`, `sign-in/email`, `sign-in/social`, `callback/:provider`, `sign-out`, `get-session`, `send-verification-email`, `verify-email`, `request-password-reset`, `reset-password`, `revoke-sessions`. Każdy błąd to Problem Details z komunikatem po polsku (jak w całym API) i dodatkowym polem `message` (format klienta Better Auth). Kody Better Auth zostają (np. `INVALID_EMAIL_OR_PASSWORD`, `USER_ALREADY_EXISTS`), a z hooków Biddy: `CAPTCHA_REQUIRED` (403), `CAPTCHA_FAILED` (403), `RATE_LIMITED` (429, `Retry-After`), `TERMS_NOT_ACCEPTED` (400).
- `GET /v1/me` → `MeDto` (`id`, `name`, `email`, `emailVerified`, `termsAccepted`, `staffRole`, `createdAt`); 401 bez sesji.
- `GET /v1/session` → `{ user: { id, name, emailVerified, termsAccepted } | null }`; zawsze 200.
- `POST /v1/me/terms-acceptances` → 204; zapisuje aktualne wersje `TERMS` i `PRIVACY`. Od F-08 wymaga `{ adultDeclaration: true }` i zapisuje też oświadczenie 18+ (`is_adult_declared_at`).
- `GET /v1/auth-options` → `{ socialProviders: ('google' | 'apple')[], turnstileSiteKey, passwordMinLength }`.
- Eventy domenowe: brak w F-07. `UserRegistered` powstanie razem z pierwszym konsumentem (F-20: e-mail powitalny, F-36: reguły antyfraudowe). Better Auth zakłada konto we własnej transakcji, więc event trzeba będzie zapisać w outboxie z hooka `databaseHooks.user.create` w tej samej transakcji (albo dodać go przy pierwszym zapisie w module konsumenta).

## Reguły biznesowe i przypadki brzegowe

- E-mail porównujemy bez wielkości liter (zapis małymi literami).
- Rejestracja na istniejący e-mail: Better Auth zwraca błąd; komunikat w UI nie zdradza więcej niż „Konto z tym adresem już istnieje — zaloguj się albo zresetuj hasło”.
- Reset hasła zawsze odpowiada tym samym komunikatem (bez wycieku istnienia konta).
- Logowanie Google/Apple na e-mail istniejącego konta z hasłem: łączenie kont tylko przy potwierdzonym e-mailu u dostawcy (domyślne zachowanie Better Auth dla zaufanych dostawców).
- Przerwa po porażkach liczy się od ostatniej porażki; IP i konto liczą się osobno, obowiązuje dłuższa z przerw.
- `@RequireVerifiedEmail()` sprawdza stan z bazy przy każdym żądaniu (bez cache), więc potwierdzenie e-maila działa od razu.

## Bezpieczeństwo i prywatność

- Hasła: scrypt (Better Auth), min. 10 znaków, maks. 128.
- `BETTER_AUTH_SECRET` (min. 32 znaki) wymagany przy `NODE_ENV=production` (produkcja i staging); lokalnie i w testach wartość deweloperska.
- Ciasteczka `HttpOnly`, `SameSite=Lax`, `Secure` poza local; prefiks `biddy`.
- CSRF: sprawdzanie `Origin` (wyżej) + tylko JSON.
- Logi: e-mail i token nie trafiają do logów (redakcja nagłówków `authorization`, `cookie` z F-03; treści żądań nie logujemy).
- `terms_acceptances.ip` i `sessions.ip_address`: dane osobowe; retencja razem z kontem (F-41).
- Sentry: identyfikator użytkownika (bez e-maila) ustawiany przy zalogowanym żądaniu.

## Analityka

PostHog (po zgodzie): `sign_up_completed` (`method`: `email`/`google`/`apple`), `login_completed` (`method`), `email_verified`. Wywołania w web; identyfikacja użytkownika w PostHog po zalogowaniu (`identify` z ID, bez e-maila), `reset` po wylogowaniu. Logowanie Google/Apple kończy się po przekierowaniu, więc metoda czeka w `sessionStorage` (15 min) na powrót z sesją; nowe konto społecznościowe (bez akceptacji regulaminu) liczymy jako `sign_up_completed`.

## Kryteria akceptacji

- [x] Given użytkownik bez potwierdzonego e-maila, When wywołuje trasę z `@RequireVerifiedEmail()` (licytowanie, wystawianie), Then dostaje 403 `EMAIL_NOT_VERIFIED`; po kliknięciu linku z e-maila trasa działa.
- [x] Given `pnpm db:reset`, Then w bazie są konta kupującego, sprzedającego i admina z potwierdzonym e-mailem; dane logowania są w README.
- [x] Given rejestracja z akceptacją regulaminu, Then `terms_acceptances` ma wpisy `TERMS` i `PRIVACY` z aktualnymi wersjami, czasem i IP; rejestracja bez akceptacji albo bez 18+ jest odrzucana.
- [x] Given 5 nieudanych logowań na konto (albo 20 z IP), When kolejna próba, Then bez tokenu Turnstile odpowiedź to 403 `CAPTCHA_REQUIRED`, a próba przed upływem przerwy to 429 z `Retry-After`; poprawne hasło z Turnstile po przerwie loguje i zeruje licznik konta. Konto nie jest blokowane.
- [x] Given zalogowany użytkownik, When otwiera `/konto`, Then strona renderuje się na serwerze z jego danymi (SSR z ciasteczkiem sesji).
- [x] Given sesja cookie, When żądanie zmieniające stan przychodzi z obcego `Origin`, Then 403; żądanie z tokenem Bearer bez ciasteczek przechodzi.
- [x] Given „Wyloguj ze wszystkich urządzeń”, Then wszystkie sesje użytkownika są unieważnione (także tokeny Bearer).
- [x] Given reset hasła, Then link działa raz, wygasa po 1 h, a zmiana hasła unieważnia sesje.

## Plan testów

- **API, jednostkowe:** przerwa po porażkach, weryfikacja Turnstile (fake), sprawdzanie `Origin`, konfiguracja, mapowanie żądania Fastify na Fetch `Request` (wiele `set-cookie`).
- **API, integracyjne (Testcontainers):** pełne ścieżki: rejestracja → e-mail (link z joba w kolejce `emails`) → weryfikacja → logowanie → `/v1/me`; Bearer; regulamin; porażki i Turnstile (konto i IP); CSRF; `EMAIL_NOT_VERIFIED`; reset hasła; wylogowanie wszędzie; seed; `GET /v1/session` i `GET /v1/auth-options` (`apps/api/test/integration/auth.int.test.ts`).
- **Web, jednostkowe:** formularze logowania i rejestracji (walidacja, Turnstile po `CAPTCHA_REQUIRED`, treść żądań), `safeNextPath` (open redirect), menu użytkownika, analityka (kolejność `identify`/`track` względem startu PostHog, znacznik logowania Google/Apple).
- **Web, e2e (Playwright):** ekrany logowania i rejestracji przeciw atrapie API w przeglądarce (`page.route`) i atrapie skryptu Turnstile; `/konto` renderowane na serwerze z ciasteczkiem (atrapa `e2e/mock-api.ts` pod `API_INTERNAL_URL` odpowiada tylko na znane ciasteczko sesji); przekierowania bez sesji i bez akceptacji regulaminu; axe-core na wszystkich ekranach auth.

## Otwarte pytania

- Klucze Google i Apple (konta deweloperskie, §20 Faza 0): **domyślnie** kod gotowy, logowanie społecznościowe wyłączone do czasu kluczy.
- Treść regulaminu i polityki prywatności (prawnik, F-41): **domyślnie** wersje `2026-10-01` i linki do stron z F-41.
- Dostawca e-maili na produkcji: Resend (§11.2); klucz API w panelu Render (`RESEND_API_KEY`, [deployment.md](../deployment.md)).
