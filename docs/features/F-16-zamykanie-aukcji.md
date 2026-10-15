# F-16 · Zamykanie aukcji

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-04, F-13, F-14, F-15

## Kontekst i cel

Aukcja musi skończyć się na czas i dokładnie raz ([PROJECT.md §6.7](../PROJECT.md#67-zakończenie-aukcji), [§15.2](../PROJECT.md#152-zamykanie-aukcji)): kupujący licytujący w końcówce muszą wiedzieć, że oferta po czasie nie przejdzie, a zwycięzca dostaje jedno zamówienie z terminem płatności 24 h (§6.8). Przedłużenia z anti-snipingu (F-15) przesuwają koniec, a zaginiony job (restart workera, awaria Redisa) nie może zostawić aukcji otwartej.

F-16 dodaje zamykanie (job z terminem i sweeper), podstawową tabelę zamówień z utworzeniem zamówienia w tej samej transakcji co zamknięcie (także przy Kup teraz z F-15) i anulowanie aukcji przez moderację.

## Historyjki użytkownika

- Jako zwycięzca chcę od razu po końcu aukcji dostać zamówienie z kwotą do zapłaty (cena + POK) i terminem.
- Jako sprzedający chcę, żeby aukcja bez ofert albo z nieosiągniętą ceną minimalną zakończyła się bez sprzedaży.
- Jako licytujący w ostatniej chwili chcę, żeby przedłużona aukcja nie zamknęła się przed nowym czasem końca.
- Jako moderator chcę usunąć aukcję łamiącą regulamin, także z ofertami.

## Zakres

### Zamykanie (§15.2)

- **Planowanie:** konsument eventów `auctions.schedule-close` (outbox, F-04) na `AuctionPublished` i `AuctionExtended` dodaje opóźniony job `auction.close` (kolejka `auctions`) na `ends_at`, z ID zawierającym termin (`close-{auctionId}-{endsAtMs}`, `deadlineJobId`). Ten sam termin dodany drugi raz to ten sam job; nowy termin po przedłużeniu to nowy job. Planowanie przez outbox działa po zatwierdzeniu transakcji publikacji albo oferty i jest ponawiane, więc job nie zginie razem z odrzuconą transakcją.
- **Job `auction.close`:** transakcja z blokadą wiersza aukcji (`FOR UPDATE`). Aukcja nie `ACTIVE` (już zamknięta, anulowana, Kup teraz): nic. Przed `ends_at` (przedłużona): nowy job na aktualny `ends_at`. Po `ends_at`: zamknięcie.
- **Sweeper** co 10 s (job cykliczny `auctions.close-sweeper`, kolejka `auctions`): aukcje `ACTIVE` z `ends_at` ≤ teraz − 5 s (do 100 naraz) zamyka tą samą funkcją. Najgorszy przypadek przy zaginionym jobie: ok. 15 s opóźnienia (wymóg: ≤ 30 s). Wyścig joba ze sweeperem jest bezpieczny dzięki blokadzie wiersza i sprawdzeniu statusu.
- **Wynik:** jest lider i (brak ceny minimalnej albo cena ≥ cena minimalna) → `ENDED_SOLD` i zamówienie; inaczej `ENDED_UNSOLD`. Event `AuctionEnded` (`endedBy: TIME`). Opóźnienie zamknięcia względem `ends_at` trafia do logów (metryka do alertu).
- Czas zamknięcia z `clock_timestamp()` bazy (jak w F-15).

### Zamówienia (podstawowe)

Moduł `orders` (§10.3) z publicznym `OrderService.createForAuction(tx, …)` wołanym przez `auctions` w transakcji zamknięcia:

- **`orders`:** krótki `public_id`, kupujący, sprzedający, status `AWAITING_PAYMENT` (ograniczenie zna wszystkie stany z §7.3, przejścia w F-26), `items_total` (wylicytowana kwota), `pok_fee` i `pok_vat` (F-13, cennik z chwili zakończenia), `total` (kwota + POK; dostawa dojdzie w checkout, F-25, `shipping_fee` null), `fee_schedule_id`, `payment_due_at` = koniec aukcji + 24 h (§6.8).
- **`order_items`:** aukcja, `hammer_price`, `item_snapshot` (JSONB), `is_active`. **Unikalny indeks częściowy `order_items(auction_id) WHERE is_active`**: najwyżej jedno aktywne zamówienie na aukcję, nawet przy błędzie w kodzie.
- **Snapshot przedmiotu** (§13.1): tytuł, opis, stan, marka, kategoria (ścieżka nazw), atrybuty (z etykietami, `describeAttributes`, i surowe wartości), gabaryt i wymiary, przewoźnicy, zdjęcia (adresy wariantów), numer aukcji, cena wywoławcza, koniec i sposób zakończenia. Opis aukcji po sprzedaży może zniknąć albo się zmienić (ponowne wystawienie, F-14), a zamówienie zostaje takie, jak w chwili zakupu.
- **Kup teraz** (F-15) tworzy zamówienie w tej samej transakcji co zakończenie aukcji.
- Event `OrderCreated` (powiadomienia o wygranej i przypomnienia o płatności: F-26, F-28).

### Anulowanie przez moderację

- `POST /v1/admin/auctions/{id}/cancel` `{ note }` (role `moderator`, `admin`; do czasu osobnej sesji panelu w F-34 rola ze zwykłej sesji): aukcja `ACTIVE` albo `PENDING_REVIEW`, także z ofertami i w ostatnich 12 h (inaczej niż sprzedający, §6.6). Status `CANCELLED`, event `AuctionCancelled` z `cancelledBy: MODERATOR` i uzasadnieniem (uzasadnienie dla sprzedającego i odwołanie: F-35; strike tylko z decyzji moderatora, F-61). Job zamknięcia po anulowaniu nic nie robi.

## Poza zakresem

- Przejścia stanów zamówienia, terminy płatności i nadania, druga szansa (F-26), checkout i dostawa w kwocie (F-25), widoki zamówień (F-25, F-26).
- Powiadomienia o wygranej, sprzedaży i braku sprzedaży (F-28), `user.won` przez WebSocket (F-17).
- Unieważnienie oferty po zakończeniu aukcji (F-26), UI moderacji (F-34, F-35).

## UX

Brak ekranów w F-16 (strona aukcji ze stanem „zakończona” to F-18, zamówienia to F-25 i F-26).

## Model danych

Migracja `0013_orders`:

- `orders` (moduł `orders`): `id`, `public_id` (unikalny), `buyer_id`, `seller_id`, `status`, `currency`, `items_total`, `pok_fee`, `pok_vat`, `shipping_fee` (null do checkoutu), `total`, `fee_schedule_id` (uuid bez FK: moduł `payments`), `payment_due_at`, `created_at`, `updated_at`. Indeksy: (`buyer_id`, `created_at`), (`seller_id`, `created_at`), (`status`, `payment_due_at`) dla jobów terminów (F-26).
- `order_items`: `id`, `order_id` (FK), `auction_id` (uuid bez FK: moduł `auctions`), `hammer_price`, `item_snapshot`, `is_active`, `created_at`. Unikalny indeks częściowy (`auction_id`) gdzie `is_active`.
- Kolumny z §13.3 potrzebne dopiero w kolejnych stanach (`ship_by`, `delivered_at`, `inspection_ends_at`, `completed_at`, `cancelled_at`, `chargeback_status`, `second_chance_offer_id`) dodadzą F-25 i F-26 (expand, §18.2).

## API i zdarzenia

- `POST /v1/admin/auctions/{id}/cancel` `{ note }` → 200 (stan aukcji). Aukcja w innym stanie: 409 `CONFLICT`; brak roli: 403.
- Kolejka `auctions` (zamykanie, sweeper; współbieżność 10).
- Eventy: `AuctionEnded` (`endedBy: TIME`; F-15: `BUY_NOW`), `OrderCreated` (moduł `orders`), `AuctionCancelled` (`cancelledBy: MODERATOR`, uzasadnienie).

## Reguły biznesowe i przypadki brzegowe

- Oferta złożona w tej samej chwili co zamknięcie: obie operacje blokują wiersz aukcji; oferta po zamknięciu dostaje `AUCTION_ENDED`, zamknięcie po ofercie widzi nowy stan (i ewentualnie nowy `ends_at`).
- Kilka przedłużeń z rzędu: każdy job sprawdza `ends_at` pod blokadą, więc stare joby nic nie robią albo planują aktualny termin.
- Aukcja z ofertami poniżej ceny minimalnej: `ENDED_UNSOLD` (oferty zostają w historii; druga szansa poniżej ceny minimalnej to decyzja sprzedającego, F-26).
- Brak cennika POK w chwili zakończenia (błąd konfiguracji): job się nie udaje, ponowienia, a po wyczerpaniu prób dead-letter i Sentry (aukcja zostaje `ACTIVE`, sweeper będzie próbował dalej).

## Bezpieczeństwo i prywatność

- Snapshot nie zawiera danych osobowych poza identyfikatorami stron (adresy dojdą w checkout).
- Anulowanie przez moderację tylko z rolą i z uzasadnieniem w evencie i logach.

## Analityka

Brak (zdarzenia biznesowe z eventów domenowych w F-28 i panelu admina).

## Kryteria akceptacji

- [x] Given aukcja, której job zamknięcia zaginął, Then sweeper zamyka ją najpóźniej 30 s po czasie końca.
- [x] Given aukcja przedłużona kilka razy z rzędu (anti-sniping), Then nie kończy się przed ostatnim czasem końca, a kończy się po nim.
- [x] Given wielokrotne (także równoległe) wykonanie zamknięcia sprzedanej aukcji, Then istnieje dokładnie jedno aktywne zamówienie (unikalny indeks częściowy na `order_items`).
- [x] Given aukcja z ofertami poniżej ceny minimalnej albo bez ofert, Then status `ENDED_UNSOLD` i brak zamówienia.
- [x] Given sprzedana aukcja (czas albo Kup teraz), Then zamówienie `AWAITING_PAYMENT` z POK według cennika, terminem płatności 24 h i snapshotem przedmiotu powstaje w tej samej transakcji.

## Plan testów

- **API, integracyjne (Postgres, Redis, worker w procesie):** pełny łańcuch publikacja → event → job → zamknięcie; przedłużenia przez prawdziwe oferty (krótkie okno anti-snipingu w teście) i brak zamknięcia przed nowym końcem; sweeper dla aukcji bez joba; `ENDED_UNSOLD` (bez ofert, cena minimalna); równoległe zamknięcia i unikalny indeks; zamówienie (kwoty POK, termin, snapshot); Kup teraz z zamówieniem; anulowanie przez moderację (role, oferty, brak zamknięcia potem).

## Otwarte pytania

- Rozmiar porcji sweepera: **domyślnie** 100 aukcji co 10 s (z marginesem na start; przy większej skali partycjonowanie).
