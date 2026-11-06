# F-27 · Saldo i wypłaty

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-22 (ledger), F-23 (port płatności), F-26 (zakończenie zamówienia), F-61 (blokady wypłat)

## Kontekst i cel

Po F-26 zakończone zamówienie zwalnia cenę na `seller_balance_available` w ledgerze ([PROJECT.md §7.7](../PROJECT.md#77-księga-ledger)), ale pieniądze zostają w Biddy:

- sprzedający nie widzi salda ani historii;
- nie ma wypłat: tabeli, zlecenia u operatora, obsługi webhooków `PAYOUT_PAID` i `PAYOUT_FAILED`;
- nie zbieramy danych DAC7 ani rachunku bankowego;
- saldo poniżej minimum może utknąć na zawsze, a tego zakazuje decyzja z [§7.6](../PROJECT.md#76-operator-płatności) (lekcja z Vinted).

Szablony księgowań wypłat (`PAYOUT_REQUESTED`, `PAYOUT_COMPLETED`, `PAYOUT_FAILED`) są w ledgerze od F-22, a `createPayout` w porcie i FakeGateway od F-23. F-27 składa z nich:

- onboarding wypłat niezależny od operatora: dane osobowe do DAC7 i rachunek bankowy, zaszyfrowane w bazie;
- widok salda (dostępne, w trakcie, należność, wypłaty w drodze) z historią;
- wypłatę na żądanie (minimum 20 zł) i opcjonalną wypłatę tygodniową;
- automatyczną wypłatę salda poniżej minimum po 90 dniach bez sprzedaży i przy zamknięciu konta;
- blokadę wypłat do spłaty należności, przy blokadzie konta (F-61) i na 48 h po zmianie rachunku, z powiadomieniem.

Cel: sprzedający w każdej chwili wie, ile ma pieniędzy i kiedy je dostanie, a wypłata nigdy nie przekracza salda w ledgerze.

## Historyjki użytkownika

- Jako sprzedający widzę saldo dostępne, kwotę „w trakcie” (otwarte zamówienia) i historię ruchów z linkami do zamówień.
- Jako sprzedający raz podaję dane do wypłat (imię, nazwisko, data urodzenia, adres, PESEL albo NIP, rachunek) i wiem, po co są.
- Jako sprzedający wypłacam saldo jednym przyciskiem, gdy ma co najmniej 20 zł, i widzę, kiedy wypłata dotrze.
- Jako sprzedający włączam wypłatę tygodniową i nie muszę o niej pamiętać.
- Jako sprzedający z małym saldem i bez sprzedaży od 90 dni dostaję je automatycznie na rachunek.
- Jako sprzedający po zmianie rachunku dostaję powiadomienie, a wypłaty czekają 48 h, więc ktoś z dostępem do konta nie wypłaci moich pieniędzy na swój rachunek.
- Jako sprzedający z należnością widzę jej kwotę i wiem, że spłacę ją z kolejnych sprzedaży.

## Zakres

### Dane do wypłat (moduł `payments`)

Nowa tabela `seller_payout_profiles`, jeden wiersz na użytkownika, niezależny od operatora (konto u operatora w `seller_accounts` jest per operator i powstaje przy rejestracji, F-23/F-32).

**Dane osobowe (DAC7, [§17](../PROJECT.md#17-prawo-i-compliance)):**

- imię, nazwisko, data urodzenia;
- adres zamieszkania: ulica z numerem, kod pocztowy, miejscowość, kraj (w MVP `PL`);
- identyfikator podatkowy: PESEL albo NIP (osoba z działalnością), kraj rezydencji podatkowej `PL`.

Walidacja: suma kontrolna PESEL i NIP, data urodzenia zgodna z PESEL, wiek co najmniej 18 lat (regulamin). Całość zapisujemy jako jeden zaszyfrowany blok.

**Rachunek bankowy:** polski IBAN (`PL` + 26 cyfr, suma kontrolna mod 97) i właściciel rachunku. Zaszyfrowany blok plus jawna wersja maskowana do wyświetlania (`•••• 1234`).

**Szyfrowanie:** AES-256-GCM, klucz 32 bajty z nowej zmiennej `DATA_ENCRYPTION_KEY` (base64). Na produkcji i stagingu (`NODE_ENV=production`) zmienna jest wymagana; lokalnie i w testach jest stały klucz deweloperski. Szyfrogram ma bajt wersji klucza, żeby dało się dodać rotację. Klucza nie wyprowadzamy z `BETTER_AUTH_SECRET`: rotacja sekretu sesji nie może zniszczyć danych DAC7 (decyzja nr 122).

**Zmiana rachunku:**

- pierwszy rachunek: bez blokady (wypłata i tak wymaga KYC u operatora, F-32);
- zmiana numeru: `payouts_blocked_until = now + 48 h`;
- każdy zapis rachunku (pierwszy i zmiana) wysyła powiadomienie w aplikacji i e-mailem, z maskowanym numerem i terminem blokady;
- zmiana samego właściciela rachunku przy tym samym numerze nie blokuje wypłat.

### Wypłaty (moduł `payments`)

Nowa tabela `payouts`. Źródło wypłaty (`trigger`): `MANUAL`, `WEEKLY`, `DORMANT_BALANCE`, `ACCOUNT_CLOSURE`.

**Zlecenie (`PayoutService.request`)** w jednej transakcji:

1. Blokada wiersza `seller_payout_profiles` (`FOR UPDATE`), więc zlecenia jednego sprzedającego idą po kolei.
2. Warunki (każdy ma kod błędu 409):
   - komplet danych do wypłat (`PAYOUT_PROFILE_INCOMPLETE`);
   - brak blokady po zmianie rachunku (`PAYOUTS_ON_HOLD` z terminem);
   - brak aktywnej blokady wypłat z F-61 (`PAYOUTS_BLOCKED` z terminem i ID blokady);
   - konto u operatora ze statusem `VERIFIED` (`SELLER_NOT_VERIFIED`; pełne KYC w F-32);
   - brak należności (`RECEIVABLE_OUTSTANDING` z kwotą);
   - kwota ≤ saldo dostępne w ledgerze (`INSUFFICIENT_BALANCE`);
   - kwota ≥ 20 zł przy `MANUAL` i `WEEKLY` (`PAYOUT_BELOW_MINIMUM`).
3. Wiersz `payouts` (`PENDING`) z kluczem idempotencji, księgowanie `PAYOUT_REQUESTED` i event `PayoutRequested`.

Księgowanie blokuje konto `seller_balance_available` i odrzuca ujemne saldo (`INSUFFICIENT_FUNDS` → 409 `INSUFFICIENT_BALANCE`), więc równoległe żądania nigdy nie wypłacą więcej niż saldo, nawet z pominięciem blokady profilu. **Saldo zawsze bierzemy z ledgera**, nie od operatora (§7.8, model `SELLER_BALANCE`).

Kwota domyślnie to całe saldo dostępne. Klucz idempotencji wypłaty na żądanie pochodzi z nagłówka `Idempotency-Key` (jak przy ofertach), więc podwójne kliknięcie nie robi drugiej wypłaty.

**Wykonanie:** konsument `payments.execute-payout` (event `PayoutRequested`) woła `createPayout` z kluczem `payout:{id}` i zapisuje ID wypłaty u operatora:

- `SELLER_NOT_VERIFIED`, `INSUFFICIENT_BALANCE` albo `INVALID_REQUEST` od operatora: wypłata `FAILED` od razu, z księgowaniem `PAYOUT_FAILED` (środki wracają na saldo);
- `UNAVAILABLE` i inne błędy: konsument rzuca, a outbox ponawia z tym samym kluczem.

**Wynik:** webhook `PAYOUT_PAID` → `PAYOUT_COMPLETED`, stan `PAID`, event `PayoutPaid`. `PAYOUT_FAILED` → `PAYOUT_FAILED` (najpierw spłata należności), stan `FAILED`, event `PayoutFailed`. Wypłata w stanie końcowym ignoruje kolejne zdarzenia, a nieznana wypłata kończy się błędem 500 (operator ponowi webhook).

### Wypłaty automatyczne (moduł `payments`)

- **Tygodniowa** (`payments.weekly-payouts`, poniedziałek 6:00 czasu polskiego): sprzedający z włączonym przełącznikiem i saldem dostępnym ≥ 20 zł dostają wypłatę całego salda. Klucz `weekly:{userId}:{rok-tydzień}`. Niespełniony warunek (blokada, brak danych) oznacza pominięcie z wpisem w logach.
- **Saldo uśpione** (`payments.dormant-balances`, codziennie 4:00): sprzedający z saldem dostępnym od 0,01 do 19,99 zł, bez otwartych zamówień ze wstrzymanymi środkami i bez sprzedaży od 90 dni dostają wypłatę całości bez minimum. „Sprzedaż” to księgowanie `ORDER_COMPLETED` albo `ORDER_PARTIALLY_REFUNDED` na saldzie sprzedającego. Klucz `dormant:{userId}:{data}`. Bez danych do wypłat pomijamy, a widok salda prosi o ich uzupełnienie.
- **Zamknięcie konta:** `PayoutService.payOutOnClosure(userId)` wypłaca całe saldo bez minimum (`ACCOUNT_CLOSURE`). Wywoła je usunięcie konta (F-41). F-27 daje metodę i test.

### Widok salda (moduł `orders`)

`GET /v1/me/balance` i `GET /v1/me/balance/history` żyją w module `orders`, bo łączą ledger, wypłaty i tytuły zamówień, a `payments` nie zależy od `orders` (decyzja nr 123).

**Salda (z ledgera, `LedgerService.sellerBalances`):** dostępne, w trakcie, należność, wypłaty w drodze.

**W trakcie:** zamówienia opłacone, wysłane i odebrane (numer, tytuł, cena, stan) i suma ich cen.

**Wypłata:** czy można wypłacić teraz, a jeśli nie, to dlaczego (ten sam kod co przy zleceniu), minimum, blokada do, przełącznik tygodniowy, maskowany rachunek.

**Historia** (`LedgerService.sellerHistory`): transakcje ledgera na saldzie dostępnym albo należności sprzedającego, od najnowszej, 20 na stronę z kursorem. Każda pozycja ma typ, datę, zmianę salda dostępnego i należności, zamówienie (numer, tytuł) albo wypłatę (stan, maskowany rachunek).

### Powiadomienia (moduł `notifications`)

Transakcyjne (bez wyłączania), w aplikacji i e-mailem:

- `PAYOUT_PAID`: „Wypłata {kwota} wysłana na rachunek •••• 1234.” Przy wypłacie automatycznej dochodzi powód.
- `PAYOUT_FAILED`: „Wypłata {kwota} nie powiodła się. Pieniądze wróciły na saldo.”
- `PAYOUT_ACCOUNT_CHANGED`: „Rachunek do wypłat zmieniony na •••• 1234. Wypłaty ruszą {data}. Jeśli to nie Ty, zmień hasło i napisz do nas.” Przy pierwszym rachunku bez zdania o blokadzie.

### Web

- `/konto/saldo` (Saldo i wypłaty): kafle sald, wypłata, wypłata tygodniowa, lista „W trakcie”, historia.
- `/konto/saldo/dane` (Dane do wypłat): dwa formularze, dane osobowe i rachunek.
- Skrót „Saldo i wypłaty” na stronie konta (sekcja sprzedaży) z saldem dostępnym w opisie.
- Strona zamówienia sprzedającego `COMPLETED`: „{cena} jest na Twoim saldzie” linkuje do `/konto/saldo`.

## Poza zakresem

- **KYC u operatora** (rejestracja, dokumenty, przekierowanie) i przekazanie rachunku operatorowi: F-31 i F-32. Do tego czasu wypłata wymaga konta u operatora ze statusem `VERIFIED` (FakeGateway domyślnie weryfikuje od razu).
- **Potwierdzenie zmiany rachunku linkiem w e-mailu** (§16.1): zostaje blokada 48 h i powiadomienie; link z 2FA w v1 (otwarte pytanie).
- **Raport DAC7** dla Szefa KAS (v1) i weryfikacja NIP/PESEL w rejestrach.
- **Usunięcie konta** (F-41): F-27 daje tylko `payOutOnClosure`.
- **Panel finansów** (F-34): ręczne wypłaty, odblokowanie, nieudane wypłaty.
- **Rotacja klucza szyfrowania:** format jest na nią gotowy (bajt wersji), ale ponowne szyfrowanie danych to osobne zadanie.
- **Sprzedawcy firmowi** (v2): NIP przyjmujemy tylko od osób prywatnych z działalnością, bez danych firmy.

## UX

Układ jak strona limitów konta (F-61, F-63): tło `canvas`, kontener `max-w-page`, karty.

**`/konto/saldo`:**

- **Nagłówek:** link „Konto”, h1 „Saldo i wypłaty”.
- **Kafle** (siatka 2×2, na telefonie jeden pod drugim):
  - „Do wypłaty” (duża kwota, ton pozytywny);
  - „W trakcie”: „Trafi na saldo po zakończeniu zamówień”;
  - „Wypłaty w drodze”, tylko gdy > 0;
  - „Do spłaty”, tylko gdy > 0, ton ostrzegawczy: „Spłacimy to z kolejnych sprzedaży. Do tego czasu wypłaty są wstrzymane.”
- **Karta „Wypłata”:**
  - bez danych do wypłat: „Żeby wypłacić pieniądze, podaj dane do wypłat. Wymagają ich przepisy podatkowe (DAC7).” → „Uzupełnij dane”;
  - z danymi: pole kwoty (domyślnie całe saldo, minimum 20 zł), przycisk „Wypłać {kwota}” i rachunek „na rachunek •••• 1234 · Zmień”;
  - przy blokadzie: zdanie z przyczyną i terminem („Po zmianie rachunku wypłaty ruszą 4 listopada, 14:02.”), przycisk nieaktywny;
  - poniżej minimum: „Minimalna wypłata to 20 zł. Mniejsze saldo wypłacimy automatycznie po 90 dniach bez sprzedaży.”;
  - po zleceniu: komunikat `role="status"` „Zleciliśmy wypłatę {kwota}. Pieniądze dotrą zwykle w 1–2 dni robocze.”
- **Przełącznik „Wypłata co tydzień”:** „W każdy poniedziałek wypłacimy całe saldo, jeśli ma co najmniej 20 zł.”
- **W trakcie:** lista zamówień z linkiem, ceną i pigułką stanu.
- **Historia:** lista z datą, opisem i kwotą ze znakiem (zielona przy uznaniu):
  - „Sprzedaż · Wazon ceramiczny” +100 zł;
  - „Wypłata na •••• 1234” −100 zł z pigułką „W drodze”, „Wysłana” albo „Nieudana”;
  - „Zwrot nieudanej wypłaty” +100 zł;
  - „Rekompensata za zaginioną paczkę”, „Koszty sporu”, „Korekta”.
  - Przycisk „Pokaż starsze”, gdy jest kursor. Pusta historia: „Tu zobaczysz sprzedaże i wypłaty.”

**`/konto/saldo/dane`:**

- wstęp: „Te dane są potrzebne do wypłat i raportu dla urzędu skarbowego (DAC7). Szyfrujemy je i nie pokazujemy innym.”;
- **„Dane osobowe”:** imię, nazwisko, data urodzenia, PESEL albo NIP (wybór), adres (ulica, kod, miejscowość); przy zapisanych danych identyfikator jest zamaskowany i trzeba go podać ponownie przy zmianie;
- **„Rachunek do wypłat”:** numer rachunku (formatowany w grupach po 4), właściciel; przy zmianie ostrzeżenie: „Po zmianie rachunku wypłaty będą wstrzymane przez 48 godzin.”;
- błędy pól pod polami (`aria-describedby`), błędy zapisu w `role="alert"`.

Teksty po polsku i neutralne płciowo.

## Model danych

Migracja `0021_payouts`. Kwoty w groszach (`bigint`), czasy `timestamptz`.

**`seller_payout_profiles`** (moduł `payments`):

| Kolumna | Opis |
|---|---|
| `user_id` | PK; użytkownik (moduł `identity`, bez FK) |
| `personal_data` | `bytea`, zaszyfrowany JSON danych DAC7; null do pierwszego zapisu |
| `personal_data_updated_at` | ostatni zapis danych osobowych |
| `bank_account` | `bytea`, zaszyfrowany JSON `{ iban, holderName }` |
| `bank_account_masked` | np. `•••• 1234`; razem z `bank_account` |
| `bank_account_changed_at` | ostatni zapis rachunku |
| `payouts_blocked_until` | koniec blokady po zmianie rachunku |
| `weekly_payouts` | wypłata tygodniowa, domyślnie `false` |
| `created_at`, `updated_at` | |

**`payouts`** (moduł `payments`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `seller_id` | sprzedający |
| `provider`, `provider_payout_id` | operator i ID wypłaty u niego (null do odpowiedzi) |
| `currency`, `amount` | kwota > 0 |
| `trigger` | `MANUAL`, `WEEKLY`, `DORMANT_BALANCE`, `ACCOUNT_CLOSURE` |
| `status` | `PENDING`, `PAID`, `FAILED` |
| `failure_reason` | `REJECTED`, `SELLER_NOT_VERIFIED`, `INSUFFICIENT_BALANCE`, `INVALID_REQUEST`; tylko przy `FAILED` |
| `bank_account_masked` | rachunek w chwili zlecenia |
| `idempotency_key` | unikalny, np. `manual:{userId}:{nagłówek}` |
| `paid_at`, `failed_at`, `created_at`, `updated_at` | |

Unikalne `(provider, provider_payout_id)`, indeks `(seller_id, created_at)`. CHECK: `failure_reason` tylko przy `FAILED`, `paid_at` tylko przy `PAID`.

## API i zdarzenia

### REST

Wszystkie trasy wymagają sesji, odpowiedzi `cache-control: private, no-store`.

| Metoda i ścieżka | Opis |
|---|---|
| `GET /v1/me/balance` | `SellerBalanceDto`: salda, „w trakcie”, stan wypłat |
| `GET /v1/me/balance/history?cursor=` | `BalanceHistoryDto`: 20 pozycji i `nextCursor` |
| `POST /v1/me/payouts` | `{ amount? }` + nagłówek `Idempotency-Key`; 201 `PayoutDto`; 409 z kodami z „Zlecenia” |
| `GET /v1/me/payout-profile` | `PayoutProfileDto`: dane osobowe (identyfikator zamaskowany), rachunek maskowany, komplet, blokada |
| `PUT /v1/me/payout-profile/personal-data` | zapis danych DAC7; 400 `VALIDATION_FAILED` z błędami pól |
| `PUT /v1/me/payout-profile/bank-account` | zapis rachunku; 400 przy złym IBAN |
| `PATCH /v1/me/payout-settings` | `{ weeklyPayouts }` |

### Eventy (outbox, wersja 1)

Moduł `payments`:

- `PayoutRequested` (agregat `payout`): `sellerId`, `amount`, `trigger`;
- `PayoutPaid`: `sellerId`, `amount`, `trigger`, `bankAccountMasked`;
- `PayoutFailed`: `sellerId`, `amount`, `trigger`, `reason`;
- `PayoutAccountChanged` (agregat `seller-payout-profile`): `userId`, `bankAccountMasked`, `first`, `payoutsBlockedUntil`.

### Joby

Kolejka `payments`:

- `payments.weekly-payouts`: cron `0 6 * * 1`;
- `payments.dormant-balances`: cron `0 4 * * *`.

## Reguły biznesowe i przypadki brzegowe

- **Ledger jest jedynym źródłem salda.** Saldo u operatora (w modelu `SELLER_BALANCE` są tam też środki niezakończonych zamówień) nie decyduje o wypłacie.
- **Równoległe żądania:** blokada profilu porządkuje zlecenia jednego sprzedającego, a blokada konta w ledgerze i CHECK salda są drugą barierą.
- **Należność i saldo** nigdy nie są jednocześnie dodatnie (F-22), więc przy należności saldo dostępne wynosi 0. Kod `RECEIVABLE_OUTSTANDING` tłumaczy powód zamiast mylącego „brak środków”.
- **Blokada F-61** (`PAYOUTS`, np. podróbka) wstrzymuje też wypłaty automatyczne, także przy zamknięciu konta.
- **Nieudana wypłata** zwraca środki na saldo (najpierw spłata należności) i nie blokuje kolejnej. Wypłata uśpionego salda z nieudanym wynikiem wróci następnego dnia z nowym kluczem.
- **Wypłata tygodniowa** nie dubluje się w tym samym tygodniu (klucz z numerem tygodnia ISO), także po restarcie workera.
- **Zmiana rachunku w trakcie wypłaty** nie zmienia wypłaty już zleconej: ma ona maskowany rachunek z chwili zlecenia.
- **Waluta:** w MVP tylko PLN (saldo i wypłaty w jednej walucie).

## Bezpieczeństwo i prywatność

- Dane DAC7 i pełny IBAN są w bazie tylko zaszyfrowane (AES-256-GCM z uwierzytelnieniem). Klucz jest poza repo (env), a logi nie zawierają danych osobowych ani numeru rachunku.
- API zwraca właścicielowi dane osobowe bez pełnego identyfikatora (np. `•••••••0123`) i rachunek tylko maskowany. Pełne wartości nie wracają do przeglądarki.
- Zmiana rachunku: blokada 48 h i powiadomienie e-mailem i w aplikacji (§16.1).
- Trasy `/me/*` widzą tylko dane zalogowanej osoby.

## Analityka

PostHog (za zgodą, F-06), bez kwot i danych osobowych:

- `payout_profile_completed`;
- `payout_requested` (źródło: ręczna);
- `weekly_payouts_toggled` (włączona/wyłączona).

## Kryteria akceptacji

- [x] Given saldo dostępne 50 zł, When przychodzą równolegle dwa żądania wypłaty po 40 zł, Then udaje się jedno, drugie kończy się 409 `INSUFFICIENT_BALANCE`, a ledger ma jedną transakcję `PAYOUT_REQUESTED` (test integracyjny).
- [x] Given wypłata zlecona, When operator potwierdza ją webhookiem, Then wypłata jest `PAID`, `payouts_in_transit` wynosi 0, a sprzedający dostaje powiadomienie; nieudana wypłata wraca na saldo dostępne.
- [x] Given zapisany rachunek, When sprzedający zmienia numer, Then wypłaty są wstrzymane na 48 h (409 `PAYOUTS_ON_HOLD` z terminem) i powstaje powiadomienie `PAYOUT_ACCOUNT_CHANGED` w aplikacji i e-mailem.
- [x] Given zapisane dane DAC7 i rachunek, Then kolumny w bazie nie zawierają jawnego PESEL, nazwiska ani IBAN, a API zwraca identyfikator i rachunek zamaskowane.
- [x] Given saldo 12 zł i ostatnia sprzedaż 91 dni temu, When działa job sald uśpionych, Then powstaje wypłata 12 zł (`DORMANT_BALANCE`); przy sprzedaży 89 dni temu albo otwartym zamówieniu wypłaty nie ma.
- [x] Given saldo poniżej 20 zł, When sprzedający zleca wypłatę, Then dostaje 409 `PAYOUT_BELOW_MINIMUM`; przy zamknięciu konta `payOutOnClosure` wypłaca całość.
- [x] Given należność albo blokada wypłat z F-61, Then wypłata kończy się 409 (`RECEIVABLE_OUTSTANDING`, `PAYOUTS_BLOCKED`), a widok salda pokazuje przyczynę.
- [x] Given włączona wypłata tygodniowa i saldo ≥ 20 zł, When działa job tygodniowy dwa razy w tym samym tygodniu, Then powstaje jedna wypłata całego salda.
- [x] Given web na atrapie API, Then sprzedający uzupełnia dane, wypłaca saldo i widzi historię; axe bez naruszeń WCAG 2.1 AA, bez poziomego przewijania przy 390 px.

## Plan testów

- **Jednostkowe (shared):** IBAN (suma kontrolna, formatowanie, maska), PESEL (suma, data urodzenia), NIP, minimum wypłaty.
- **Jednostkowe (api):** szyfr danych (szyfrowanie, odczyt, zmieniony szyfrogram, zły klucz), warunki wypłaty (kolejność kodów), klucz tygodnia ISO.
- **Integracyjne (Postgres, Redis):**
  - profil: zapis danych i rachunku, szyfrogram w bazie, maski w API, blokada 48 h tylko przy zmianie numeru, event i powiadomienie;
  - wypłata: warunki 409, idempotencja nagłówka, równoległe żądania, konsument (sukces, odrzucenie przez operatora), webhook `PAYOUT_PAID` i `PAYOUT_FAILED` z ledgerem;
  - job tygodniowy (dwa uruchomienia, warunki pominięcia) i job sald uśpionych (90 dni, otwarte zamówienie, brak danych);
  - `payOutOnClosure` bez minimum;
  - `GET /v1/me/balance` i historia z kursorem (sprzedaż, wypłata, nieudana wypłata).
- **Web (Vitest, Testing Library):** kafle i stany karty wypłaty (bez danych, blokada, minimum, należność), zlecenie wypłaty, przełącznik tygodniowy, historia z „Pokaż starsze”, formularze danych z walidacją.
- **E2E (Playwright, atrapa API):** uzupełnienie danych, wypłata i historia; axe, 390 px.

## Postęp i odstępstwa (2026-11-03)

Gotowe:

- migracja `0021_payouts` (`seller_payout_profiles`, `payouts`), szyfr danych `DataCipher` w `infra/crypto` i zmienna `DATA_ENCRYPTION_KEY` (szablony env, Dokploy, Render, smoke test obrazu);
- `PayoutProfileService`, `PayoutService` (zlecenie, konsument `payments.execute-payout`, webhooki, joby `payments.weekly-payouts` i `payments.dormant-balances`, `payOutOnClosure`), trasy `/v1/me/payout-profile*`, `/v1/me/payout-settings`, `/v1/me/payouts`;
- `LedgerService.sellerHistory` i `dormantSellerBalances`, widok salda `SellerBalanceService` w module `orders`;
- 3 typy powiadomień z grupą „Saldo i wypłaty” w ustawieniach;
- strony `/konto/saldo` i `/konto/saldo/dane`, skrót na stronie konta, link do salda przy zakończonym zamówieniu.

Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 122–127.

Odstępstwa:

- **„W trakcie” w widoku** to suma cen zamówień `PAID`, `SHIPPED` i `DELIVERED`, a nie całe `buyer_funds_held` z ledgera: zamówienia w drodze do zwrotu (nienadane, nieodebrane, zaginione) nie trafią na saldo, więc ich nie pokazujemy (decyzja nr 123).
- **Kolejność powodów blokady:** blokada F-61, brak danych, 48 h po zmianie rachunku, należność, saldo, minimum, na końcu KYC (sprzedający najpierw widzi to, co może zmienić sam).
- **`PAYOUTS_BLOCKED` to 409**, a nie 403 jak `BIDDING_BLOCKED`: to stan konta wobec wypłaty, z tym samym kształtem odpowiedzi (`blockedUntil`, `blockId`).
- **Wypłata całego salda** wysyła żądanie bez kwoty (API bierze saldo z ledgera pod blokadą), a potwierdzenie zostaje na karcie także wtedy, gdy po odświeżeniu salda karta pokazuje „brak środków”.
- **Klucz szyfrowania** jest wymagany na produkcji i stagingu w API i workerze (`NODE_ENV=production`). Przed wdrożeniem trzeba go dodać w Dokploy.
- **Potwierdzenie zmiany rachunku linkiem w e-mailu** (§16.1) nie powstało: blokada 48 h i powiadomienie (decyzja nr 125).

## Otwarte pytania

- **Potwierdzenie zmiany rachunku linkiem w e-mailu** (§16.1): czy blokada 48 h z powiadomieniem wystarczy do v1 (2FA)?
- **Wypłata uśpionego salda bez danych do wypłat:** kiedy (i czy) przypominać e-mailem? Na razie tylko komunikat w widoku salda.
- **Właściciel rachunku a dane osobowe:** czy wymagać zgodności nazwiska (operator i tak sprawdzi przy KYC)?
