# F-08 · Weryfikacja telefonu i 18+

**Status:** Review
**Rozmiar:** S · **Właściciel:** Mateusz Bienias · **Zależności:** F-07

## Kontekst i cel

Licytować i wystawiać może tylko konto ze zweryfikowanym numerem telefonu ([PROJECT.md §4](../PROJECT.md#4-role-użytkowników), §16.2). Jeden numer to jedno konto, więc założenie kolejnego konta wymaga kolejnej karty SIM. To podstawowa ochrona przed fałszywymi kontami i sztucznym podbijaniem cen. Numer jest też sygnałem do wykrywania powiązanych kont (F-36). F-08 dostarcza weryfikację kodem SMS (SMSAPI), guard `@RequireVerifiedPhone()` dla licytowania (F-15) i wystawiania (F-14) oraz domyka oświadczenie 18+ dla kont z Google i Apple.

## Historyjki użytkownika

- Jako zarejestrowany użytkownik chcę potwierdzić numer telefonu kodem SMS, żeby licytować i wystawiać.
- Jako użytkownik, który zmienił numer, chcę zweryfikować nowy numer w miejsce starego.
- Jako użytkownik, któremu SMS nie dotarł, chcę wysłać kod ponownie po chwili.
- Jako platforma chcemy, żeby jeden numer był przypisany tylko do jednego konta i żeby nikt nie mógł wysyłać SMS-ów na nasz koszt bez ograniczeń.
- Jako platforma chcemy mieć oświadczenie 18+ od każdego konta, które licytuje albo wystawia, także zarejestrowanego przez Google lub Apple.

## Zakres

- **Własne endpointy** w module `identity` (`/v1/me/phone-verification`), a nie wtyczka telefonu z Better Auth. Wtyczka dodaje logowanie numerem i reset hasła SMS-em (niepotrzebne), nie ma limitów per numer i IP, a jej trasy nie trafiają do OpenAPI i generowanego klienta. Decyzja w PROJECT.md §22.
- **Numery:** tylko polskie numery komórkowe (`+48`), zapis w formacie E.164 (`+48500600700`). Pole przyjmuje m.in. `500 600 700`, `+48 500-600-700`, `0048500600700`. Ograniczenie do Polski chroni też przed nadużyciem SMS-ów na drogie numery zagraniczne (SMS pumping). Walidacja: `libphonenumber-js`.
- **Kod:** 6 cyfr z `crypto.randomInt`, ważny 5 minut, maks. 5 prób; po 5. błędnej próbie kod przepada. W bazie tylko HMAC kodu (SHA-256 z `BETTER_AUTH_SECRET`). Nowy kod unieważnia poprzedni.
- **Limity wysyłki** (429 `RATE_LIMITED` z `Retry-After`): kolejny SMS dla konta najwcześniej po 60 s; maks. 3 SMS-y na numer na godzinę; maks. 10 SMS-ów z jednego IP na godzinę; maks. 10 SMS-ów na konto na dobę. Liczymy z tabeli `phone_verifications` (Postgres, jak liczniki logowania z F-07).
- **Warunki rozpoczęcia:** sesja, potwierdzony e-mail (`EMAIL_NOT_VERIFIED`), oświadczenie 18+ (`TERMS_NOT_ACCEPTED`). Wymóg potwierdzonego e-maila to dodatkowa bariera dla botów przed wysłaniem płatnego SMS-a.
- **Jeden numer = jedno konto:** unikalny indeks na `users.phone_number`. Numer innego konta: 409 `PHONE_NUMBER_TAKEN` już przy wysyłce (bez SMS-a) i ponownie przy potwierdzeniu (wyścig dwóch kont).
- **Zmiana numeru:** nowy zweryfikowany numer zastępuje stary, a stary wraca do puli. Historia zweryfikowanych numerów zostaje w `phone_verifications` (sygnał dla F-36).
- **SMS:** adapter `SmsSender` (ADR-7) w `infra/sms`: SMSAPI (`SMSAPI_TOKEN`, na produkcji wymagany) albo atrapa lokalnie i w testach (kod w logu API, wiadomości w pamięci dla testów). Wysyłka synchroniczna w żądaniu, bez kolejki: kod żyje 5 minut, więc ponawianie w workerze nie ma sensu, a użytkownik od razu widzi błąd dostawcy (503 `SERVICE_UNAVAILABLE`, może spróbować ponownie).
- **Treść SMS-a** bez polskich znaków (jeden segment GSM-7, 160 znaków, zamiast 70 w UCS-2) i z linią WebOTP `@biddy.pl #123456` (autouzupełnianie kodu w przeglądarkach na Androidzie): `Biddy: Twoj kod weryfikacyjny to 123456. Wazny 5 minut. Nie podawaj go nikomu.`
- **Oświadczenie 18+:** `POST /v1/me/terms-acceptances` przyjmuje `{ adultDeclaration: true }` i zapisuje `is_adult_declared_at` (F-07 pytało o 18+ w formularzu, ale go nie zapisywało). Rejestracja e-mailem zapisuje je jak dotąd.
- **Guard `@RequireVerifiedPhone()`:** sesja (401), konto niezablokowane (403), potwierdzony e-mail (403 `EMAIL_NOT_VERIFIED`), oświadczenie 18+ (403 `TERMS_NOT_ACCEPTED`), zweryfikowany telefon (403 `PHONE_NOT_VERIFIED`). Licytowanie (F-15) i wystawianie (F-14) używają go zamiast `@RequireVerifiedEmail()`.
- **Dane konta:** `GET /v1/me` i `GET /v1/session` dostają `phoneNumber` / `phoneVerified`.
- **Seed:** konta testowe mają zweryfikowane numery (kupujący `+48500000001`, sprzedający `+48500000002`, admin `+48500000003`); SMS-y na nie nie są wysyłane.
- **Sprzątanie:** job cykliczny co godzinę usuwa niepotwierdzone weryfikacje starsze niż 24 h.
- **Web:** ekran `/weryfikacja-telefonu` (numer → kod), sekcja „Telefon” na `/konto`.

## Poza zakresem

- Ustawienie numeru przez support i odblokowanie numeru zajętego przez porzucone konto (panel admina F-34; do tego czasu ręcznie w bazie).
- Numery spoza Polski (po starcie, jeśli pojawi się potrzeba; wtedy z limitem kosztów per kraj).
- Weryfikacja wieku dokumentem albo przez operatora płatności (KYC sprzedawcy w F-23); F-08 zbiera oświadczenie.
- SMS-y powiadomień (F-20).
- Ekran w aplikacji mobilnej (Faza 4); API obsługuje token Bearer.

## UX

**Weryfikacja telefonu (`/weryfikacja-telefonu`):**

```
┌──────────────────────────────────────┐
│ Zweryfikuj numer telefonu            │
│ Licytować i wystawiać można po       │
│ weryfikacji. Jeden numer = 1 konto.  │
│ Numer telefonu                       │
│ [ 500 600 700                    ]   │
│ [ Wyślij kod ]                       │
└──────────────────────────────────────┘
          ↓ po wysłaniu
┌──────────────────────────────────────┐
│ Wpisz kod z SMS-a                    │
│ Wysłaliśmy kod na +48 500 600 700.   │
│ Kod (6 cyfr) [ ______ ]              │
│ [ Potwierdź ]                        │
│ Wyślij ponownie (za 42 s) · Zmień nr │
└──────────────────────────────────────┘
```

Pole kodu: `inputmode="numeric"`, `autocomplete="one-time-code"` (iOS podpowiada kod z SMS-a). Po sukcesie powrót pod `?next=` (domyślnie `/konto`).

**Konto (`/konto`):** sekcja „Telefon”: numer i „zweryfikowany” z linkiem „Zmień numer” albo „niezweryfikowany: zweryfikuj, żeby licytować i wystawiać” z przyciskiem „Zweryfikuj numer”.

**Stany:**

| Ekran | Ładowanie | Błąd | Sukces |
|---|---|---|---|
| Numer | „Wysyłanie…” | błąd pola (`aria-describedby`): zły numer, numer zajęty; komunikat (`role="alert"`): limit („spróbuj za N min”), awaria SMS | krok kodu |
| Kod | „Sprawdzanie…” | błąd pola: zły kod z liczbą pozostałych prób; kod wygasł → komunikat i „Wyślij nowy kod” | przejście pod `next` |
| Strona bez sesji | SSR | przekierowanie na `/logowanie?next=/weryfikacja-telefonu` | — |
| Niepotwierdzony e-mail | SSR | komunikat „Najpierw potwierdź adres e-mail” z linkiem do konta | — |

## Model danych

Migracja `0003_phone_verification` (moduł `identity`):

- `users`: `phone_number` (E.164, unikalny, null bez weryfikacji), `phone_number_verified_at`; check: oba null albo oba ustawione.
- `phone_verifications`: `id`, `user_id` → `users` (FK, kaskada), `phone_number`, `code_hash`, `ip`, `attempts`, `expires_at`, `verified_at`, `created_at`. Indeksy: (`user_id`, `created_at`), (`phone_number`, `created_at`), (`ip`, `created_at`).

## API i zdarzenia

- `POST /v1/me/phone-verification` `{ phoneNumber }` → 201 `{ phoneNumber, expiresAt, resendAvailableAt }`; wysyła SMS.
- `POST /v1/me/phone-verification/confirm` `{ code }` → 200 `{ phoneNumber, verifiedAt }`.
- `POST /v1/me/terms-acceptances` `{ adultDeclaration: true }` → 204 (zmiana: wymagana treść).
- `GET /v1/me`: + `phoneNumber` (E.164 albo null), `phoneVerified`. `GET /v1/session`: + `phoneVerified`.
- Nowe kody błędów: `PHONE_NOT_VERIFIED` (403), `PHONE_NUMBER_TAKEN` (409), `PHONE_CODE_INVALID` (400, rozszerzenie `remainingAttempts`), `PHONE_CODE_EXPIRED` (400). Zły format numeru: 400 `VALIDATION_FAILED` z błędem pola `phoneNumber`.
- Eventy domenowe: brak (pierwszy konsument, F-36, doda `PhoneVerified`).

## Reguły biznesowe i przypadki brzegowe

- Numer już zweryfikowany na tym samym koncie: 409 `CONFLICT` (bez SMS-a).
- Potwierdzenie bez aktywnego kodu (nie wysłano, wygasł, 5 prób, nowszy kod): 400 `PHONE_CODE_EXPIRED`.
- Wyścig dwóch kont o ten sam numer rozstrzyga unikalny indeks: drugie potwierdzenie dostaje 409 `PHONE_NUMBER_TAKEN`.
- Limity liczą się w oknach przesuwnych; `Retry-After` to czas do zwolnienia miejsca w najbardziej restrykcyjnym limicie.
- Limity sprawdzamy przed zapisem bez blokady, więc dwa równoległe żądania mogą przekroczyć limit o jeden SMS. Akceptujemy to (koszt jednego SMS-a); blokadę doradczą dodamy, jeśli pojawią się nadużycia.
- Konto zablokowane (`BANNED`): 403 na wszystkich trasach z sesją (F-07).

## Bezpieczeństwo i prywatność

- Kod w bazie tylko jako HMAC; porównanie w czasie stałym (`timingSafeEqual`).
- Numer telefonu to dane osobowe: widoczny tylko dla właściciela (`/v1/me`) i panelu admina. Nie trafia do logów poza atrapą SMS-ów lokalnie. W Sentry tylko ID użytkownika.
- `SMSAPI_TOKEN` tylko w zmiennych środowiskowych; na produkcji wymagany (bez niego API nie startuje, żeby nie wysyłać „atrapą”).
- Retencja: historia weryfikacji razem z kontem (F-41).
- Formularze kont w web wysyłają się metodą POST, jeśli użytkownik zatwierdzi je przed załadowaniem JavaScriptu (wolne łącze). Natywne wysłanie metodą GET wstawiłoby numer telefonu (a w F-07 e-mail i hasło) do adresu URL, historii przeglądarki i logów.

## Analityka

PostHog (po zgodzie): `phone_verification_started`, `phone_verified`.

## Kryteria akceptacji

- [x] Given numer zweryfikowany na koncie A, When konto B próbuje go zweryfikować, Then dostaje 409 `PHONE_NUMBER_TAKEN` bez wysłania SMS-a.
- [x] Given 3 SMS-y na numer w ostatniej godzinie, When kolejna wysyłka, Then 429 z `Retry-After`; limit per IP (10/h) działa także dla różnych numerów i kont.
- [x] Given kod starszy niż 5 minut albo 5 błędnych prób, When potwierdzenie, Then 400 `PHONE_CODE_EXPIRED`; błędna próba zwraca `PHONE_CODE_INVALID` z liczbą pozostałych prób.
- [x] Given konto bez zweryfikowanego telefonu, When wywołuje trasę z `@RequireVerifiedPhone()`, Then 403 `PHONE_NOT_VERIFIED`; po weryfikacji trasa działa.
- [x] Given konto z Google po akceptacji regulaminu z 18+, Then `is_adult_declared_at` jest zapisane; bez oświadczenia trasa z `@RequireVerifiedPhone()` zwraca `TERMS_NOT_ACCEPTED`.
- [x] Given `pnpm db:reset`, Then konta testowe mają zweryfikowane numery i mogą licytować.

## Plan testów

- **API, jednostkowe:** normalizacja numerów (polskie komórkowe, stacjonarne, zagraniczne, formaty), treść SMS-a (ASCII, ≤ 160 znaków, linia WebOTP), decyzja limitów (czysta funkcja), HMAC kodu, adapter SMSAPI (format żądania, błędy), konfiguracja.
- **API, integracyjne:** pełna ścieżka (wysyłka → atrapa SMS → potwierdzenie → `/v1/me` → trasa z guardem), zły kod i limit prób, wygaśnięcie, numer zajęty (wysyłka i wyścig przy potwierdzeniu), limity numeru, IP i odstępu, wymagany e-mail, 18+ przy akceptacji regulaminu, seed, sprzątanie.
- **Web, jednostkowe:** formularz numeru i kodu (walidacja, błędy z API, odliczanie ponownej wysyłki).
- **Web, e2e:** `/weryfikacja-telefonu` na atrapie API (numer → zły i dobry kod → konto), wymagany e-mail i sesja, sekcja telefonu na `/konto`, limit wysyłki, axe-core na obu krokach; formularz logowania wysłany bez JavaScriptu nie wstawia danych do adresu.
- **Kontrakt:** pole tekstowe z `null` zapisane samym `z.string().nullable()` przerywa budowę dokumentu OpenAPI (w kliencie byłoby `string[]`).

## Otwarte pytania

- Pole nadawcy SMS „Biddy” wymaga rejestracji w SMSAPI: **domyślnie** `SMSAPI_SENDER` pusty (domyślny nadawca konta SMSAPI) do czasu rejestracji nazwy (F-09).
- Koszt SMS-ów: **domyślnie** limity jak wyżej; po starcie monitoring liczby wysyłek dziennie (alert w F-09/F-34).
