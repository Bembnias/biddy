# F-61 · Limity kont i strike'i

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-04 (outbox), F-07 (konta), F-14 i F-15 (guardy wystawiania i licytowania), F-20 (powiadomienia), F-25 (zamówienia opłacone i anulowane), F-24 (zwrot nieodebranej paczki)

## Kontekst i cel

[PROJECT.md §4.1](../PROJECT.md#41-limity-kont-i-strikei) opisuje poziomy kont z limitami oraz strike'i z blokadami. Po F-14 i F-15 kod ma na to tylko zaślepki:

- `BuyerStandingService` i `SellerStandingService` zawsze zwracają poziom „nowy”;
- limity są stałymi w `@biddy/shared`, a `BUYER_LIMITS` ma jeszcze stare wartości 500 i 3000 zł (decyzja nr 110 zmieniła je na 2500 i 5000 zł);
- blokady to kolumny `users.bidding_blocked_until` i `users.listing_blocked_until`, których nic nie ustawia;
- nie ma strike'ów, uzasadnień ani odwołań.

F-61 dodaje:

- poziomy liczone z historii zamówień;
- limity w konfiguracji zmienianej bez deployu, z nadpisaniami per użytkownik;
- tabelę strike'ów nadawanych przez system (konsumenci eventów) i personel;
- automatyczne blokady licytowania i wystawiania;
- widok „Limity i strike'i” z uzasadnieniami i odwołaniami.

Uzasadnienia i odwołania są wymogiem DSA (statement of reasons, wewnętrzny system rozpatrywania skarg).

Cel: nowe i nierzetelne konta mogą narobić mało szkód, a każda kara jest dla użytkownika zrozumiała i da się ją zakwestionować.

## Historyjki użytkownika

- Jako kupujący po pierwszym opłaconym zamówieniu mogę licytować do 5000 zł, a nie do 2500 zł.
- Jako kupujący widzę swój poziom, limity i to, co trzeba zrobić, żeby je podnieść.
- Jako kupujący, który nie zapłacił w terminie, dostaję strike z wyjaśnieniem: za co, kiedy wygaśnie i co będzie po trzecim.
- Jako kupujący z blokadą licytowania widzę, do kiedy trwa i dlaczego, i mogę się odwołać.
- Jako sprzedający, który anulował aukcję z ofertami, dostaję strike, a po trzecim w 90 dniach nie mogę wystawiać przez 30 dni.
- Jako kupujący, który zapłacił chwilę po terminie, nie mam strike'a za brak płatności (płatność wraca automatycznie, a strike jest cofany).
- Jako osoba z supportu cofam strike, np. gdy przewoźnik zawinił, i rozpatruję odwołania.
- Jako admin zmieniam limity w konfiguracji albo jednemu użytkownikowi bez deployu.

## Zakres

### Konfiguracja limitów i reguł (moduł `identity`)

**Polityka kont** (`AccountPolicy`, schemat `accountPolicySchema` i wartości domyślne `DEFAULT_ACCOUNT_POLICY` w `@biddy/shared`):

- **Limity poziomów kupującego.** Maks. oferta i maks. liczba aukcji z aktywną ofertą:

  | Poziom | Maks. oferta | Aukcje z aktywną ofertą |
  |---|---:|---:|
  | `NEW` | 2500 zł | 10 |
  | `CHECKED` | 5000 zł | 50 |
  | `TRUSTED` | bez limitu | bez limitu |

  Progi poziomów kupującego: `CHECKED` od 1 opłaconego zamówienia, `TRUSTED` od 3 zakończonych zamówień i konta starszego niż 30 dni.

- **Limity poziomów sprzedającego.** Maks. liczba aktywnych aukcji i maks. wartość aukcji:

  | Poziom | Aktywne aukcje | Maks. wartość aukcji |
  |---|---:|---:|
  | `NEW` | 5 | 5000 zł |
  | `VERIFIED` | 20 | 5000 zł |
  | `KYC` | 50 (100 po 10 zakończonych sprzedażach) | bez limitu |

  Próg poziomu sprzedającego: `VERIFIED` od 3 zakończonych sprzedaży i 0 przegranych sporów.

- **Reguły strike'ów:**
  - okno liczenia 90 dni;
  - próg blokady 3 strike'i;
  - blokada na 30 dni;
  - eskalacja do blokady bezterminowej, gdy poprzednia blokada tego rodzaju zaczęła się w ciągu 365 dni;
  - okno odwołania 180 dni.

**Gdzie i jak przechowujemy politykę:**

- Polityka leży w tabeli `account_policies` jako wersje (`policy` jsonb, autor, notatka, data). Obowiązuje najnowsza wersja. Gdy tabela jest pusta, działa `DEFAULT_ACCOUNT_POLICY`.
- `AccountPolicyService.current()` trzyma politykę w pamięci procesu przez 30 s, więc zmiana działa w API i workerze najpóźniej po 30 s.
- Do czasu panelu admina (F-34) politykę zmieniamy przez API:
  - `GET /v1/admin/account-policy` (personel);
  - `PUT /v1/admin/account-policy` (tylko `admin`), który walidujemy schematem.

**Nadpisania per użytkownik** w `users.limits` (jsonb, schemat `userLimitsOverrideSchema`):

- kupujący: `{ buyer?: { level?, maxBidAmount?, maxActiveAuctions? } }`;
- sprzedający: `{ seller?: { level?, maxActiveAuctions?, maxAuctionValue? } }`.

Pole `level` wymusza poziom. Pozostałe pola nadpisują pojedyncze limity, a `null` znaczy „bez limitu”. Endpoint: `PUT /v1/admin/users/:id/limits` (`support`, `admin`).

### Poziomy z historii zamówień (moduł `identity`)

**Tabela `trade_records`.** Jeden wiersz na zamówienie z kolumnami `order_id`, `buyer_id`, `seller_id`, `paid_at`, `completed_at` i `seller_dispute_lost_at`.

Moduł `identity` nie może czytać tabel `orders` (granice modułów), więc o zamówieniach dowiaduje się przez publiczne API `TradeHistoryService`:

- **`recordPaid(tx, { orderId, buyerId, sellerId, paidAt })`.** Woła go konsument `orders.trade-history-paid` eventu `OrderPaid` (moduł `orders`).
- **`recordCompleted(tx, { orderId, completedAt })`.** Wywoła go F-26 przy przejściu do `COMPLETED`.
- **`recordDisputeLost(tx, { orderId, decidedAt })`.** Wywoła go F-28 po sporze przegranym przez sprzedającego.

Wszystkie trzy metody są idempotentne (upsert po `order_id`).

**Backfill w migracji.** Wiersze z `paid_at` dla zamówień, które już są opłacone. To jednorazowy SQL na obu tabelach, który nie łamie zasady granic w kodzie.

**Liczenie poziomów** (czyste funkcje `buyerLevel` i `sellerLevel` w `@biddy/shared`):

| Rola | Poziom | Warunek |
|---|---|---|
| Kupujący | `CHECKED` | ≥ 1 opłacone zamówienie |
| Kupujący | `TRUSTED` | ≥ 3 zakończone zakupy i konto ≥ 30 dni |
| Sprzedający | `VERIFIED` | ≥ 3 zakończone sprzedaże i 0 przegranych sporów |
| Sprzedający | `KYC` | pozytywna weryfikacja u operatora |

Status KYC przyjdzie z F-32. Do tego czasu `kycVerified` jest `false`, więc poziom `KYC` występuje tylko z nadpisania.

**`BuyerStandingService.get` i `SellerStandingService.get`:**

- liczą poziom z `trade_records`, polityki i nadpisań;
- zwracają też aktywną blokadę (`AccountBlockView` z `until`, gdzie `null` znaczy blokadę bezterminową);
- dalej działają z `tx` wywołującego (oferta, publikacja aukcji).

### Strike'i (moduł `identity`)

**Powody** (`STRIKE_REASONS` w `@biddy/shared`). Rola wynika z powodu:

| Powód | Rola | Kto nadaje |
|---|---|---|
| `UNPAID` | kupujący | system (F-61) |
| `NOT_COLLECTED` | kupujący | system (F-61) |
| `AUCTION_CANCELLED_WITH_BIDS` | sprzedający | system (F-61) |
| `NOT_SHIPPED` | sprzedający | system (F-26) |
| `DISPUTE_LOST` | sprzedający | system (F-28) |
| `COUNTERFEIT` | sprzedający | personel |
| `OTHER` | wskazana przy nadaniu | personel |

**`StrikeService.issue(tx, input)`** (publiczne API dla innych modułów):

- **Zapis strike'a.** Zapisuje strike z uzasadnieniem (`statement`) zbudowanym z powodu i kontekstu (numer zamówienia, tytuł aukcji) oraz z `expires_at` = teraz + okno.
- **Idempotencja przez `source_key`.** Klucz jest unikalny, np. `UNPAID:{orderId}`, więc ponowione zdarzenie nie da drugiego strike'a.
- **Kolejność pod blokadą wiersza.** Wszystko dzieje się w transakcji wywołującego pod blokadą wiersza użytkownika (`FOR UPDATE`), więc dwa strike'i naraz nie dadzą dwóch blokad.
- **Ocena blokady** według reguł z sekcji „Reguły biznesowe”, w tej samej transakcji.
- **Eventy:** `StrikeIssued`, a przy blokadzie także `AccountBlocked`.

**Źródła systemowe** to konsumenci w modułach, które znają kontekst zdarzenia. `identity` nie importuje innych modułów, a odwrotny import byłby cyklem.

| Konsument | Moduł | Event | Działanie |
|---|---|---|---|
| `orders.strike-unpaid` | `orders` | `OrderCancelled` (`reason = UNPAID`) | strike `UNPAID` dla kupującego |
| `orders.strike-not-collected` | `orders` | `ShipmentStatusChanged` (`RETURNING`, `returnReason = NOT_COLLECTED`, przesyłka do kupującego) | strike `NOT_COLLECTED` dla kupującego zamówienia |
| `orders.revoke-unpaid-strike` | `orders` | `RefundRequested` (`reason = LATE_PAYMENT`) | cofnięcie strike'a `UNPAID` tego zamówienia przez system (§6.8: spóźniona płatność wraca bez strike'a) |
| `auctions.strike-cancelled-with-bids` | `auctions` | `AuctionCancelled` (`cancelledBy = SELLER`, `bidCount > 0`) | strike `AUCTION_CANCELLED_WITH_BIDS` |

**Cofnięcie strike'a** (`StrikeService.revoke(tx, id, by, note)`):

- ustawia `revoked_at`, kto cofnął i notatkę;
- zdejmuje każdą niezdjętą blokadę, którą ten strike wywołał (`account_blocks.strike_ids`);
- emituje `StrikeRevoked` i `AccountBlockLifted`;
- jest idempotentne.

**Podróbka** (`COUNTERFEIT`):

- od razu daje bezterminową blokadę wystawiania i wypłat (rodzaje `LISTING` i `PAYOUTS`) do decyzji moderatora;
- guard wypłat dojdzie w F-27 przez `AccountBlockService.isBlocked(userId, 'PAYOUTS')`.

### Blokady (moduł `identity`)

**Tabela `account_blocks`:**

| Kolumna | Opis |
|---|---|
| `kind` | `BIDDING`, `LISTING` albo `PAYOUTS` |
| `cause` | `STRIKES` albo `COUNTERFEIT` |
| `strike_ids` | strike'i, które wywołały blokadę |
| `starts_at`, `ends_at` | `ends_at = null` znaczy blokadę bezterminową |
| `statement` | uzasadnienie |
| `lifted_at`, `lifted_by`, `lift_note` | zdjęcie blokady |
| pola odwołania | jak przy strike'u |

**Kolumny w `users`:**

- `users.bidding_blocked_until` i `users.listing_blocked_until` znikają, a jedynym źródłem jest `account_blocks`. Kolumna nie umiałaby wyrazić blokady bezterminowej ani uzasadnienia.
- Guardy w API licytacji i wystawiania zostają w miejscu, tylko czytają aktywną blokadę ze standing services.

**Błędy guardów:**

- `BIDDING_BLOCKED` i `LISTING_BLOCKED` mają w rozszerzeniach `blockedUntil` (data albo `null` dla blokady bezterminowej) i `blockId`;
- komunikat mówi, do kiedy trwa blokada albo że jest bezterminowa, i wskazuje miejsce odwołania.

### Odwołania

**Odwołanie użytkownika:**

- `POST /v1/me/strikes/:id/appeal` i `POST /v1/me/account-blocks/:id/appeal` z polem `{ message }` (20–2000 znaków) ustawiają `appeal_status = PENDING`;
- jedno odwołanie na strike albo blokadę;
- tylko od strike'a niecofniętego albo blokady niezdjętej;
- najpóźniej 180 dni od nadania.

**Decyzja personelu:**

- `POST /v1/admin/strikes/:id/appeal-decision` i `POST /v1/admin/account-blocks/:id/appeal-decision` z polami `{ decision: 'ACCEPTED' | 'REJECTED', note }`;
- `ACCEPTED` cofa strike (razem z blokadami) albo zdejmuje blokadę;
- `REJECTED` zostawia stan, ale zapisuje uzasadnienie;
- emitują `AppealResolved`.

### Pozostałe endpointy personelu (do panelu admina F-34)

Rola personelu pochodzi ze zwykłej sesji, jak `/admin/bids`:

- `POST /v1/admin/strikes` (`support`, `moderator`, `admin`): strike `COUNTERFEIT` albo `OTHER` z rolą, notatką i opcjonalnie zamówieniem lub aukcją;
- `POST /v1/admin/strikes/:id/revoke` (`support`, `moderator`, `admin`);
- `POST /v1/admin/account-blocks/:id/lift` (`moderator`, `admin`);
- `GET /v1/admin/users/:id/standing`: poziomy, limity, nadpisania, strike'i i blokady;
- `GET /v1/admin/appeals`: odwołania w `PENDING`, najstarsze pierwsze.

### Endpointy użytkownika

- `GET /v1/me/standing`:
  - poziom i limity kupującego oraz sprzedającego;
  - czy limity są nadpisane;
  - następny poziom z brakującym warunkiem;
  - aktywne blokady;
  - liczba aktywnych strike'ów per rola i próg.
- `GET /v1/me/strikes`: strike'i i blokady z ostatnich 2 lat (najnowsze pierwsze), z uzasadnieniem, datą wygaśnięcia, stanem i odwołaniem.

### Powiadomienia (moduł `notifications`)

**Nowe typy:** `STRIKE_ISSUED`, `STRIKE_REVOKED`, `ACCOUNT_BLOCKED`, `ACCOUNT_UNBLOCKED`, `APPEAL_REJECTED` (uwzględnione odwołanie daje `STRIKE_REVOKED` albo `ACCOUNT_UNBLOCKED` z uzasadnieniem).

- Wszystkie są e-mailami transakcyjnymi (bez wypisania), bo to statement of reasons.
- Wszystkie linkują do `/konto/limity`.
- Konsumenci eventów z `identity`.
- `payload.auction` w migawce powiadomienia staje się opcjonalne, a powiadomienia o koncie mają `payload.account`.

### Web

**Strona `/konto/limity` „Limity i strike'i” (SSR):**

1. **Aktywne blokady na górze**, z uzasadnieniem, terminem albo „bezterminowo” i odwołaniem.
2. **Karta „Twoje limity”**, osobno dla kupującego i sprzedającego:
   - poziom z nazwą („Nowe konto”, „Sprawdzone”, „Zaufane”, „Zweryfikowane”, „Z weryfikacją tożsamości”);
   - limity;
   - co podniesie poziom.
3. **Karta „Strike'i”:**
   - licznik aktywnych w 90 dniach na tle progu;
   - lista z powodem, uzasadnieniem, datą i datą wygaśnięcia;
   - stan: aktywny, wygasł, cofnięty albo odwołanie w toku;
   - przycisk „Odwołaj się” z formularzem.
4. **Krótkie zasady** z linkiem do regulaminu (treść regulaminu powstanie w F-41).

**Pozostałe zmiany:**

- **Skrót w „Moje konto”.** Pigułka ostrzegawcza, gdy jest aktywna blokada albo strike.
- **Panel licytacji i kreator.** Komunikaty `BIDDING_BLOCKED` i `LISTING_BLOCKED` obsługują blokadę bezterminową i linkują do `/konto/limity`. Komunikat `BID_LIMIT_EXCEEDED` mówi o poziomie („Na poziomie Nowe konto…”).

## Poza zakresem

- **Strike'i za brak nadania i przegrany spór.** Same konsumenci powstaną w F-26 i F-28; F-61 daje im `StrikeService.issue` i powody.
- **Status KYC jako poziom sprzedającego.** Przyjdzie z F-32 (event `SellerKycStatusChanged` zapisze go w `identity`).
- **Guard wypłat.** Powstanie w F-27, na `AccountBlockService.isBlocked`.
- **UI personelu.** Strike'i, odwołania, polityka i nadpisania dostaną ekrany w F-34.
- **Ręczne blokady bez strike'a i bany kont** (`users.status`). To F-34 i F-35.
- **Treść regulaminu i centrum pomocy o limitach.** To F-41.
- **Powiązane konta** (§16.2). To F-36.

## UX

**Nagłówek:** link „Moje konto”, h1 „Limity i strike'i” i krótki lead „Tu widzisz swoje limity, ostrzeżenia (strike'i) i blokady. Od każdej decyzji możesz się odwołać.”

**Blokada (karta alarmowa):**

- tytuł „Licytowanie zablokowane do 2 grudnia 2026, 14:05”, a przy blokadzie bezterminowej „Licytowanie zablokowane bezterminowo”;
- uzasadnienie;
- lista strike'ów, które ją wywołały;
- przycisk „Odwołaj się”, a po wysłaniu pigułka „Odwołanie w toku” i data.

**Limity:** dwie kolumny (od 768 px), Kupowanie i Sprzedawanie. W każdej:

- pigułka poziomu;
- wiersze limitów, np. „Maks. oferta 2 500 zł”, „Aukcje z Twoją ofertą: 10”;
- tekst postępu, np. „Po pierwszym opłaconym zamówieniu: oferty do 5 000 zł”.

Nadpisane limity mają dopisek „ustawione przez Biddy”.

**Strike'i:**

- pasek „1 z 3 w ciągu 90 dni”;
- karty strike'ów z ikoną powodu, tytułem (np. „Brak płatności za zamówienie B-4821”), uzasadnieniem, datą i datą wygaśnięcia oraz pigułką stanu;
- pusta lista: „Nie masz żadnych strike'ów. Tak trzymaj.”

**Formularz odwołania:**

- pole tekstowe z licznikiem znaków i podpowiedzią „Opisz, co się stało. Odpowiemy w ciągu 7 dni.”;
- przycisk „Wyślij odwołanie”;
- potwierdzenie w miejscu formularza.

## Model danych

**`users`** (zmiany):

- `limits` jsonb, nullable: nadpisania;
- usuwamy `bidding_blocked_until` i `listing_blocked_until`.

**`trade_records`** (identity):

| Kolumna | Typ | Uwagi |
|---|---|---|
| `order_id` | uuid PK | bez FK (moduł `orders`) |
| `buyer_id`, `seller_id` | uuid FK → `users` | indeksy |
| `paid_at`, `completed_at`, `seller_dispute_lost_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

**`strikes`** (identity):

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → `users` | indeks `(user_id, role, created_at)` |
| `role` | `BUYER`/`SELLER` | |
| `reason` | `STRIKE_REASONS` | |
| `source_key` | text unique null | idempotencja źródeł systemowych |
| `order_id`, `auction_id` | uuid null | bez FK |
| `issued_by` | uuid null | null = system |
| `statement` | text | uzasadnienie widoczne dla użytkownika |
| `note` | text null | notatka wewnętrzna personelu |
| `expires_at` | timestamptz | |
| `revoked_at`, `revoked_by`, `revoke_note` | | `revoked_by` null przy cofnięciu przez system |
| `appeal_status` | `NONE`/`PENDING`/`ACCEPTED`/`REJECTED` | |
| `appeal_message`, `appealed_at`, `appeal_resolved_at`, `appeal_resolved_by`, `appeal_note` | | |
| `created_at` | timestamptz | |

**`account_blocks`** (identity):

- `id`, `user_id` (FK);
- `kind` (`BIDDING`/`LISTING`/`PAYOUTS`), `cause` (`STRIKES`/`COUNTERFEIT`);
- `strike_ids` (uuid[]), `starts_at`, `ends_at` (null = bezterminowa), `statement`;
- `lifted_at`, `lifted_by`, `lift_note`;
- pola odwołania jak w `strikes`;
- `created_at`.

Indeks `(user_id, kind)` dla aktywnej blokady. CHECK `ends_at > starts_at`.

**`account_policies`** (identity): `id`, `policy` jsonb, `created_by`, `note`, `created_at`.

## API i zdarzenia

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `GET /v1/me/standing` | sesja | poziomy, limity, blokady, liczniki |
| `GET /v1/me/strikes` | sesja | strike'i i blokady |
| `POST /v1/me/strikes/:id/appeal` | sesja | odwołanie od strike'a |
| `POST /v1/me/account-blocks/:id/appeal` | sesja | odwołanie od blokady |
| `GET /v1/admin/account-policy` | personel | bieżąca polityka |
| `PUT /v1/admin/account-policy` | `admin` | nowa wersja polityki |
| `PUT /v1/admin/users/:id/limits` | `support`, `admin` | nadpisania (`null` usuwa) |
| `GET /v1/admin/users/:id/standing` | personel | stan użytkownika |
| `GET /v1/admin/appeals` | `support`, `moderator`, `admin` | odwołania w toku |
| `POST /v1/admin/strikes` | `support`, `moderator`, `admin` | ręczny strike |
| `POST /v1/admin/strikes/:id/revoke` | `support`, `moderator`, `admin` | cofnięcie |
| `POST /v1/admin/strikes/:id/appeal-decision` | `support`, `moderator`, `admin` | decyzja w odwołaniu |
| `POST /v1/admin/account-blocks/:id/lift` | `moderator`, `admin` | zdjęcie blokady |
| `POST /v1/admin/account-blocks/:id/appeal-decision` | `moderator`, `admin` | decyzja w odwołaniu |

**Nowe kody błędów:**

| Kod | HTTP | Kiedy |
|---|---|---|
| `STRIKE_NOT_FOUND` | 404 | |
| `ACCOUNT_BLOCK_NOT_FOUND` | 404 | |
| `APPEAL_NOT_ALLOWED` | 409 | już było odwołanie, strike cofnięty, blokada zdjęta albo minęło 180 dni |
| `APPEAL_NOT_PENDING` | 409 | decyzja bez odwołania w toku |

### Eventy (outbox, wersja 1, moduł `identity`)

- `StrikeIssued` (`userId`, `role`, `reason`, `orderId`, `auctionId`, `expiresAt`);
- `StrikeRevoked` (`userId`, `reason`, `bySystem`);
- `AccountBlocked` (`userId`, `kind`, `cause`, `until`);
- `AccountBlockLifted` (`userId`, `kind`);
- `AppealResolved` (`userId`, `subject`: `STRIKE`/`BLOCK`, `subjectId`, `decision`); powiadomienie tylko przy odrzuceniu.

Konsumenci: powiadomienia (F-61). W F-34 dojdzie audit log.

## Reguły biznesowe i przypadki brzegowe

**Liczenie strike'ów:**

- Do progu liczą się strike'i danej roli, które nie są cofnięte, mają `created_at` w oknie 90 dni i nie weszły jeszcze do niezdjętej blokady tej roli.
- Dzięki temu czwarty strike tuż po końcu blokady nie daje od razu nowej blokady. Potrzeba trzech nowych.

**Blokady:**

- **Rodzaj zależy od roli:** strike'i kupującego blokują licytowanie (`BIDDING`), sprzedającego wystawianie (`LISTING`).
- **Nowa blokada przy aktywnej:** nie powstaje. Strike i tak zostaje zapisany.
- **Eskalacja:** jeśli w ciągu 365 dni była niezdjęta blokada tego samego rodzaju z przyczyny `STRIKES`, nowa blokada jest bezterminowa. Wcześniejsza blokada mogła już wygasnąć.

**Cofnięcie i odwołanie:**

- Cofnięty strike nie liczy się do progu, a każda niezdjęta blokada, w której jest w `strike_ids`, zostaje zdjęta.
- Zdjęta blokada nie liczy się do eskalacji.
- Uwzględnione odwołanie od blokady zdejmuje tylko blokadę. Strike'i zostają, ale są „zużyte”.

**Spóźniona płatność:**

- Zamówienie anulowane z płatnością w toku (`paymentPending = true`) też dostaje strike `UNPAID`.
- Jeśli płatność przyjdzie (`RefundRequested` z `LATE_PAYMENT`), system cofa strike z notatką „Płatność dotarła po terminie i została zwrócona” i zdejmuje blokadę, jeśli powstała.

**Nieodebrana paczka:**

- Strike nadajemy raz na zamówienie, przy pierwszym `RETURNING` z `NOT_COLLECTED` dla przesyłki do kupującego.
- Zwroty od kupującego (`direction` zwrotu, F-28) nie dają strike'a.

**Kiedy blokada działa:**

- Blokada licytowania działa od chwili nadania. Oferty złożone wcześniej zostają (§6.4: oferty są wiążące).
- Blokada wystawiania nie anuluje aktywnych aukcji. Blokuje tylko publikację nowych, a edycja trwających aukcji działa dalej.

**Limity i poziomy:**

- **Limity tylko przy nowych akcjach.** Sprawdzamy je przy ofercie i publikacji. Spadek poziomu (np. przez nadpisanie) nie anuluje istniejących ofert ani aukcji.
- **Wartość aukcji.** Liczymy ją z `auctionValue` (§4.1): najwyższa z cen.
- **Nadpisanie poziomu ma pierwszeństwo**, a nadpisane pola limitów mają pierwszeństwo przed limitami poziomu.

**Uzasadnienia:**

- Uzasadnienie strike'a mówi, za co jest i z jakiego zdarzenia (numer zamówienia albo tytuł aukcji), kiedy wygaśnie, co da trzeci strike i że można się odwołać.
- Uzasadnienie blokady mówi, które strike'i ją wywołały, jak długo trwa i dlaczego jest bezterminowa, jeśli jest.
- Personel dopisuje notatkę do uzasadnienia przy strike'ach `OTHER` i `COUNTERFEIT`.

## Bezpieczeństwo i prywatność

- **Dostęp do strike'ów i blokad.** Użytkownik widzi tylko swoje. Cudze id daje 404, bez zdradzania, że istnieje.
- **Notatki personelu.** `note` (wewnętrzna) nie trafia do `/me/*`. `revoke_note` i `appeal_note` trafiają, bo to uzasadnienie decyzji.
- **Zmiana polityki.** Tylko rola `admin`. Każda wersja zapisuje autora (do audit logu F-34).
- **Treść odwołania.** Przycinamy ją i zapisujemy jako zwykły tekst; web nie renderuje jej jako HTML.
- **Strike'i nie są publiczne.** Profil publiczny ich nie pokazuje.

## Analityka

Brak nowych zdarzeń PostHog. Liczbę strike'ów, blokad i odwołań da się policzyć z tabel; dashboard powstanie w F-34.

## Kryteria akceptacji

- [x] Trzeci strike kupującego w 90 dniach blokuje licytowanie na 30 dni, a API zwraca `BIDDING_BLOCKED` z datą końca blokady.
- [x] Strike starszy niż 90 dni nie liczy się do progu.
- [x] Każdy strike ma uzasadnienie widoczne dla użytkownika i można się od niego odwołać.
- [x] Cofnięty strike nie liczy się do progu, a wynikająca z niego blokada jest zdejmowana.
- [x] Zmiana limitów w konfiguracji działa bez deployu.
- [x] Druga blokada w ciągu 12 miesięcy jest bezterminowa (`blockedUntil = null`).
- [x] Kupujący po pierwszym opłaconym zamówieniu ma limit oferty 5000 zł, a nowy 2500 zł (decyzja nr 110).
- [x] Nieopłacone zamówienie daje kupującemu strike `UNPAID`, a spóźniona płatność go cofa.
- [x] Anulowanie aukcji z ofertami przez sprzedającego daje mu strike, a po trzecim nie może publikować aukcji (`LISTING_BLOCKED`).

## Plan testów

**Jednostkowe (`@biddy/shared`):**

- `buyerLevel` i `sellerLevel`: progi, wiek konta, przegrany spór, nadpisanie poziomu;
- `effectiveBuyerLimits` i `effectiveSellerLimits`: nadpisania pól, `null` jako brak limitu;
- `accountPolicySchema`: domyślna polityka przechodzi, a niespójna (np. ujemne wartości) nie.

**Jednostkowe (`identity`):** `blockDecision`:

- 2 strike'i nie dają blokady, 3 dają;
- strike sprzed 91 dni się nie liczy;
- cofnięty strike się nie liczy;
- strike'i zużyte przez blokadę się nie liczą;
- eskalacja w 365 dniach i brak eskalacji po zdjętej blokadzie;
- przy aktywnej blokadzie nie powstaje nowa;
- `COUNTERFEIT` daje bezterminowe `LISTING` i `PAYOUTS`.

**Treść:** uzasadnienia strike'ów i blokad oraz nowe typy powiadomień (`notification-content`).

**Integracyjne (Testcontainers):**

- trzy strike'i `UNPAID` przez anulowanie nieopłaconych zamówień, a potem oferta z 403 `BIDDING_BLOCKED` i datą;
- spóźniona płatność cofa strike i zdejmuje blokadę;
- anulowanie aukcji z ofertami daje strike sprzedającego, a trzy takie blokują publikację;
- nieodebrana paczka (FakeShipping, scenariusz `NOT_PICKED_UP`) daje strike `NOT_COLLECTED`;
- `OrderPaid` podnosi poziom kupującego i limit oferty do 5000 zł;
- `PUT /admin/account-policy` zmienia limit bez restartu (po odświeżeniu cache);
- nadpisanie `users.limits`;
- odwołanie użytkownika, decyzja personelu i powtórne odwołanie dają 409;
- cudzy strike daje 404;
- uprawnienia ról personelu;
- idempotencja: ponowione zdarzenie nie daje drugiego strike'a;
- równoległe strike'i dają jedną blokadę;
- powiadomienia `STRIKE_ISSUED` i `ACCOUNT_BLOCKED`.

**Web (Vitest + Testing Library):**

- strona limitów: blokada z terminem i bezterminowa, poziomy, pusta lista, formularz odwołania (walidacja długości, wysłanie, stan „w toku”);
- komunikat `BIDDING_BLOCKED` bez daty w panelu licytacji.

## Postęp i odstępstwa (2026-11-02)

- **Zrobione.** Wszystko z zakresu i 9 kryteriów:
  - testy jednostkowe: shared, reguły blokad, uzasadnienia, treść powiadomień;
  - test integracyjny `test/integration/standing.int.test.ts` (11 scenariuszy);
  - testy komponentu strony `/konto/limity`.
- **Źródła strike'ów spoza F-61 w testach.** Spóźnioną płatność i nieodebraną paczkę test integracyjny podaje jako eventy wprost w outboxie (`RefundRequested`, `ShipmentStatusChanged`). Pełne przebiegi tych zdarzeń testują F-24 i F-25.
- **Pole `blockDays` w `GET /me/standing`.** Doszło, bo zasady na stronie podają długość blokady z polityki, a nie stałą w tekście.
- **Ustawienia powiadomień.** Mają nową grupę „Konto”. Nowe typy są tam pokazane z kłódką („Zawsze wysyłamy”), bo to e-maile transakcyjne.
- **Skrót „Limity i strike'i” w „Moim koncie”.** Przy aktywnej blokadzie ma ostrzeżenie. Strona konta pyta o stan przez `GET /me/standing`; błąd API nie psuje strony.
- **Wystawianie (`/wystaw`).** Pokazuje blokadę bezterminową. Link prowadzi do uzasadnienia i odwołania. `GET /me/selling-limits` ma nowe pole `listingBlocked`, a `maxActiveAuctions` może być `null`.
- **Poza F-61.** Przy anulowaniu aukcji z ofertami `pg` ostrzega o równoległych zapytaniach na jednym połączeniu. Źródłem jest `AuctionDirectory.audience` z F-20 (konsument powiadomień, `Promise.all` w transakcji), nie kod F-61.

## Otwarte pytania

1. **Strike `UNPAID` przy płatności w toku.** Nadajemy go od razu i cofamy po spóźnionej płatności, czy czekamy, aż płatność się rozstrzygnie? Przyjęte: od razu, bo prościej i użytkownik i tak wie, że nie zapłacił w terminie. Cofnięcie przychodzi z powiadomieniem.
2. **Termin odpowiedzi na odwołanie.** „7 dni” w UI to założenie. Do potwierdzenia z prawnikiem (§17.1 pkt 5) razem z regulaminem (F-41).
3. **Strike'i nadane przed F-61.** Zamówienia anulowane jako nieopłacone przed wdrożeniem nie dostają strike'ów wstecz. Backfill dotyczy tylko poziomów (`trade_records`).
