# F-26 · Cykl życia zamówienia

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-22 (ledger), F-23 (port płatności), F-24 (dostawy), F-25 (checkout), F-61 (strike'i)

## Kontekst i cel

Po F-25 zamówienie umie przejść tylko z `AWAITING_PAYMENT` do `PAID` albo `CANCELLED_UNPAID` ([PROJECT.md §7.3](../PROJECT.md#73-maszyna-stanów-zamówienia)). Moduł `shipping` (F-24) publikuje już każdą zmianę statusu przesyłki, ledger (F-22) ma szablony zakończenia, zwrotów i rekompensat, a F-61 nadaje strike'i za brak płatności i nieodebraną paczkę. Nic jednak nie prowadzi zamówienia dalej:

- opłacone zamówienie nie zmienia stanu po nadaniu ani po odbiorze;
- nie ma okna 36 h, potwierdzenia odbioru ani zwolnienia środków;
- nienadana paczka nie anuluje zamówienia;
- nieodebrana paczka nie kończy się zwrotem;
- kupujący nie może zgłosić zaginionej przesyłki;
- po braku płatności sprzedający nie ma drugiej szansy;
- kupujący nie dostaje przypomnień o płatności;
- żadna ze stron nie ma widoku zamówienia.

F-26 domyka maszynę stanów z §7.3 i terminy z [§7.4](../PROJECT.md#74-terminy):

- przejścia sterowane eventami przesyłki;
- joby terminów;
- „Wszystko OK” i auto-zakończenie z ledgerem i zwolnieniem środków u operatora;
- zwroty przy nienadaniu, nieodebraniu i zaginięciu;
- rekompensata dla sprzedającego za zaginioną paczkę;
- flaga chargebacku;
- oferta drugiej szansy ([§6.8](../PROJECT.md#68-brak-płatności-zwycięzcy));
- powiadomienia na każdym etapie;
- strona zamówienia dla obu stron.

Cel: zamówienie przechodzi od wygranej do wypłaty samo, a w każdej sytuacji wyjątkowej obie strony wiedzą, co się stało i co dalej.

## Historyjki użytkownika

- Jako zwycięzca dostaję przypomnienia o płatności po 1 h, 12 h i 20 h od wygranej.
- Jako kupujący widzę stan zamówienia, numer przesyłki i historię trackingu, a po odbiorze mam 36 h na sprawdzenie przedmiotu i przycisk „Wszystko OK”.
- Jako kupujący, którego paczka nie dotarła przez 14 dni od nadania, zgłaszam brak paczki („Zgłoś brak paczki”) i dostaję pełny zwrot.
- Jako kupujący dostaję pełny zwrot, gdy sprzedający nie nada paczki w 5 dni roboczych.
- Jako sprzedający dostaję przypomnienie o nadaniu na dzień przed terminem.
- Jako sprzedający po potwierdzeniu odbioru (albo po 36 h) widzę środki na saldzie dostępnym.
- Jako sprzedający, któremu zwycięzca nie zapłacił, wysyłam ofertę drugiej szansy kolejnemu licytującemu albo wystawiam przedmiot ponownie.
- Jako licytujący z ofertą drugiej szansy kupuję przedmiot za swoją maksymalną ofertę albo odrzucam ofertę bez konsekwencji.
- Jako sprzedający, którego paczka zaginęła, dostaję rekompensatę równą cenie.
- Jako sprzedający, któremu kupujący nie odebrał paczki, odzyskuję przedmiot, a kupujący dostaje zwrot dopiero po powrocie paczki.

## Zakres

### Maszyna stanów (moduł `orders`)

- **Tabela przejść** `ORDER_TRANSITIONS` (czysta funkcja `canTransition(from, to)`) dokładnie według diagramu z §7.3.
- **Każda zmiana statusu** przechodzi przez jeden helper:
  - `UPDATE … WHERE id = ? AND status = from` pod blokadą wiersza (`FOR UPDATE`);
  - w tej samej transakcji ustawia kolumny czasu stanu i dodaje event do outboxa;
  - niedozwolone przejście rzuca błąd, zanim dotknie bazy.
- **Trigger `orders_status_transition`** w bazie odrzuca niedozwolone pary także przy błędzie w kodzie albo ręcznym `UPDATE` (jak niezmienniki ledgera w F-22).
- **Przejścia z F-25** (opłacenie, anulowanie nieopłaconego) korzystają z tego samego helpera. Opłacenie zapisuje dodatkowo płatność, która opłaciła zamówienie (`orders.payment_id`); potrzebują jej zwroty i zwolnienie środków.

### Przypomnienia o płatności (moduł `notifications`)

- **Konsument `OrderCreated`** planuje 3 joby `notifications.payment-reminder`, 1 h, 12 h i 20 h od utworzenia zamówienia, czyli 23 h, 12 h i 4 h przed terminem płatności. ID joba zawiera termin (`deadlineJobId`).
- **Job** wysyła `PAYMENT_REMINDER` z linkiem do checkoutu, tylko gdy zamówienie wciąż czeka na płatność. Klucz deduplikacji: `PAYMENT_REMINDER:{orderId}:{n}`.
- Zamówienie z drugiej szansy dostaje te same przypomnienia.

### Nadanie i termin nadania

- **Konsument `orders.shipment-lifecycle`** eventu `ShipmentStatusChanged` (przesyłka `OUTBOUND` zamówienia):
  - pierwszy status u przewoźnika (`DROPPED_OFF`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `READY_FOR_PICKUP`, `EXCEPTION`, `DELIVERED`, `RETURNING`) przy zamówieniu `PAID` → `SHIPPED`:
    - `shipped_at` = czas u przewoźnika;
    - event `OrderShipped` z numerem przesyłki;
  - gdy pierwszy znany status jest od razu końcowy (np. `DELIVERED`), konsument robi oba przejścia po kolei w jednej transakcji.
- **Przypomnienie o nadaniu:** konsument `OrderPaid` planuje job `notifications.ship-reminder` na 24 h przed `ship_by`. Job wysyła `SHIP_REMINDER`, jeśli zamówienie wciąż jest `PAID`.
- **Job `orders.expire-unshipped`** (co minutę, po 100 zamówień) dla zamówień `PAID` po `ship_by`:
  1. przesyłka już u przewoźnika (status po `CREATED`): zamówienie pomijamy, bo event nadania jest w drodze;
  2. przesyłka `CREATED`: najpierw synchronizacja trackingu (`TrackingSync.sync`), żeby nie anulować paczki nadanej przed chwilą; jeśli nadal `CREATED`, anulowanie u dostawcy;
  3. przesyłka `REQUESTED` (worker tworzy ją u dostawcy): pominięcie do następnego wykonania;
  4. w transakcji z blokadą wiersza: `PAID → CANCELLED_NOT_SHIPPED`, `cancelled_at`, zlecenie pełnego zwrotu (`RefundService.request`, powód `NOT_SHIPPED`), event `OrderCancelled` (`reason: 'NOT_SHIPPED'`).
- **Strike `NOT_SHIPPED`** dla sprzedającego: konsument `orders.strike-not-shipped` eventu `OrderCancelled` (`StrikeService.issue`, klucz źródła `NOT_SHIPPED:{orderId}`).
- **Po potwierdzeniu zwrotu** (`RefundSucceeded`, konsument `orders.refund-settled`): `CANCELLED_NOT_SHIPPED → REFUNDED`, `refunded_at`, event `OrderRefunded`.

### Doręczenie, okno 36 h i zakończenie

- **Doręczenie:** `DELIVERED` przy zamówieniu `SHIPPED` → `DELIVERED`:
  - `delivered_at` = czas u przewoźnika;
  - `inspection_ends_at` = chwila wykrycia + 36 h (§7.4: opóźniony webhook przesuwa start okna na korzyść kupującego);
  - event `OrderDelivered`.
- **„Wszystko OK”** (`POST /v1/orders/:id/confirm-receipt`, kupujący): `DELIVERED → COMPLETED` z `buyer_confirmed_at`.
- **Job `orders.complete-inspected`** (co minutę): `DELIVERED` po `inspection_ends_at` → `COMPLETED`.
- **Zakończenie** w jednej transakcji:
  - `completed_at`;
  - `EscrowService.release` (moduł `payments`): księgowanie `ORDER_COMPLETED` (cena na saldo dostępne sprzedającego, najpierw spłata `seller_receivable`; POK i dostawa jako przychody Biddy) i zlecenie zwolnienia u operatora;
  - event `OrderCompleted`.
- **Historia zamówień** (poziom „zaufany”, F-61): konsument `orders.trade-history-completed` eventu `OrderCompleted` (`TradeHistoryService.recordCompleted`).
- **Flaga chargebacku** `orders.chargeback_status` (`OPEN`, `WON`, `LOST`, domyślnie null): przy `OPEN` ani job, ani „Wszystko OK” nie kończą zamówienia; job wraca do niego po rozstrzygnięciu. Ustawianie flagi (webhook chargebacku, panel) dojdzie w F-28 i F-34.

### Zwolnienie środków (moduł `payments`)

- **`EscrowService.release(tx, …)`:**
  - księgowanie `ORDER_COMPLETED` z kluczem `order:{orderId}:completed`;
  - wiersz `fund_releases` (`PENDING`, jeden na zamówienie);
  - event `FundsReleaseRequested`.
- **Konsument `payments.release-funds`** woła `gateway.releaseFunds` z kluczem `release:{id}` i zapisuje wynik:
  - `SUCCEEDED` z ID transferu;
  - `NOT_REQUIRED` w modelu `SELLER_BALANCE`, np. FakeGateway: środki są już na saldzie u operatora, a zwolnienie robi tylko ledger.
- **Ledger zwalnia środki od razu**, bo jest źródłem prawdy dla wypłat (§7.7). Wywołanie operatora jest tylko wykonaniem; błąd trafia do ponowień, a potem do dead-letter dla supportu.

### Nieodebrane przesyłki

- **Powrót paczki:** `RETURNING` z powodem `NOT_COLLECTED` przy zamówieniu `SHIPPED` → `NOT_PICKED_UP`, `not_picked_up_at`, event `OrderNotPickedUp`. Środki zostają wstrzymane, a strike kupującego nadaje już F-61.
- **Zwrot pieniędzy:** `RETURNED` przy zamówieniu `NOT_PICKED_UP` → zlecenie zwrotu ceny i POK, bez dostawy (nowy powód zwrotu `NOT_PICKED_UP`). Po potwierdzeniu operatora:
  - księgowanie `NOT_PICKED_UP_REFUNDED` (dostawa zostaje jako przychód `platform_shipping`);
  - przejście `NOT_PICKED_UP → REFUNDED`.
- **Zwrot z innego powodu** (`RETURNING` z `OTHER` albo `RETURNED` przy `SHIPPED`): zamówienie zostaje `SHIPPED`, a ostrzeżenie trafia do logów dla supportu. Kupujący może zgłosić brak paczki po 14 dniach (otwarte pytanie).

### Zaginione przesyłki (§7.9)

- **Zgłoszenie braku paczki** („Zgłoś brak paczki”, `POST /v1/orders/:id/report-not-received`, kupujący). Warunki:
  - zamówienie jest `SHIPPED`;
  - od nadania minęło 14 dni;
  - przesyłka nie ma statusu końcowego (`DELIVERED`, `RETURNED`).
- **Przebieg** w jednej transakcji:
  - `SHIPPED → LOST`, `lost_at`;
  - pełny zwrot (powód `LOST`);
  - reklamacja u przewoźnika (`CarrierClaimService.open`, typ `LOST`, kwota = cena);
  - event `OrderLost`.
  Po potwierdzeniu zwrotu: `LOST → REFUNDED`.
- **Rekompensata dla sprzedającego** = cena (`PARCEL_COMPENSATION_PAID`):
  - kanał `SELLER_BALANCE`, gdy operator ma `internalTransfers`, inaczej `EXTERNAL_TRANSFER` (przelew działu finansów);
  - termin: po rozstrzygnięciu reklamacji (`CarrierClaimResolved`, konsument `orders.lost-parcel-claim`), najpóźniej 30 dni od zgłoszenia (job `orders.compensate-lost`, co godzinę);
  - znacznik `orders.seller_compensated_at`.
- **Rozliczenie reklamacji** (`CARRIER_CLAIM_SETTLED`): odzyskana kwota trafia na `platform_external`, a reszta rekompensaty to `platform_losses`.

### Oferta drugiej szansy (§6.8)

- **Kandydaci:** przy zakończeniu aukcji moduł `auctions` przekazuje do zamówienia listę pozostałych licytujących:
  - do 5 osób z najwyższą ważną ofertą maksymalną, bez zwycięzcy;
  - kolejność: maksimum malejąco, przy remisie wcześniejsza oferta;
  - zapis w `order_items.runner_ups`.
  Po zakończeniu aukcji oferty są niezmienne, więc lista jest aktualna. Migracja wypełnia ją dla istniejących zamówień z tabeli `bids`.
- **Wysłanie** (`POST /v1/orders/:id/second-chance-offers`, sprzedający). Warunki:
  - zamówienie jest `CANCELLED_UNPAID` i jest ostatnim zamówieniem aukcji;
  - nie minęło 14 dni od anulowania;
  - aukcja nie ma oczekującej oferty.
  Oferta trafia zawsze do kolejnego kandydata z listy, który nie dostał jeszcze oferty dla tej aukcji. Cena to jego maksimum, także poniżej ceny minimalnej. Oferta jest ważna 24 h. Event `SecondChanceOffered`.
- **Odpowiedź licytującego:**
  - `POST /v1/second-chance-offers/:id/accept`, w jednej transakcji:
    - poprzednie zamówienie aukcji przestaje być aktywne (`order_items.is_active = false`);
    - powstaje nowe zamówienie `AWAITING_PAYMENT` z terminem 24 h, POK liczonym od ceny oferty według bieżącego cennika i snapshotem przedmiotu z anulowanego zamówienia;
    - oferta przechodzi w `ACCEPTED` z numerem zamówienia;
    - eventy `OrderCreated` (z `secondChanceOfferId`) i `SecondChanceOfferResolved`.
    Licytujący z blokadą licytowania (F-61) nie może przyjąć oferty (403 `BIDDING_BLOCKED`, jak przy licytowaniu).
  - `POST /v1/second-chance-offers/:id/decline` → `DECLINED`.
  Odrzucenie i brak reakcji nie mają konsekwencji.
- **Job `orders.expire-second-chance`** (co minutę): oczekujące oferty po terminie → `EXPIRED`, event `SecondChanceOfferResolved`. Sprzedający może wtedy wysłać ofertę następnej osobie.
- **Ponowne wystawienie:** istniejące „Wystaw ponownie” (kopia aukcji jako szkic, F-21) jest dostępne z Moje Biddy i ze strony anulowanego zamówienia.

### Powiadomienia (moduł `notifications`)

Nowe typy; wszystkie e-maile są transakcyjne (`enabledByDefault: true`, `configurable: false`):

| Typ | Kto | Kiedy | Przycisk |
|---|---|---|---|
| `PAYMENT_REMINDER` | kupujący | 1 h, 12 h, 20 h po wygranej | Zapłać |
| `SHIP_REMINDER` | sprzedający | 24 h przed terminem nadania | Nadaj paczkę |
| `ORDER_CANCELLED` | sprzedający (brak płatności: druga szansa albo ponowne wystawienie); obie strony (brak nadania) | anulowanie | Zobacz zamówienie |
| `ORDER_SHIPPED` | kupujący | nadanie | Śledź przesyłkę |
| `ORDER_DELIVERED` | kupujący | odbiór: 36 h na sprawdzenie | Sprawdź i potwierdź |
| `ORDER_COMPLETED` | sprzedający | zakończenie: środki na saldzie | Zobacz zamówienie |
| `ORDER_NOT_PICKED_UP` | sprzedający | paczka wraca do nadawcy | Zobacz zamówienie |
| `ORDER_LOST` | sprzedający | zgłoszona zaginiona paczka: rekompensata | Zobacz zamówienie |
| `ORDER_REFUNDED` | kupujący | zwrot potwierdzony przez operatora (każdy powód, także spóźniona płatność z F-25) | Zobacz zamówienie |
| `SECOND_CHANCE_OFFER` | licytujący | oferta drugiej szansy | Zobacz ofertę |
| `SECOND_CHANCE_ANSWERED` | sprzedający | oferta przyjęta, odrzucona albo wygasła | Zobacz zamówienie |

Zamówienie z drugiej szansy nie wysyła `WON` ani `SOLD`, bo licytujący przyjmuje ofertę na stronie, a sprzedający dostaje `SECOND_CHANCE_ANSWERED`.

### Widok zamówienia (API i web)

- **`GET /v1/orders/:id`** (kupujący albo sprzedający; inni 404) zwraca `OrderDetailsDto`:
  - stan, rola i druga strona (nazwa wyświetlana);
  - przedmiot ze snapshotu (tytuł, zdjęcie, link do aukcji);
  - kwoty: cena, POK, dostawa, suma;
  - daty etapów;
  - przesyłka z historią trackingu (`ShipmentDto` dla oglądającego);
  - ostatni zwrot (kwota, powód, stan);
  - dostępne akcje z terminami;
  - dla sprzedającego anulowanego zamówienia: stan drugiej szansy (następny kandydat z zanonimizowaną nazwą i kwotą, wysłane oferty, termin).
- **Strona `/zamowienia/[publicId]`** dla obu stron: opisana w „UX”.
- **Strona `/druga-szansa/[id]`** dla licytującego: oferta z kwotą, POK i sumą bez dostawy, terminem, „Kup za …” i „Nie, dziękuję”. Po akceptacji przekierowanie do checkoutu.
- **Moje Biddy:**
  - wygrane i sprzedane prowadzą do strony zamówienia;
  - sprzedane po braku płatności mają akcję „Druga szansa”;
  - zakupy z drugiej szansy są w „Wygranych” z „Zapłać”;
  - wygrana z anulowanym zamówieniem pokazuje to zamówienie, a nie zamówienie z drugiej szansy.

## Poza zakresem

- **Spory** w oknie 36 h: przycisk „Zgłoś problem”, stan `DISPUTED` i przejścia z niego (F-28). Strona zamówienia w oknie 36 h odsyła na razie do pomocy.
- **Chargebacki:** webhook operatora i ustawianie flagi (F-28, F-31) oraz chargeback po zakończeniu (§7.9). F-26 dodaje tylko flagę i jej skutek dla auto-zakończenia.
- **Wypłaty i widok salda** (F-27).
- **Panel supportu (F-34):**
  - reklamacje u przewoźników (zgłoszenie, rozstrzygnięcie; do tego czasu `CarrierClaimService`);
  - zadanie dla supportu przy braku `RETURNED` 14 dni po `NOT_PICKED_UP`;
  - przejście `NOT_PICKED_UP → LOST`;
  - nieudane zwroty i zwolnienia.
- **Opłata przewoźnika za zwrot do nadawcy** (`platform_losses`): wymaga faktur przewoźnika (§7.4 pkt 4).
- **Limit odpowiedzialności przewoźnika** przy rekompensacie: rekompensata = cena (otwarte pytanie).
- **Faktura za POK** (F-33), „opłacaj automatycznie” (v1).

## UX

Układ jak checkout i strona nadania: tło `canvas`, kontener `max-w-page`, treść w kartach z lewej, podsumowanie z prawej (od 1024 px przyklejone), na telefonie podsumowanie pod treścią.

**Nagłówek:** link wstecz („Wygrane” albo „Sprzedane”), h1 z tytułem przedmiotu, „Zamówienie nr B-4821” i pigułka stanu w tonie:

| Stan | Pigułka | Ton |
|---|---|---|
| `AWAITING_PAYMENT` | Czeka na płatność | ostrzegawczy |
| `PAID` | Opłacone | informacyjny |
| `SHIPPED` | W drodze | informacyjny |
| `DELIVERED` | Odebrane | informacyjny |
| `COMPLETED` | Zakończone | pozytywny |
| `NOT_PICKED_UP` | Nieodebrane | ostrzegawczy |
| `LOST` | Zaginione | ostrzegawczy |
| `REFUNDED` | Zwrócone | neutralny |
| `CANCELLED_UNPAID` | Nie zapłacono w terminie | neutralny |
| `CANCELLED_NOT_SHIPPED` | Nienadane w terminie | neutralny |

**Karta „Co teraz”** (`role="status"` przy zmianach). Jedno zdanie o stanie i główna akcja dla oglądającego:

- **Kupujący:**
  - `AWAITING_PAYMENT`: „Zapłać do 25 października, 18:02.” → „Zapłać” (checkout);
  - `PAID`: „Sprzedający ma czas na nadanie do 31 października. Dostaniesz numer przesyłki.”;
  - `SHIPPED`: „Paczka jest w drodze.” Po 14 dniach od nadania dochodzi „Paczka nie dotarła? Możesz to zgłosić.” → „Zgłoś brak paczki” z potwierdzeniem w oknie dialogowym (pełny zwrot, reklamację składa Biddy);
  - `DELIVERED`: „Masz czas na sprawdzenie przedmiotu do 27 października, 06:15. Potem zamówienie zakończy się samo, a sprzedający dostanie pieniądze.” → „Wszystko OK” z potwierdzeniem; pod spodem „Coś jest nie tak? Napisz do pomocy, zanim minie termin.”;
  - `COMPLETED`: „Zamówienie zakończone. Dziękujemy!”;
  - `NOT_PICKED_UP`: „Paczka wraca do sprzedającego, bo nie została odebrana. Gdy wróci, zwrócimy cenę i POK (bez dostawy).”;
  - `LOST`: „Zgłoszenie przyjęte. Zwracamy pełną kwotę.”;
  - `REFUNDED`: „Zwróciliśmy {kwota}.” z powodem;
  - `CANCELLED_*`: przyczyna i informacja o zwrocie, jeśli była płatność.
- **Sprzedający:**
  - `AWAITING_PAYMENT`: „Kupujący ma czas na płatność do …”;
  - `PAID`: „Nadaj paczkę do 31 października.” → „Nadaj paczkę”;
  - `SHIPPED`: „Paczka jest w drodze.”;
  - `DELIVERED`: „Kupujący sprawdza przedmiot do …. Potem pieniądze trafią na Twoje saldo.”;
  - `COMPLETED`: „{cena} jest na Twoim saldzie.”;
  - `NOT_PICKED_UP`: „Kupujący nie odebrał paczki. Wraca do Ciebie.”;
  - `LOST`: „Paczka zaginęła. Dostaniesz rekompensatę {cena} najpóźniej {data}.” (po wypłacie: „Rekompensata wypłacona.”);
  - `CANCELLED_UNPAID`: karta drugiej szansy (niżej) i „Wystaw ponownie”;
  - `CANCELLED_NOT_SHIPPED`: „Zamówienie anulowane, bo paczka nie została nadana w terminie. Kupujący dostaje zwrot.”

Przy wstrzymaniu przez chargeback: „Zamówienie jest wstrzymane do wyjaśnienia płatności z bankiem kupującego.”

**Postęp:** lista kroków (`ol`), „Opłacone · Nadane · Odebrane · Zakończone”, z datami i stanem bieżącym (`aria-current="step"`).

**Przesyłka:** przewoźnik, numer, historia trackingu (najnowsze na górze) ze stroną nadania F-24 jako wzorem.

**Podsumowanie (aside):** zdjęcie, tytuł, link do aukcji, „Cena”, „Pakiet Ochrony Kupujących”, „Dostawa”, „Razem”, druga strona („Sprzedaje: …” albo „Kupuje: …”).

**Druga szansa (sprzedający, `CANCELLED_UNPAID`):**

- karta „Druga szansa”, opis: „Możesz zaproponować przedmiot kolejnej osobie z licytacji za jej najwyższą ofertę. Oferta jest ważna 24 h.”;
- następny kandydat: „k***a, maks. 340 zł” i przycisk „Wyślij ofertę”;
- lista wysłanych ofert ze stanem („Czeka na odpowiedź do …”, „Przyjęta, zamówienie nr …”, „Odrzucona”, „Wygasła”);
- bez kandydatów: „Nie ma już kolejnych licytujących.”; po terminie: „Termin na drugą szansę minął.”;
- obok: „Wystaw ponownie” (szkic kopii aukcji).

**Oferta dla licytującego (`/druga-szansa/[id]`):**

- karta z tytułem, zdjęciem i tekstem: „Zwycięzca nie zapłacił. Sprzedający proponuje Ci ten przedmiot za Twoją najwyższą ofertę.”;
- wiersze: cena, POK, „Do zapłaty (bez dostawy)”;
- termin: „Oferta ważna do …”;
- przyciski: „Kup za 340 zł” (gradient F-63) i „Nie, dziękuję”;
- informacja: „Oferta nie jest wiążąca. Jeśli jej nie przyjmiesz, nic się nie stanie.”;
- po akceptacji przekierowanie do checkoutu;
- stany końcowe: „Oferta przyjęta” z linkiem do zamówienia, „Oferta odrzucona”, „Oferta wygasła”.

Teksty po polsku i neutralne płciowo. Błędy akcji pokazuje `role="alert"` przy przycisku.

## Model danych

Migracja `0020_order_lifecycle`. Kwoty w groszach (`bigint`), czasy `timestamptz`.

**`orders`** (nowe kolumny):

| Kolumna | Opis |
|---|---|
| `payment_id` | płatność, która opłaciła zamówienie (moduł `payments`, bez FK); backfill z udanych płatności |
| `shipped_at` | pierwszy status u przewoźnika |
| `delivered_at`, `inspection_ends_at` | odbiór i koniec okna 36 h |
| `buyer_confirmed_at` | „Wszystko OK” |
| `completed_at` | zakończenie |
| `not_picked_up_at`, `lost_at`, `refunded_at` | stany wyjątkowe |
| `seller_compensated_at` | rekompensata za zaginioną paczkę |
| `chargeback_status` | `OPEN`, `WON`, `LOST` albo null |
| `second_chance_offer_id` | oferta, z której powstało zamówienie |

CHECK i indeksy:

- `delivered_at` i `inspection_ends_at` są razem albo żadne;
- `cancelled_at` tylko przy `CANCELLED_*` i `REFUNDED`;
- indeksy częściowe pod joby: `ship_by` dla `PAID`, `inspection_ends_at` dla `DELIVERED`, `lost_at` bez rekompensaty.

Trigger `orders_status_transition` (`BEFORE UPDATE OF status`) dopuszcza tylko pary z §7.3.

**`order_items.runner_ups`** (`jsonb`, domyślnie `[]`): kandydaci do drugiej szansy `[{ bidderId, maxAmount }]`.

**`second_chance_offers`** (moduł `orders`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `auction_id` | aukcja (bez FK) |
| `source_order_id` | anulowane zamówienie (FK) |
| `seller_id`, `bidder_id` | strony |
| `currency`, `amount` | cena: maksimum licytującego |
| `status` | `PENDING`, `ACCEPTED`, `DECLINED`, `EXPIRED` |
| `expires_at`, `responded_at` | ważność i odpowiedź |
| `order_id` | zamówienie po akceptacji (FK) |
| `created_at`, `updated_at` | czasy |

Indeksy: unikalny `(auction_id, bidder_id)` (jedna oferta na osobę), unikalny częściowy `(auction_id) WHERE status = 'PENDING'`, `(status, expires_at)`.

**`fund_releases`** (moduł `payments`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `order_id` | zamówienie (unikalne, bez FK) |
| `payment_id` | płatność (FK) |
| `provider`, `provider_transfer_id` | operator i ID transferu |
| `currency`, `amount` | część sprzedającego (cena) |
| `status` | `PENDING`, `SUCCEEDED`, `NOT_REQUIRED` |
| `released_at`, `created_at`, `updated_at` | czasy |

**`refunds`**:

- nowy powód `NOT_PICKED_UP`;
- kolumna `order_amounts` (`jsonb`), wymagana tylko przy tym powodzie: kwoty zamówienia do księgowania `NOT_PICKED_UP_REFUNDED`.

## API i zdarzenia

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `GET /v1/orders/:id` | strony | `OrderDetailsDto`; inni 404 |
| `POST /v1/orders/:id/confirm-receipt` | kupujący | „Wszystko OK”; 409 `ORDER_NOT_DELIVERED`, `ORDER_ON_HOLD` (chargeback) |
| `POST /v1/orders/:id/report-not-received` | kupujący | Zgłoszenie zaginięcia; 409 `ORDER_NOT_SHIPPED_YET`, `NOT_RECEIVED_TOO_EARLY` (z datą), `SHIPMENT_FINISHED` |
| `POST /v1/orders/:id/second-chance-offers` | sprzedający | Oferta do kolejnego kandydata; 201; 409 `SECOND_CHANCE_UNAVAILABLE` (z przyczyną) |
| `GET /v1/second-chance-offers/:id` | licytujący | `SecondChanceOfferDto`; inni 404 |
| `POST /v1/second-chance-offers/:id/accept` | licytujący | Akceptacja: nowe zamówienie; 409 `SECOND_CHANCE_CLOSED`, 403 `BIDDING_BLOCKED` |
| `POST /v1/second-chance-offers/:id/decline` | licytujący | Odrzucenie; 409 `SECOND_CHANCE_CLOSED` |

`:id` zamówienia to UUID albo numer. Odpowiedzi `cache-control: private, no-store`. Akcje są idempotentne: ponowienie po sukcesie zwraca bieżący stan (200), bez drugiego efektu.

### Eventy (outbox, wersja 1)

Agregat `order`, w każdym `publicId`, `auctionId`, `buyerId`, `sellerId`:

- `OrderShipped`: `shippedAt`, `trackingNumber`, `carrierName`;
- `OrderDelivered`: `deliveredAt`, `inspectionEndsAt`;
- `OrderCompleted`: `completedAt`, `confirmedByBuyer`, `itemsTotal`;
- `OrderNotPickedUp`: `notPickedUpAt`;
- `OrderLost`: `lostAt`, `compensation` (cena);
- `OrderRefunded`: `refundedAt`, `amount`, `reason`.

Zmiany istniejących:

- `OrderCancelled.reason`: dochodzi `NOT_SHIPPED`;
- `OrderCreated`: opcjonalne `secondChanceOfferId`.

Oferty drugiej szansy (agregat `second-chance-offer`):

- `SecondChanceOffered`: `auctionId`, `sourceOrderId`, `sellerId`, `bidderId`, `amount`, `expiresAt`;
- `SecondChanceOfferResolved`: `auctionId`, `sourceOrderId`, `sellerId`, `bidderId`, `status` (`ACCEPTED`, `DECLINED`, `EXPIRED`), `orderPublicId` (po akceptacji).

Moduł `payments` (agregat `fund-release`):

- `FundsReleaseRequested`: `orderId`, `paymentId`, `amount`.

### Joby

- **Kolejka `orders`:**
  - `orders.expire-unshipped`, `orders.complete-inspected`, `orders.expire-second-chance`: co 60 s;
  - `orders.compensate-lost`: co godzinę.
- **Kolejka `notifications`:** `notifications.payment-reminder`, `notifications.ship-reminder`: joby z terminem.

## Reguły biznesowe i przypadki brzegowe

- **Terminy przejść pilnuje sweeper co minutę**, jak anulowanie nieopłaconych w F-25. Opóźnienie wynosi najwyżej minutę, a restart workera niczego nie gubi.
  - §15.3 przewiduje też joby per zamówienie. Dodamy je, gdy sweeper będzie za wolny (decyzja nr 117).
  - Joby z terminem w ID mają tylko przypomnienia: nie zmieniają stanu, a sprawdzają go przy wykonaniu.
- **Kolejność blokad:** każde przejście blokuje wiersz zamówienia i sprawdza status, więc wyścigi rozstrzyga kolejność blokad:
  - „Wszystko OK” z auto-zakończeniem: jedno zakończenie;
  - nadanie z jobem nienadania: jeśli job był pierwszy, nadanie przychodzi do anulowanego zamówienia i trafia do logów.
- **Ledger:**
  - zakończenie i zwroty księgujemy kluczami zamówienia albo zwrotu, więc ponowienie konsumenta nie dubluje wpisów;
  - po każdym stanie końcowym (`COMPLETED`, `REFUNDED`, `CANCELLED_UNPAID`) saldo `buyer_funds_held` zamówienia wynosi 0.
- **Zwrot zawsze dotyczy płatności, która opłaciła zamówienie** (`payment_id`). Zdublowane płatności zwraca już F-25.
- **Nienadanie:** termin `ship_by` to koniec 5. dnia roboczego z kalendarzem świąt (F-25). Status przesyłki ponad `CREATED` oznacza nadanie, nawet jeśli event jeszcze nie dotarł.
- **Okno 36 h** liczymy od chwili wykrycia odbioru. Przy kurierze to status „doręczona”, przy paczkomacie i punkcie „odebrana” (jeden wewnętrzny `DELIVERED`, F-24).
- **Zgłoszenie braku paczki:**
  - 14 dni liczymy od `shipped_at`;
  - przesyłka z końcowym statusem (`DELIVERED`, `RETURNED`) blokuje zgłoszenie;
  - kupujący z odebraną paczką, który twierdzi, że jej nie dostał, idzie ścieżką sporu (F-28).
- **Druga szansa:**
  - jedna oferta na licytującego i aukcję (także po odrzuceniu), najwyżej jedna oczekująca na aukcję;
  - nowe zamówienie dopiero po akceptacji, a unikalny indeks aktywnej pozycji aukcji gwarantuje najwyżej jedno aktywne zamówienie;
  - limit maksymalnej oferty kupującego nie dotyczy oferty (maksimum mieściło się w limicie przy licytacji), ale blokada licytowania tak;
  - termin wysłania: 14 dni od anulowania (decyzja nr 119).
- **Kandydaci** to licytujący z ważnymi ofertami: oferty unieważnione (F-15) się nie liczą. Sprzedający widzi zanonimizowaną nazwę (`anonymizeName`, jak w historii ofert), a nie ID konta.
- **Chargeback `OPEN`** blokuje zakończenie, ale nie zwroty: przegrany chargeback rozliczy F-28.
- **Zgłoszenie zaginięcia i rekompensata** nie zależą od wyniku reklamacji. Wynik zmienia tylko podział między odszkodowanie a stratę Biddy.

## Bezpieczeństwo i prywatność

- Wszystkie trasy wymagają sesji. Zamówienie widzą tylko jego strony, a ofertę drugiej szansy tylko adresat; inni dostają 404.
- Sprzedający nie poznaje ID konta ani nazwy licytującego przed akceptacją, tylko zanonimizowaną nazwę i kwotę.
- Po akceptacji strony widzą się jak w zwykłym zamówieniu (nazwa wyświetlana, dane dostawy według F-24).
- Akcje kupującego i sprzedającego sprawdzają rolę po stronie serwera; przyciski w UI są tylko podpowiedzią.

## Analityka

PostHog (za zgodą, F-06), bez kwot i danych osobowych:

- `order_viewed` (rola, stan);
- `order_receipt_confirmed`;
- `order_not_received_reported`;
- `second_chance_sent`, `second_chance_accepted`, `second_chance_declined`.

## Kryteria akceptacji

- [x] Given dowolna para stanów, When zamówienie ma przejść z jednego w drugi, Then przejście udaje się wyłącznie dla par z §7.3 (test wszystkich par w kodzie i w bazie przez trigger).
- [x] Given zamówienie `DELIVERED` bez potwierdzenia, When mija 36 h od odbioru, Then job zmienia je w `COMPLETED`, a cena trafia na saldo dostępne sprzedającego w ledgerze (POK i dostawa jako przychody, `buyer_funds_held` = 0).
- [x] Given „Wszystko OK” kupującego, Then zamówienie od razu jest `COMPLETED` z tym samym księgowaniem, a drugie kliknięcie i job niczego nie dublują.
- [x] Given otwarty chargeback, When mija 36 h, Then zamówienie zostaje `DELIVERED`.
- [x] Given nieopłacone zamówienie, Then kupujący dostaje przypomnienia po 1 h, 12 h i 20 h; po 24 h zamówienie jest anulowane ze strike'iem, a sprzedający może wysłać ofertę drugiej szansy.
- [x] Given oferta drugiej szansy, When licytujący ją akceptuje, Then powstaje nowe zamówienie `AWAITING_PAYMENT` z ceną równą jego maksimum i terminem 24 h, a poprzednie przestaje być aktywne; odrzucona albo wygasła oferta pozwala wysłać ofertę następnej osobie.
- [x] Given opłacone zamówienie bez nadania, When mija 5. dzień roboczy (z uwzględnieniem świąt), Then zamówienie jest `CANCELLED_NOT_SHIPPED`, przygotowana przesyłka anulowana, sprzedający ma strike `NOT_SHIPPED`, a po potwierdzeniu zwrotu zamówienie jest `REFUNDED` z pełną kwotą.
- [x] Given paczka nieodebrana (`RETURNING`, `NOT_COLLECTED`), Then zamówienie jest `NOT_PICKED_UP` bez zwrotu; dopiero `RETURNED` zleca zwrot ceny i POK (bez dostawy), a po potwierdzeniu zamówienie jest `REFUNDED`.
- [x] Given paczka bez statusu końcowego 14 dni po nadaniu, When kupujący zgłasza brak paczki, Then zamówienie jest `LOST`, powstaje reklamacja u przewoźnika i pełny zwrot, a sprzedający dostaje rekompensatę równą cenie po rozstrzygnięciu reklamacji albo po 30 dniach.
- [x] Given każdy stan końcowy (`COMPLETED`, `REFUNDED` po nienadaniu, nieodebraniu i zaginięciu, `CANCELLED_UNPAID` ze spóźnioną płatnością), Then saldo `buyer_funds_held` zamówienia wynosi 0.
- [x] Given web na atrapie API, Then strona zamówienia pokazuje stan i akcję dla obu stron, „Wszystko OK” i druga szansa działają, axe bez naruszeń WCAG 2.1 AA, bez poziomego przewijania przy 390 px.

## Plan testów

- **Jednostkowe (api):**
  - `canTransition` dla wszystkich 144 par;
  - wybór kolejnego kandydata drugiej szansy;
  - termin zgłoszenia braku paczki i okno 36 h;
  - mapowanie statusu przesyłki na przejście.
- **Jednostkowe (shared):** nowe typy powiadomień i ich e-maile.
- **Integracyjne (Postgres, Redis):**
  - trigger: każda para stanów na prawdziwym wierszu;
  - nadanie, doręczenie i nieodebranie z eventów `ShipmentStatusChanged` (także pierwszy status od razu `DELIVERED`, zdarzenia dla anulowanego zamówienia);
  - „Wszystko OK” i job zakończenia (ledger, `fund_releases`, chargeback, równoległe wywołania);
  - job nienadania (święta, przesyłka `CREATED` z synchronizacją, nadana przed chwilą, `REQUESTED`), strike i zwrot do `REFUNDED`;
  - nieodebrana paczka: `NOT_PICKED_UP`, `RETURNED`, zwrot bez dostawy w ledgerze;
  - zaginięcie: walidacje, reklamacja, zwrot, rekompensata po rozstrzygnięciu i po 30 dniach, rozliczenie reklamacji;
  - druga szansa: kandydaci z zakończenia, wysłanie, akceptacja (nowe zamówienie, POK), odrzucenie, wygaśnięcie, blokada licytowania, warunki 409;
  - przypomnienia (płatność, nadanie) i powiadomienia etapów;
  - `GET /v1/orders/:id` dla obu stron i obcej osoby;
  - niezmiennik `buyer_funds_held` = 0 po każdym stanie końcowym.
- **Web (Vitest, Testing Library):** strona zamówienia (stany i akcje obu stron, „Wszystko OK”, zgłoszenie braku paczki, druga szansa), strona oferty (akceptacja, odrzucenie, stany końcowe), Moje Biddy (linki i akcja „Druga szansa”).
- **E2E (Playwright, atrapa API):** kupujący potwierdza odbiór, sprzedający wysyła drugą szansę, licytujący ją przyjmuje; axe, 390 px.

## Postęp i odstępstwa (2026-11-02)

Gotowe:

- migracja `0020_order_lifecycle` z triggerem przejść i backfillem `payment_id` oraz `runner_ups`;
- `OrderLifecycle` (konsumenci przesyłki, zwrotów i reklamacji, „Wszystko OK”, zgłoszenie braku paczki, joby terminów);
- `SecondChanceService` z trasami, `EscrowService` z tabelą `fund_releases`, zwrot `NOT_PICKED_UP`;
- strike `NOT_SHIPPED` i historia zakończonych zamówień;
- 11 typów powiadomień z przypomnieniami;
- strony `/zamowienia/[publicId]` i `/druga-szansa/[id]`, linki i akcja „Druga szansa” w Moje Biddy.

Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 117–121.

Odstępstwa:

- **„Nie otrzymałem paczki”** to forma męska, więc UI mówi „Paczka nie dotarła?” i „Zgłoś brak paczki” (neutralnie płciowo). Trasa API: `report-not-received`.
- **Akceptacja przy blokadzie licytowania** zwraca 403 `BIDDING_BLOCKED` (ten sam błąd co licytowanie, F-61) zamiast osobnego kodu.
- **Widok zamówienia ma `auction.id`** (UUID aukcji), bo „Wystaw ponownie” przyjmuje tylko UUID.
- **Przypomnienie o nadaniu** powstaje tylko wtedy, gdy doba przed terminem wypada po opłaceniu.
- **Strona aukcji dla kupującego z drugiej szansy** nadal pokazuje przegraną licytację (liderem aukcji był ktoś inny). Zakup jest w Moje Biddy → Wygrane i na stronie zamówienia. Zwycięzca, który nie zapłacił, widzi na stronie aukcji i w Wygranych swoje anulowane zamówienie, a nie zamówienie z drugiej szansy.
- **Przesyłka `CREATED` po terminie nadania:** test integracyjny sprawdza paczkę nadaną bez webhooka (synchronizacja przed decyzją) i przesyłkę nienadaną (anulowanie u dostawcy).
- **Święta przy terminie nadania:** `ship_by` liczy F-25 (`businessDayDeadline` z kalendarzem świąt, testy w `@biddy/shared`), a job F-26 używa tej kolumny.

## Otwarte pytania

- **Zwrot do nadawcy z innego powodu niż nieodebranie** (np. uszkodzona etykieta): pełny zwrot automatycznie czy decyzja supportu?
- **Limit odpowiedzialności przewoźnika:** rekompensata = cena, ale §7.9 ogranicza ją do limitu przewoźnika. Limity znamy dopiero z umowy z Furgonetką (§8.5).
- **Druga szansa a ponowne wystawienie:** sprzedający może wystawić przedmiot ponownie i jednocześnie wysłać drugą szansę. Czy blokować drugą szansę po ponownym wystawieniu?
