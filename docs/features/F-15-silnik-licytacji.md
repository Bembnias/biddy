# F-15 · Silnik licytacji

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-04, F-08, F-13, F-14

## Kontekst i cel

Oferta to wiążąca deklaracja zakupu ([PROJECT.md §6.6](../PROJECT.md#66-wiążący-charakter-ofert)), a cena i lider decydują o pieniądzach dwóch osób. Silnik musi przyjmować oferty poprawnie (licytacja automatyczna §6.4, kroki przebicia §6.3, cena minimalna, Kup teraz), spójnie przy wielu równoczesnych ofertach na jedną aukcję i odpornie na ponowienia żądań (słaba sieć w telefonie, podwójne kliknięcie). Do tego anti-sniping (§6.5), limity kupujących (§4.1) i unieważnienie oferty z przeliczeniem stanu (§15.6).

F-15 to backend; strona aukcji z panelem licytacji to F-18, aktualizacje na żywo F-17, zamykanie aukcji i zamówienia F-16.

## Historyjki użytkownika

- Jako kupujący chcę podać maksymalną kwotę i nie pilnować aukcji: system licytuje za mnie najmniejszymi krokami.
- Jako kupujący chcę, żeby moje maksimum było tajne i żeby nikt nie podbijał ceny w ostatniej sekundzie bez szansy na odpowiedź.
- Jako kupujący chcę kupić od razu za cenę Kup teraz, dopóki nikt nie licytuje.
- Jako kupujący nie chcę, żeby ponowione kliknięcie (słaby zasięg) złożyło drugą ofertę.
- Jako support chcę unieważnić ofertę z oczywistą literówką albo z podbijania przez sprzedającego i mieć poprawnie przeliczony stan aukcji.
- Jako kupujący chcę zobaczyć historię ofert bez danych innych licytujących.

## Zakres

### Licytacja automatyczna jako czysta funkcja

`resolve(stan, oferta)` w `@biddy/shared` (`bidding`): stan aukcji (cena wywoławcza, cena minimalna, aktualna cena, lider i jego maksimum) i nowa oferta (licytujący, maksimum) → nowy stan i oferty do zapisu albo odrzucenie. Reguły z §6.4:

1. **Ważność:** maksimum ≥ minimalna kolejna oferta (`minimumNextBid` z F-13; pierwsza oferta: ≥ cena wywoławcza). Lider podnoszący maksimum: nowe maksimum > dotychczasowe (bez wymogu kroku).
2. **Nowy lider** (maksimum > maksimum lidera): cena = min(nowe maksimum, maksimum lidera + krok przy maksimum lidera). Pierwsza oferta: cena = cena wywoławcza.
3. **Lider bez zmian** (maksimum ≤ maksimum lidera): cena = min(maksimum lidera, nowe maksimum + krok przy nowym maksimum). **Remis wygrywa wcześniejsza oferta.**
4. **Cena minimalna:** jeśli maksimum lidera ≥ cena minimalna, a cena jest niższa, cena rośnie do ceny minimalnej (także gdy lider tylko podnosi maksimum, reguła 5).
5. **Lider podnosi maksimum:** cena się nie zmienia (poza regułą 4).

Zapisywane oferty: oferta użytkownika (`MANUAL`, kwota = cena po rozstrzygnięciu dla nowego lidera albo jego maksimum, gdy przegrywa z liderem) i ewentualna automatyczna oferta lidera (`AUTO`, kwota = nowa cena), gdy lider odpowiedział na przebicie. Wynik mówi też, czy zmieniła się cena albo lider (anti-sniping) i kto został przebity.

`replay(stan początkowy, oferty)` przelicza aukcję od zera, przepuszczając ręczne oferty po kolei przez `resolve` (§15.6).

### Składanie oferty (§15.1)

- `POST /v1/auctions/{id}/bids` `{ maxAmount }` z nagłówkiem **`Idempotency-Key`** (wymagany, 1–100 znaków `[A-Za-z0-9_-]`).
- Jedna transakcja z blokadą wiersza aukcji (`FOR UPDATE`); czas z `clock_timestamp()` po uzyskaniu blokady (`now()` to początek transakcji, a ta mogła czekać na blokadę).
- Walidacje: aukcja `ACTIVE` i przed końcem (inaczej 409 `AUCTION_ENDED`; szkic i aukcja w moderacji: 404), licytujący to nie sprzedający (403 `OWN_AUCTION`), zweryfikowany telefon (`@RequireVerifiedPhone`, F-08), brak blokady licytowania (403 `BIDDING_BLOCKED` z datą, kolumna `bidding_blocked_until`, nadawana w F-61), limity kupującego §4.1 (403 `BID_LIMIT_EXCEEDED`: maksimum oferty i liczba aukcji z aktywną ofertą; nowe konto: 500 zł i 10 aukcji; poziomy z historii zamówień to F-61), kwota (409 `BID_TOO_LOW` z `minimumBid`).
- **Kolejność ofert:** każda oferta dostaje numer kolejny w aukcji (`sequence`, licznik w wierszu aukcji), więc przeliczenie od zera (replay) nie zależy od zegara.
- **Anti-sniping** (§6.5): oferta w ostatnich 2 minutach (`AUCTION_ANTI_SNIPING_SECONDS`, domyślnie 120), która zmieniła cenę albo lidera, przesuwa koniec na teraz + 2 minuty. Bez limitu przedłużeń; `ends_at` nigdy się nie cofa. `original_ends_at` zostaje.
- **Idempotencja:** ponowienie z tym samym kluczem zwraca tę samą ofertę z aktualnym stanem aukcji (nagłówek `idempotent-replayed: true`) i nie tworzy drugiej oferty; ten sam klucz z inną kwotą albo inną aukcją: 422 `IDEMPOTENCY_KEY_REUSED`. Klucz jest zapisany przy ofercie (unikalny dla licytującego), a sprawdzenie powtarza się pod blokadą, więc dwa równoległe żądania z tym samym kluczem też dają jedną ofertę.
- Odpowiedź: identyfikator oferty, czy licytujący prowadzi, jego maksimum, aktualna cena, liczba ofert, koniec aukcji, stan ceny minimalnej (`reserveStatus`: brak, nieosiągnięta, osiągnięta; bez kwoty) i minimalna kolejna oferta.
- Eventy (outbox): `BidPlaced`, `UserOutbid` (poprzedni lider, gdy zmienił się lider), `AuctionExtended`.

### Kup teraz

- `POST /v1/auctions/{id}/buy-now` z `Idempotency-Key`. Dostępne, gdy aukcja ma cenę Kup teraz i nie ma ofert (inaczej 409 `BUY_NOW_UNAVAILABLE`); te same walidacje kupującego co przy ofercie (limit maksimum oferty liczony od ceny Kup teraz).
- Zapis oferty `BUY_NOW`, aukcja `ENDED_SOLD` (lider = kupujący, cena = Kup teraz, koniec = teraz), event `AuctionEnded` (`endedBy: BUY_NOW`). Zamówienie w tej samej transakcji doda F-16.

### Unieważnienie oferty (§15.6)

- `POST /v1/admin/bids/{id}/cancel` `{ reason: TYPO | FRAUD, note }`, tylko dla personelu (`support`, `moderator`, `admin`). Do czasu osobnej sesji panelu admina (F-34) sprawdzamy rolę konta w zwykłej sesji.
- W jednej transakcji z blokadą aukcji: oferta → `CANCELLED` (powód, kto), wszystkie `AUTO` → `CANCELLED` (`REPLAY`), replay ręcznych ofert od zera przez `resolve`, nowe oferty `AUTO`, nowy stan aukcji. `ends_at` się nie zmienia. Oferta ręczna, której replay nie przyjmie (rzadkie: zależała od unieważnionej), też dostaje `CANCELLED` (`REPLAY`).
- Tylko aukcja `ACTIVE`; po zakończeniu (zamówienie nieopłacone, druga szansa) to F-26. Event `BidCancelled` (z nowym liderem i ceną).

### Historia ofert

`GET /v1/auctions/{id}/bids?before={sequence}`: ważne oferty od najnowszej (do 50, kursor `before`), z kwotą, rodzajem (ręczna, automatyczna, Kup teraz), czasem i zanonimizowanym licytującym (np. „k***a”: pierwsza i ostatnia litera imienia wyświetlanego). Maksima i identyfikatory licytujących nie są publiczne. Szkic i aukcja w moderacji: 404.

## Poza zakresem

- Strona aukcji i panel licytacji (F-18), WebSocket i `auction.updated` (F-17), zamykanie aukcji i zamówienia (F-16), powiadomienia o przebiciu (moduł powiadomień).
- Wykrywanie powiązanych kont i blokada licytowania aukcji powiązanego sprzedawcy (F-36); w F-15 tylko zakaz licytowania własnej aukcji.
- Poziomy kupujących z historii, nadpisania limitów i strike'i (F-61), UI unieważniania w panelu admina (F-34), unieważnienie po zakończeniu aukcji (F-26).

## UX

Brak ekranów w F-15 (panel licytacji w F-18). Komunikaty błędów API po polsku, gotowe do pokazania przy polu kwoty:

| Kod | Komunikat (przykład) |
|---|---|
| `BID_TOO_LOW` | „Najniższa możliwa oferta to 21 zł.” (`minimumBid` w groszach) |
| `BID_LIMIT_EXCEEDED` | „Jako nowy kupujący możesz zaoferować najwyżej 500 zł. Limit rośnie po opłaconych zamówieniach.” |
| `BIDDING_BLOCKED` | „Masz blokadę licytowania do 12 listopada 2026, 14:00.” |
| `AUCTION_ENDED` | „Aukcja już się zakończyła.” |
| `OWN_AUCTION` | „Nie możesz licytować własnej aukcji.” |
| `BUY_NOW_UNAVAILABLE` | „Kup teraz jest niedostępne: aukcja ma już oferty.” |

## Model danych

Migracja `0012_bids`:

- `bids` (moduł `auctions`): `id`, `auction_id` (FK), `bidder_id`, `sequence` (kolejność w aukcji, unikalna z `auction_id`), `amount`, `max_amount`, `kind` (`MANUAL`/`AUTO`/`BUY_NOW`), `status` (`VALID`/`CANCELLED`), `cancel_reason` (`TYPO`/`FRAUD`/`REPLAY`), `cancelled_by`, `cancelled_at`, `idempotency_key` (unikalny z `bidder_id`), `created_at`. Indeksy: (`auction_id`, `sequence`), (`bidder_id`, `status`).
- `auctions`: `bid_sequence` (ostatni numer oferty).
- `users`: `bidding_blocked_until`.

## API i zdarzenia

- `POST /v1/auctions/{id}/bids` `{ maxAmount }` + `Idempotency-Key` → 201 `BidResultDto` (ponowienie: ta sama oferta, nagłówek `idempotent-replayed`). Błędy jak w tabeli wyżej, brak nagłówka: 400 `VALIDATION_FAILED`.
- `POST /v1/auctions/{id}/buy-now` + `Idempotency-Key` → 201 `BidResultDto` (aukcja `ENDED_SOLD`).
- `GET /v1/auctions/{id}/bids?before=` → `BidHistoryDto` (publiczne, `cache-control: no-store`).
- `POST /v1/admin/bids/{id}/cancel` `{ reason, note }` → 200 stan aukcji po przeliczeniu.
- Nowe kody: `BID_TOO_LOW` (409), `BID_LIMIT_EXCEEDED` (403), `BIDDING_BLOCKED` (403), `AUCTION_ENDED` (409), `OWN_AUCTION` (403), `BUY_NOW_UNAVAILABLE` (409), `IDEMPOTENCY_KEY_REUSED` (422).
- Eventy: `BidPlaced`, `UserOutbid`, `AuctionExtended`, `AuctionEnded` (Kup teraz; zamykanie po czasie w F-16), `BidCancelled`.

## Reguły biznesowe i przypadki brzegowe

- Kwoty w groszach; ten sam krok przebicia co w formularzu (F-13).
- Maksimum lidera jest tajne: nie trafia do odpowiedzi innych licytujących, historii ani eventów publicznych (tylko w wierszu aukcji i ofercie).
- Licytujący przebity od razu (maksimum ≤ maksimum lidera) dostaje odpowiedź „nie prowadzisz” z nową minimalną ofertą.
- Oferta po `ends_at` (także o milisekundy, liczone czasem bazy) jest odrzucana, nawet jeśli job zamknięcia jeszcze nie zadziałał (F-16).
- Kup teraz po pierwszej ofercie jest niedostępne; oferta po Kup teraz trafia na `AUCTION_ENDED`.
- Replay nie zmienia `ends_at` (przedłużenia już się wydarzyły).

## Bezpieczeństwo i prywatność

- Historia i eventy publiczne bez identyfikatorów i maksimów licytujących; imię zanonimizowane.
- Idempotency-Key w nagłówku (§14.1), zakres per licytujący, więc cudzy klucz niczego nie odtworzy.
- Unieważnienie tylko dla personelu, z powodem i notatką w logach (pełny audit log w F-34).

## Analityka

Brak w F-15 (zdarzenia `bid_placed` i `buy_now` w panelu licytacji, F-18).

## Kryteria akceptacji

- [x] Given dowolne ciągi ofert (property-based), Then cena nie maleje, nie przekracza maksimum lidera, jest ≥ cena wywoławcza, lider ma najwyższe maksimum (remis: wcześniejsza oferta), a stan zgadza się z niezależnie liczonym wzorem (drugie najwyższe maksimum + krok).
- [x] Given 50 równoległych ofert na jedną aukcję, Then stan aukcji jest spójny: zgadza się z przeliczeniem zapisanych ofert od zera, numery ofert są unikalne, liczba ofert się zgadza.
- [x] Given ponowione żądanie z tym samym `Idempotency-Key` (także równolegle), Then powstaje jedna oferta, a odpowiedź jest ta sama.
- [x] Given oferta w ostatnich 2 minutach, która zmienia cenę albo lidera, Then koniec aukcji przesuwa się na teraz + 2 minuty; lider podnoszący tylko maksimum nie przedłuża aukcji, a koniec nigdy się nie cofa.
- [x] Given aukcja z ofertą, Then Kup teraz zwraca `BUY_NOW_UNAVAILABLE`; bez ofert Kup teraz kończy aukcję jako sprzedaną.
- [x] Given oferta powyżej limitu konta, Then API zwraca `BID_LIMIT_EXCEEDED`.
- [x] Given unieważnienie oferty, Then stan aukcji jest taki sam jak po złożeniu pozostałych ofert po kolei (property-based dla `replay`, integracyjnie dla endpointu admina).

## Plan testów

- **Shared, jednostkowe i property-based (fast-check):** `resolve` (każda reguła §6.4 na przykładach, cena minimalna, remis, podniesienie maksimum, odrzucenia), niezmienniki i wzór niezależny, `replay` = składanie po kolei, `replay` bez jednej oferty = złożenie pozostałych.
- **API, jednostkowe:** anonimizacja imion, klucz idempotencji.
- **API, integracyjne (Postgres, Redis):** oferta i odpowiedź, wszystkie odrzucenia (status, czas, własna aukcja, telefon, blokada, limity, kwota), anti-sniping (przesunięcie i brak przesunięcia), idempotencja (ponowienie, równoległe, inny payload), Kup teraz, historia (anonimizacja, kursor), unieważnienie z replayem i uprawnieniami, eventy w outboxie, **50 równoległych ofert**, blokada edycji aukcji po ofercie (F-14).

## Otwarte pytania

- Wartość okna anti-snipingu: **domyślnie** 2 minuty (§6.5), konfigurowalna zmienną środowiskową.
- Czy pokazywać w historii podniesienie maksimum przez lidera (cena bez zmian): **domyślnie** tak, jako zwykła oferta z tą samą kwotą (bez ujawniania maksimum), jak na eBay.
