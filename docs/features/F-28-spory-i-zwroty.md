# F-28 · Spory i zwroty

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-12 (zdjęcia), F-22 (ledger), F-23 (port płatności), F-24 (dostawy), F-26 (cykl zamówienia), F-27 (saldo), F-61 (strike'i)

## Kontekst i cel

Po F-26 kupujący ma 36 h na sprawdzenie przedmiotu, ale jedyne, co może zrobić, to kliknąć „Wszystko OK” albo poczekać. Strona zamówienia w oknie 36 h odsyła do pomocy, a maszyna stanów ma już przejścia `DELIVERED → DISPUTED → COMPLETED | REFUNDED | PARTIALLY_REFUNDED` ([PROJECT.md §7.3](../PROJECT.md#73-maszyna-stanów-zamówienia)), których nic nie używa. Gotowe są też klocki:

- ledger: szablony `ORDER_REFUNDED` (powód `DISPUTE`), `ORDER_PARTIALLY_REFUNDED`, `DISPUTE_COSTS_CHARGED` i `PARCEL_COMPENSATION_PAID` (F-22);
- zwroty przez operatora z kluczem idempotencji (`RefundService`, F-23 i F-26);
- przesyłki zwrotne `direction = RETURN` w tabeli `shipments` i reklamacje u przewoźnika (F-24);
- strike `DISPUTE_LOST` i `TradeHistoryService.recordDisputeLost` (F-61);
- pusty moduł `disputes` („spory, dowody, decyzje, zwroty”, [§10.3](../PROJECT.md#103-moduły-backendu-bounded-contexts)).

F-28 składa z nich spór z [§7.5](../PROJECT.md#75-spory):

- zgłoszenie w oknie 36 h (powód, opis, zdjęcia) i zamrożenie środków;
- odpowiedź sprzedającego w 48 h: zwrot (z odesłaniem albo bez), propozycja zwrotu częściowego albo odrzucenie;
- eskalację do Biddy z endpointem decyzji `POST /admin/disputes/:id/decision` (UI decyzji dojdzie w F-34);
- przesyłkę zwrotną z etykietą Biddy i weryfikację zwrotu przez sprzedającego;
- rozliczenie pieniędzy według [§7.5](../PROJECT.md#75-spory) i [§7.9](../PROJECT.md#79-straty-chargebacki-i-rekompensaty): zwrot pełny lub częściowy przez operatora, koszty dostawy po stronie winnego sprzedającego, rekompensata przy winie przewoźnika;
- widok sporu dla obu stron z uzasadnieniem każdej decyzji (DSA).

Cel: problem z przedmiotem kończy się przewidywalnie i w terminie, a pieniądze trafiają tam, gdzie wskazuje rozstrzygnięcie. Ledger zamówienia po każdym zakończeniu bilansuje się do zera.

## Historyjki użytkownika

- Jako kupujący w ciągu 36 h od odbioru zgłaszam problem: wybieram powód, opisuję go i dodaję zdjęcia. Wiem, że pieniądze czekają do rozstrzygnięcia.
- Jako sprzedający dostaję powiadomienie o zgłoszeniu i w 48 h zwracam pieniądze (z odesłaniem albo bez), proponuję zwrot części ceny albo odrzucam zgłoszenie z wyjaśnieniem.
- Jako kupujący przyjmuję albo odrzucam propozycję zwrotu częściowego.
- Jako kupujący przy zwrocie z odesłaniem dostaję etykietę od Biddy i nadaję paczkę w 5 dni roboczych.
- Jako sprzedający po odbiorze zwrotu mam 36 h, żeby go sprawdzić. Potwierdzam zwrot albo zgłaszam problem z jego stanem.
- Jako strona sporu bez porozumienia wiem, że sprawę rozstrzyga zespół Biddy w 72 h, i mogę dodać wyjaśnienia i zdjęcia.
- Jako strona sporu widzę rozstrzygnięcie z uzasadnieniem i wiem, ile pieniędzy dostanę.
- Jako moderator widzę spory po eskalacji (najstarsze pierwsze), ich historię i zdjęcia, i wydaję decyzję z uzasadnieniem przez API.

## Zakres

### Spór (moduł `disputes`)

Moduł `disputes` prowadzi przebieg sporu: stany, terminy, dowody, decyzje i przesyłkę zwrotną. Pieniędzmi i stanem zamówienia zarządza moduł `orders` przez nowe publiczne API (niżej), więc `disputes` zależy od `orders`, a nie odwrotnie.

- **Stany** (`disputes.status`) dokładnie według diagramu z §7.5:

  ```
  AWAITING_SELLER → RESOLVED | AWAITING_RETURN | PARTIAL_OFFERED | ESCALATED
  PARTIAL_OFFERED → RESOLVED | ESCALATED
  ESCALATED → AWAITING_RETURN | RESOLVED
  AWAITING_RETURN → RETURN_IN_TRANSIT | RESOLVED | ESCALATED
  RETURN_IN_TRANSIT → RETURN_DELIVERED | ESCALATED
  RETURN_DELIVERED → RESOLVED | ESCALATED
  ```

  Czysta funkcja `canDisputeTransition(from, to)` i trigger `disputes_status_transition` w bazie (jak przy zamówieniach w F-26). Poza diagramem z §7.5 dochodzą dwa przejścia do `ESCALATED`: zwrot, który wraca do kupującego zamiast dotrzeć do sprzedającego (`RETURN_IN_TRANSIT`), i przesyłka zwrotna, której nie da się utworzyć (`AWAITING_RETURN`). Obie sytuacje wymagają supportu.
- **Rozstrzygnięcie** (`outcome`): `SELLER_FAVOR` (na korzyść sprzedającego), `FULL_REFUND` (z winą `SELLER` albo `CARRIER`) albo `PARTIAL_REFUND` (z kwotą). Zapisujemy też, kto rozstrzygnął (`PARTIES`, `STAFF`, `SYSTEM`), kiedy i z jakim uzasadnieniem (`statement`). Uzasadnienie ma każde rozstrzygnięcie. Przy porozumieniu i terminach treść składa system, np. „Sprzedający zgodził się zwrócić pieniądze.”.
- **Historia** (`dispute_events`): każdy krok ze stroną (`BUYER`, `SELLER`, `STAFF`, `SYSTEM`), notatką, kwotą i zdjęciami. Na niej stoi oś czasu w widoku sporu.

### Zgłoszenie (kupujący)

- **`POST /v1/orders/:id/dispute`** z polami:
  - `reason`: `NOT_AS_DESCRIBED` (niezgodny z opisem), `DAMAGED` (uszkodzony), `INCOMPLETE` (niekompletny), `COUNTERFEIT` (podróbka), `NOT_RECEIVED` (paczka nie dotarła, choć tracking pokazuje doręczenie), `OTHER` (inny);
  - `description`: 20–2000 znaków;
  - `mediaIds`: do 10 zdjęć `DISPUTE_EVIDENCE`. Co najmniej jedno przy `NOT_AS_DESCRIBED`, `DAMAGED`, `INCOMPLETE` i `COUNTERFEIT`.
- **Warunki** (pod blokadą wiersza zamówienia):
  - zamówienie `DELIVERED`, inaczej 409 `DISPUTE_UNAVAILABLE`;
  - przed `inspection_ends_at`, inaczej 409 `DISPUTE_WINDOW_CLOSED` z datą końca okna;
  - bez otwartego chargebacku, inaczej 409 `ORDER_ON_HOLD`.
- **W jednej transakcji:**
  - `DELIVERED → DISPUTED` z `disputed_at` (`OrderDisputes.open`, moduł `orders`);
  - spór `AWAITING_SELLER` z terminem odpowiedzi `response_due_at` = teraz + 48 h;
  - wpis `OPENED` w historii i przypisanie zdjęć (`MediaService.attach`);
  - eventy `OrderDisputed` i `DisputeOpened`.
- **Zamrożenie środków:** pieniądze są już w `buyer_funds_held`. Zamówienie `DISPUTED` nie pasuje do joba auto-zakończenia ani do „Wszystko OK”, więc czeka na rozstrzygnięcie.
- **Jeden spór na zamówienie** (unikalne `order_id`). Ponowienie zgłoszenia zwraca istniejący spór (200).

### Odpowiedź sprzedającego (48 h)

`POST /v1/disputes/:id/seller-response` w stanie `AWAITING_SELLER`:

- **`ACCEPT`**, czyli zwrot pełnej kwoty (cena, POK i dostawa):
  - `returnRequired: false`: spór `RESOLVED` z rozstrzygnięciem `FULL_REFUND`, wina `SELLER`, rozstrzygnęły strony;
  - `returnRequired: true`: przesyłka zwrotna `PENDING` (niżej) i stan `AWAITING_RETURN` z terminem nadania zwrotu `return_ship_by` = 5 dni roboczych z kalendarzem świąt. Rozstrzygnięcie `FULL_REFUND` jest już zapisane, a wykona się po weryfikacji zwrotu.
  Odpowiedź może mieć notatkę.
- **`OFFER_PARTIAL`** z kwotą od 1 gr do ceny przedmiotu (`items_total`): stan `PARTIAL_OFFERED`. Kupujący ma 48 h na odpowiedź (`response_due_at`). Propozycja jest jedna; po odrzuceniu spór trafia do Biddy.
- **`REJECT`** z wyjaśnieniem (10–2000 znaków) i opcjonalnymi zdjęciami: stan `ESCALATED`.

Brak odpowiedzi w 48 h oznacza `ESCALATED` (job).

### Odpowiedź kupującego na propozycję (48 h)

`POST /v1/disputes/:id/offer-response` w stanie `PARTIAL_OFFERED`:

- `accept: true`: spór `RESOLVED` z rozstrzygnięciem `PARTIAL_REFUND` na zaproponowaną kwotę, rozstrzygnęły strony;
- `accept: false` (z opcjonalną notatką): `ESCALATED`.

Brak odpowiedzi w 48 h również oznacza `ESCALATED` (decyzja nr 131).

### Eskalacja i decyzja Biddy

- **`ESCALATED`** zapisuje `escalated_at` i `decision_due_at` = +72 h (SLA z §7.4, bez automatu) oraz wysyła powiadomienie obu stronom.
- **Wyjaśnienia stron:** `POST /v1/disputes/:id/comments` (notatka 1–2000 znaków, do 10 zdjęć). Obie strony mogą je dodawać w każdym stanie przed `RESOLVED`.
- **Kolejka personelu:** `GET /v1/admin/disputes?status=ESCALATED` (`support`, `moderator`, `admin`), najstarsza eskalacja pierwsza, z terminem decyzji.
- **Widok personelu:** `GET /v1/admin/disputes/:id` pokazuje to samo co strony oraz:
  - ID stron;
  - kwoty zamówienia;
  - przesyłkę do kupującego z trackingiem;
  - przesyłkę zwrotną;
  - zdjęcia z aukcji (snapshot).
- **Decyzja:** `POST /v1/admin/disputes/:id/decision` (`support`, `moderator`, `admin`), tylko w stanie `ESCALATED`:

  | Pole | Opis |
  |---|---|
  | `outcome` | `SELLER_FAVOR`, `FULL_REFUND`, `PARTIAL_REFUND` |
  | `fault` | przy `FULL_REFUND`: `SELLER` albo `CARRIER` |
  | `returnRequired` | przy `FULL_REFUND` z winy `SELLER`: zwrot z odesłaniem; niedozwolone, gdy zwrot już był nadany |
  | `amount` | przy `PARTIAL_REFUND`: od 1 gr do ceny |
  | `statement` | uzasadnienie dla stron (20–2000 znaków, DSA) |

  Wynik:
  - `FULL_REFUND` z odesłaniem: `AWAITING_RETURN`;
  - każda inna decyzja: `RESOLVED`.
  Decyzja zapisuje autora (`decided_by_staff_id`) i trafia do historii jako wpis `DECISION`.

### Przesyłka zwrotna (moduł `shipping`)

- **`ShipmentService.prepareReturn(orderId)`** tworzy przesyłkę `RETURN` (`PENDING`) na podstawie przesyłki do kupującego:
  - nadawcą jest kupujący (dane podaje przy nadaniu), a odbiorcą sprzedający z danymi nadawcy z „Nadaj” (imię i nazwisko, telefon, adres);
  - gabaryt i paczka jak przy przesyłce do kupującego;
  - usługa: kurier na adres sprzedającego. Używamy przewoźnika przesyłki do kupującego, jeśli to kurier, a inaczej najtańszego kuriera z cennika, który przyjmie gabaryt (decyzja nr 130);
  - cena z cennika Biddy to koszt zwrotu;
  - Biddy jest zleceniodawcą i płaci za etykietę.
  Gdy żadna usługa kurierska nie pasuje: 409 `RETURN_SHIPPING_UNAVAILABLE`. Sprzedający może wtedy zwrócić pieniądze bez odesłania; decyzja supportu też nie może wymagać zwrotu.
- **Nadanie zwrotu** (`POST /v1/disputes/:id/return-shipment`, kupujący, stan `AWAITING_RETURN`):
  - dane nadawcy (imię i nazwisko, telefon, adres) i sposób nadania, jak „Nadaj” sprzedającego (`ShipmentService.dispatch`);
  - formularz wypełnia adres domyślny z konta (F-10);
  - na etykiecie numer zamówienia z sufiksem `-Z`;
  - po utworzeniu: kod nadania albo etykieta PDF (`GET /v1/disputes/:id/return-label`).
- **Tracking zwrotu** (konsument `disputes.return-tracking` eventu `ShipmentStatusChanged` z `direction = RETURN`):
  - pierwszy status u przewoźnika w `AWAITING_RETURN`: `RETURN_IN_TRANSIT` z `return_shipped_at`;
  - `DELIVERED`: `RETURN_DELIVERED` z `return_delivered_at` i `return_inspection_ends_at` = chwila wykrycia + 36 h. Pierwszy znany status od razu `DELIVERED` robi oba kroki;
  - `RETURNING` (zwrot wraca do kupującego): `ESCALATED` z wpisem systemowym.
- **Brak nadania zwrotu w 5 dni roboczych** (job `disputes.expire-returns`, jak nienadanie w F-26):
  1. przesyłka już u przewoźnika albo `REQUESTED`: pominięcie;
  2. `CREATED`: najpierw synchronizacja trackingu, a jeśli nadal `CREATED`, anulowanie u dostawcy;
  3. potem `RESOLVED` z rozstrzygnięciem `SELLER_FAVOR` (rozstrzygnął `SYSTEM`).
- **Weryfikacja zwrotu** (`POST /v1/disputes/:id/return-review`, sprzedający, stan `RETURN_DELIVERED`):
  - `accept: true`: `RESOLVED` z zapisanym wcześniej `FULL_REFUND`;
  - `accept: false` z notatką (10–2000 znaków) i zdjęciami: `ESCALATED`.
  Po 36 h bez reakcji spór przechodzi w `RESOLVED` z `FULL_REFUND` (job `disputes.settle-returns`).

### Rozliczenie (moduł `orders`, nowa klasa `OrderDisputes`)

`RESOLVED` w module `disputes` woła w tej samej transakcji `OrderDisputes.settle(tx, …)`:

| Rozstrzygnięcie | Zamówienie | Pieniądze |
|---|---|---|
| `SELLER_FAVOR` | `DISPUTED → COMPLETED` od razu | zwolnienie jak przy zakończeniu (`EscrowService.release`, `ORDER_COMPLETED`), event `OrderCompleted` |
| `FULL_REFUND`, wina `SELLER` | `DISPUTED → REFUNDED` po potwierdzeniu zwrotu | zwrot całej płatności (powód `DISPUTE`), potrącenie kosztów dostawy (niżej) |
| `FULL_REFUND`, wina `CARRIER` | `DISPUTED → REFUNDED` po potwierdzeniu zwrotu | zwrot całej płatności, rekompensata dla sprzedającego = cena, reklamacja u przewoźnika |
| `PARTIAL_REFUND` | `DISPUTED → PARTIALLY_REFUNDED` po potwierdzeniu zwrotu | zwrot kwoty z części sprzedającego (powód `DISPUTE_PARTIAL`), reszta ceny na saldo sprzedającego |

- **Koszty sporu po stronie sprzedającego** (`DISPUTE_COSTS_CHARGED`, klucz `order:{orderId}:dispute-costs`): dostawa do kupującego (`shipping_fee`) i cena przesyłki zwrotnej, jeśli była nadana. Potrącenie z salda dostępnego, a niedobór idzie na `seller_receivable` (F-22, blokada wypłat do spłaty z F-27).
- **Wina przewoźnika (§7.9):**
  - rekompensata `PARCEL_COMPENSATION_PAID` od razu po decyzji (decyzja nr 132), tym samym kanałem co przy zaginięciu: saldo albo przelew działu finansów;
  - `orders.seller_compensated_at`;
  - reklamacja `DAMAGED` przesyłki do kupującego (`LOST` przy powodzie `NOT_RECEIVED`) na kwotę ceny.
  Rozstrzygnięcie reklamacji rozlicza istniejący konsument `orders.lost-parcel-claim` (`CARRIER_CLAIM_SETTLED`), rozszerzony o reklamacje ze sporów.
- **Zwrot częściowy:**
  - `RefundService.request` z powodem `DISPUTE_PARTIAL` i kwotami zamówienia (`refunds.order_amounts`);
  - po potwierdzeniu operatora księgowanie `ORDER_PARTIALLY_REFUNDED`: zwrot z `buyer_funds_held`, reszta ceny na saldo sprzedającego (najpierw spłata należności), POK i dostawa jako przychody;
  - konsument `orders.refund-settled`: przejście `PARTIALLY_REFUNDED`, zwolnienie reszty ceny u operatora (`fund_releases` z kwotą `cena − zwrot`, bez księgowania; przy zwrocie równym cenie bez zwolnienia) i event `OrderPartiallyRefunded`.
- **Pełny zwrot:** konsument `orders.refund-settled` obsługuje powód `DISPUTE`: `DISPUTED → REFUNDED` z `refunded_at` i event `OrderRefunded`, jak przy nienadaniu.
- **Strike i historia** (moduł `disputes`, transakcja rozstrzygnięcia): `FULL_REFUND` z winy `SELLER` z decyzji personelu nadaje sprzedającemu strike `DISPUTE_LOST` (klucz źródła `DISPUTE_LOST:{orderId}`) i zapisuje przegrany spór w historii (`recordDisputeLost`, blokuje poziom „zweryfikowany”). Akceptacja zwrotu przez sprzedającego nie daje strike'a (decyzja nr 129).

### Zdjęcia w sporze (moduł `media`)

- **Nowe przeznaczenie `DISPUTE_EVIDENCE`:**
  - warianty `thumb` (320 px) i `large` (1600 px);
  - minimum 200 px na krótszym boku;
  - ta sama obróbka (usunięcie EXIF, WebP) i moderacja co przy innych zdjęciach.
- **Prywatne** (decyzja nr 133):
  - warianty trafiają do prywatnego kubełka `uploads` (`evidence/{mediaId}/{wariant}.webp`), a nie do publicznego CDN;
  - `MediaDto.urls` jest null, a uploader pokazuje podgląd z pliku lokalnego;
  - stronom i personelowi zdjęcia wydaje API (`GET /v1/disputes/:id/photos/:mediaId/:variant`): tylko zdjęcia przypisane do tego sporu, `cache-control: private`.
- **Odczyt pliku:** `MediaService.privateVariant(mediaId, variant)`. Sprzątanie nieprzypisanych zdjęć (F-12) obejmuje też te pliki.

### Powiadomienia (moduł `notifications`)

Nowe typy, wszystkie transakcyjne (`enabledByDefault: true`, `configurable: false`), w nowej grupie „Spory”:

| Typ | Kto | Kiedy | Przycisk |
|---|---|---|---|
| `DISPUTE_OPENED` | sprzedający | zgłoszenie: odpowiedz do … | Odpowiedz |
| `DISPUTE_PARTIAL_OFFERED` | kupujący | propozycja zwrotu częściowego: odpowiedz do … | Zobacz propozycję |
| `DISPUTE_ESCALATED` | obie strony | spór u zespołu Biddy: decyzja do … | Zobacz spór |
| `DISPUTE_RETURN_REQUESTED` | kupujący; sprzedający przy decyzji Biddy | zwrot z odesłaniem: nadaj do … | Nadaj zwrot / Zobacz spór |
| `DISPUTE_RETURN_DELIVERED` | sprzedający | zwrot dotarł: sprawdź do … | Sprawdź zwrot |
| `DISPUTE_RESOLVED` | obie strony | rozstrzygnięcie z wynikiem | Zobacz spór |

Potwierdzony zwrot pieniędzy kupujący dostaje istniejącym `ORDER_REFUNDED` (konsument `RefundSucceeded`, także przy powodzie `DISPUTE_PARTIAL`, z kwotą zwrotu).

### Web

- **Strona zamówienia** (F-26):
  - kupujący w `DELIVERED` widzi w karcie „Co teraz” link „Zgłoś problem” do strony sporu z terminem okna (zamiast odesłania do pomocy);
  - w `DISPUTED` obie strony widzą tekst stanu i link „Zobacz spór”, a sprzedający, który ma odpowiedzieć, „Odpowiedz do …”;
  - po rozstrzygnięciu (`disputedAt` ustawione) link „Zobacz spór” zostaje;
  - pigułka `DISPUTED` „Spór” (ostrzegawczy), `PARTIALLY_REFUNDED` „Częściowo zwrócone” (neutralny).
- **Strona sporu `/zamowienia/[publicId]/spor`** (obie strony):
  - bez sporu: formularz zgłoszenia dla kupującego, który może go otworzyć;
  - ze sporem: widok sporu z akcjami (opisany w „UX”);
  - inni dostają 404.
- **Saldo (F-27):** zamówienia `DISPUTED` liczą się do „w trakcie” (środki są wstrzymane).
- **Moje Biddy:** pigułki i teksty stanów `DISPUTED` i `PARTIALLY_REFUNDED` opisują spór, a nie tylko pracę zespołu Biddy.

## Poza zakresem

- **UI decyzji w panelu admina i audit log** (F-34). Do tego czasu decyzje wydajemy przez API, a autor decyzji jest w sporze.
- **Chargebacki** (F-31): webhook, flaga i rozliczenie. Spór blokuje tylko otwarty chargeback (409 `ORDER_ON_HOLD`).
- **Czat stron** (F-29). Wyjaśnienia w sporze są prostą osią czasu, bez wiadomości na żywo.
- **Wideo jako dowód.** Tylko zdjęcia.
- **Oceny po sporze** (F-30).
- **Spisanie należności po 180 dniach** (§7.9, F-33).
- **Zwrot do paczkomatu albo punktu sprzedającego.** Zwrot idzie kurierem na adres (decyzja nr 130).
- **Koszt zwrotu, gdy spór kończy się na korzyść sprzedającego** (np. kupujący odesłał inny przedmiot). Etykietę pokrywa Biddy.
- **Strike za podróbkę** (`COUNTERFEIT`, natychmiastowa blokada): personel nadaje go osobno (`POST /admin/strikes`, F-61).
- **Odwołanie od decyzji w sporze** (wewnętrzny system rozpatrywania skarg DSA): otwarte pytanie.

## UX

Układ jak strona zamówienia (F-26): tło `canvas`, kontener `max-w-page`, treść w kartach z lewej, podsumowanie zamówienia z prawej (od 1024 px przyklejone), na telefonie pod treścią. Nagłówek: link „Zamówienie nr B-4821”, h1 „Problem z zamówieniem”, pigułka stanu sporu.

**Pigułki stanu sporu:**

| Stan | Pigułka | Ton |
|---|---|---|
| `AWAITING_SELLER` | Czeka na sprzedającego | ostrzegawczy |
| `PARTIAL_OFFERED` | Propozycja zwrotu | ostrzegawczy |
| `ESCALATED` | U zespołu Biddy | informacyjny |
| `AWAITING_RETURN` | Czeka na odesłanie | ostrzegawczy |
| `RETURN_IN_TRANSIT` | Zwrot w drodze | informacyjny |
| `RETURN_DELIVERED` | Zwrot dostarczony | informacyjny |
| `RESOLVED` | Rozstrzygnięty | pozytywny |

**Formularz zgłoszenia** (kupujący, `DELIVERED` w oknie 36 h):

- tekst: „Masz czas do 27 października, 06:15. Do rozstrzygnięcia pieniądze czekają w Biddy, a sprzedający ich nie dostanie.”;
- „Co jest nie tak?”: radio z powodami:
  - Przedmiot jest niezgodny z opisem;
  - Przedmiot jest uszkodzony;
  - Czegoś brakuje w przesyłce;
  - To podróbka;
  - Paczka nie dotarła, choć jest oznaczona jako odebrana;
  - Inny problem;
- „Opisz problem” (textarea z licznikiem);
- „Zdjęcia” (uploader, do 10; przy powodach z wymaganym zdjęciem: „Dodaj co najmniej jedno zdjęcie.”);
- informacja: „Sprzedający ma 48 h na odpowiedź. Jeśli się nie porozumiecie, spór rozstrzygnie zespół Biddy.”;
- przycisk „Zgłoś problem”.

**Karta „Co teraz”** (`role="status"` przy zmianach), według stanu i roli:

- **`AWAITING_SELLER`:**
  - kupujący: „Sprzedający ma czas na odpowiedź do …”;
  - sprzedający: „Kupujący zgłosił problem. Odpowiedz do …, inaczej spór trafi do zespołu Biddy.” i trzy akcje:
    - „Zwróć pieniądze”: wybór „Bez odsyłania przedmiotu” albo „Z odesłaniem (etykieta od Biddy)”, koszt dostawy w obie strony potrącimy z salda (kwoty);
    - „Zaproponuj zwrot części ceny”: kwota, maks. cena, z informacją, że POK i dostawa nie są zwracane;
    - „Odrzuć zgłoszenie”: wyjaśnienie i zdjęcia.
  Każda akcja ma formularz w karcie z potwierdzeniem.
- **`PARTIAL_OFFERED`:**
  - kupujący: „Sprzedający proponuje zwrot {kwota} i zatrzymanie przedmiotu.” Przyciski „Przyjmij {kwota}” i „Odrzuć, niech rozstrzygnie Biddy”;
  - sprzedający: „Czekamy na odpowiedź kupującego do …”.
- **`ESCALATED`:** „Spór sprawdza zespół Biddy. Decyzja do …” i formularz „Dodaj wyjaśnienie” (notatka i zdjęcia).
- **`AWAITING_RETURN`:**
  - kupujący: „Odeślij przedmiot do …. Etykietę przygotuje Biddy.” Formularz nadania (dane nadawcy, sposób nadania) jak na stronie nadania F-24, a potem kod nadania lub etykieta i status;
  - sprzedający: „Kupujący odeśle przedmiot do ….”.
- **`RETURN_IN_TRANSIT`:** „Zwrot jest w drodze.” z historią trackingu.
- **`RETURN_DELIVERED`:**
  - sprzedający: „Zwrot dotarł. Sprawdź przedmiot do …. Potem zwrócimy pieniądze kupującemu.” Przyciski „Zwrot w porządku” i „Zgłoś problem ze zwrotem” (notatka i zdjęcia);
  - kupujący: „Sprzedający sprawdza zwrot do ….”.
- **`RESOLVED`:** wynik z kwotami dla oglądającego, kto rozstrzygnął, uzasadnienie i data:
  - „Zwracamy Ci {kwota}.” / „Kupujący dostaje zwrot {kwota}. Koszt dostawy {kwota} potrąciliśmy z Twojego salda.”;
  - „{kwota} trafiła na Twoje saldo.”;
  - stan zwrotu pieniędzy (w toku, zwrócono).

**Historia sporu:** lista (`ol`, najstarsze na górze): kto, co i kiedy, z notatką, kwotą i miniaturami zdjęć. Miniatura otwiera duże zdjęcie w nowej karcie. Wpis personelu ma podpis „Zespół Biddy”, a systemowy „Biddy”.

**Podsumowanie (aside):** zdjęcie i tytuł przedmiotu, cena, POK, dostawa, razem, druga strona, link do zamówienia.

Teksty po polsku i neutralne płciowo. Błędy akcji pokazuje `role="alert"` przy przycisku.

## Model danych

Migracja `0022_disputes`. Kwoty w groszach (`bigint`), czasy `timestamptz`.

**`disputes`** (moduł `disputes`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `order_id` | zamówienie (unikalne, bez FK) |
| `buyer_id`, `seller_id` | strony (bez FK) |
| `currency`, `items_total` | cena: górna granica zwrotu częściowego |
| `reason`, `description` | zgłoszenie |
| `status` | stan z §7.5 |
| `response_due_at` | termin odpowiedzi sprzedającego albo kupującego (`AWAITING_SELLER`, `PARTIAL_OFFERED`) |
| `partial_offer_amount` | propozycja sprzedającego |
| `escalated_at`, `decision_due_at` | eskalacja i SLA decyzji (72 h) |
| `outcome`, `fault`, `refund_amount` | rozstrzygnięcie (zapisane przy decyzji, także przed zwrotem) |
| `return_required` | rozstrzygnięcie wymaga odesłania |
| `decided_by`, `decided_by_staff_id`, `statement`, `decided_at` | kto, uzasadnienie i kiedy |
| `return_shipment_id` | przesyłka zwrotna (moduł `shipping`, bez FK) |
| `return_ship_by`, `return_shipped_at`, `return_delivered_at`, `return_inspection_ends_at` | terminy i etapy zwrotu |
| `resolved_at`, `created_at`, `updated_at` | czasy |

CHECK:

- `outcome` jest razem z `decided_by`, `statement` i `decided_at`;
- `fault` tylko przy `FULL_REFUND`;
- `refund_amount` przy `PARTIAL_REFUND` (od 1 do `items_total`);
- `RESOLVED` ma `outcome` i `resolved_at`.

Indeksy częściowe pod joby:

- `response_due_at` dla `AWAITING_SELLER` i `PARTIAL_OFFERED`;
- `return_ship_by` dla `AWAITING_RETURN`;
- `return_inspection_ends_at` dla `RETURN_DELIVERED`;
- `escalated_at` dla `ESCALATED`.

Trigger `disputes_status_transition` dopuszcza tylko przejścia z diagramu.

**`dispute_events`:** `id`, `dispute_id` (FK), `type` (`OPENED`, `SELLER_ACCEPTED`, `PARTIAL_OFFERED`, `PARTIAL_ACCEPTED`, `PARTIAL_REJECTED`, `SELLER_REJECTED`, `ESCALATED`, `COMMENT`, `DECISION`, `RETURN_SHIPPED`, `RETURN_DELIVERED`, `RETURN_ACCEPTED`, `RETURN_CONTESTED`, `RESOLVED`), `actor` (`BUYER`, `SELLER`, `STAFF`, `SYSTEM`), `actor_id`, `note`, `amount`, `media_ids` (`uuid[]`), `created_at`. Indeks `(dispute_id, created_at)`.

**`orders`:** nowa kolumna `disputed_at` (przejście w `DISPUTED`). `refunded_at` ustawia też `PARTIALLY_REFUNDED`.

**`refunds`:** nowy powód `DISPUTE_PARTIAL`. `order_amounts` jest wymagane przy `NOT_PICKED_UP` i `DISPUTE_PARTIAL`.

**`media`:** przeznaczenie `DISPUTE_EVIDENCE` w CHECK.

## API i zdarzenia

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `GET /v1/orders/:id/dispute` | strony | `DisputeDto`; brak sporu albo obca osoba: 404 |
| `POST /v1/orders/:id/dispute` | kupujący | zgłoszenie; 201, ponowienie 200; 409 `DISPUTE_UNAVAILABLE`, `DISPUTE_WINDOW_CLOSED` (z `inspectionEndsAt`), `ORDER_ON_HOLD` |
| `POST /v1/disputes/:id/seller-response` | sprzedający | `ACCEPT`, `OFFER_PARTIAL`, `REJECT`; 409 `DISPUTE_STATE_CHANGED`, `RETURN_SHIPPING_UNAVAILABLE` |
| `POST /v1/disputes/:id/offer-response` | kupujący | `{ accept, note? }`; 409 `DISPUTE_STATE_CHANGED` |
| `POST /v1/disputes/:id/return-shipment` | kupujący | nadanie zwrotu (jak `DispatchShipmentBody`); 409 `DISPUTE_STATE_CHANGED` |
| `GET /v1/disputes/:id/return-label` | kupujący | etykieta PDF; 404, gdy jeszcze jej nie ma |
| `POST /v1/disputes/:id/return-review` | sprzedający | `{ accept, note?, mediaIds? }`; 409 `DISPUTE_STATE_CHANGED` |
| `POST /v1/disputes/:id/comments` | strony | wyjaśnienie; 409 `DISPUTE_STATE_CHANGED` po rozstrzygnięciu |
| `GET /v1/disputes/:id/photos/:mediaId/:variant` | strony, personel | `image/webp` (`thumb`, `large`) |
| `GET /v1/admin/disputes` | personel | kolejka (`status`, domyślnie `ESCALATED`) |
| `GET /v1/admin/disputes/:id` | personel | `AdminDisputeDto` |
| `POST /v1/admin/disputes/:id/decision` | `support`, `moderator`, `admin` | decyzja; 409 `DISPUTE_NOT_ESCALATED`, `RETURN_SHIPPING_UNAVAILABLE` |

Szczegóły:

- `:id` zamówienia to UUID albo numer, a `:id` sporu to UUID.
- Odpowiedzi mają `cache-control: private, no-store`, a zdjęcia `private, max-age=3600`.
- Akcja, która nie pasuje do bieżącego stanu, zwraca 409 `DISPUTE_STATE_CHANGED` z bieżącym stanem w `extensions`. Klient odświeża wtedy widok.
- `OrderDetailsDto` dostaje:
  - `disputedAt`;
  - `actions.openDispute` (`{ allowed, until }` dla kupującego w `DELIVERED`).

`DisputeDto`:

- `id`, `orderId`, `orderPublicId`, `status`, `role`, `reason`, `description`;
- terminy: `responseDueAt`, `escalatedAt`, `decisionDueAt`;
- `partialOffer`, `itemsTotal`, `currency`;
- `resolution`: `outcome`, `fault`, `refundAmount`, `decidedBy`, `statement`, `decidedAt`, `resolvedAt`, a dla oglądającego `sellerCosts` i `refund` (stan zwrotu pieniędzy);
- `return`: `required`, terminy, przesyłka (`ShipmentDto` z perspektywy nadawcy dla kupującego);
- `returnQuote`: przewoźnik i cena zwrotu, dla sprzedającego w `AWAITING_SELLER`;
- `events`: oś czasu ze zdjęciami (adresy API);
- `actions`: `respond`, `answerOffer`, `shipReturn`, `reviewReturn`, `comment`.

### Eventy (outbox, wersja 1)

Agregat `dispute`. Każdy event ma `orderId`, `orderPublicId`, `buyerId`, `sellerId` i `title`:

- `DisputeOpened`: `reason`, `responseDueAt`;
- `DisputePartialOffered`: `amount`, `responseDueAt`;
- `DisputeEscalated`: `cause` (`SELLER_REJECTED`, `SELLER_SILENT`, `OFFER_REJECTED`, `BUYER_SILENT`, `RETURN_CONTESTED`, `RETURN_FAILED`), `decisionDueAt`;
- `DisputeReturnRequested`: `returnShipBy`, `decidedBy`;
- `DisputeReturnDelivered`: `inspectionEndsAt`;
- `DisputeResolved`: `outcome`, `fault`, `refundAmount`, `decidedBy`.

Agregat `order`:

- `OrderDisputed`: `disputedAt`;
- `OrderPartiallyRefunded`: `refundedAt`, `amount`.

Zmiana istniejących: `RefundRequested.reason` i `RefundSucceeded.reason` dostają `DISPUTE_PARTIAL`.

### Joby (kolejka `disputes`, co 60 s)

- `disputes.escalate-overdue`: `AWAITING_SELLER` i `PARTIAL_OFFERED` po `response_due_at` przechodzą w `ESCALATED`;
- `disputes.expire-returns`: `AWAITING_RETURN` po `return_ship_by` przechodzi w `RESOLVED` (`SELLER_FAVOR`);
- `disputes.settle-returns`: `RETURN_DELIVERED` po `return_inspection_ends_at` przechodzi w `RESOLVED` (`FULL_REFUND`).

## Reguły biznesowe i przypadki brzegowe

- **Kolejność blokad:**
  - zgłoszenie blokuje wiersz zamówienia, a każda późniejsza zmiana najpierw wiersz sporu, potem zamówienie (`OrderDisputes`);
  - joby i akcje stron rozstrzygają wyścigi kolejnością blokad i warunkiem stanu: np. odpowiedź sprzedającego w ostatniej sekundzie i eskalacja z joba dają jedno przejście, a drugie dostaje 409 albo jest pomijane.
- **Ledger:**
  - po pełnym zwrocie (każda wina) i po zwrocie częściowym saldo `buyer_funds_held` zamówienia wynosi 0;
  - zwroty i koszty księgujemy kluczami zamówienia, sporu albo zwrotu, więc ponowienie nie dubluje wpisów.
- **Zwrot częściowy:**
  - kwota od 1 gr do ceny przedmiotu (`items_total`); POK i dostawa nie wracają;
  - ten sam limit sprawdzają API (400), CHECK w bazie i szablon księgowania.
- **Koszty dostawy sprzedającego:**
  - tylko przy pełnym zwrocie z winy sprzedającego (także po jego akceptacji);
  - dostawa do kupującego to `shipping_fee` zamówienia, a zwrot to cena przesyłki zwrotnej z cennika (tylko gdy była nadana);
  - przy saldzie mniejszym niż koszty reszta jest należnością, a wypłaty czekają na jej spłatę (F-27).
- **Okno 36 h:** spór można zgłosić do `inspection_ends_at`. Termin liczymy od chwili wykrycia odbioru (F-26), więc opóźniony webhook działa na korzyść kupującego.
- **Zgłoszenie a „Wszystko OK”:** po potwierdzeniu odbioru zamówienie jest `COMPLETED` i sporu nie da się otworzyć. „Wszystko OK” ostrzega o tym w oknie potwierdzenia (F-26).
- **Zwrot:**
  - jedna aktywna przesyłka zwrotna na zamówienie (unikalny indeks z F-24);
  - termin nadania zwrotu to koniec 5. dnia roboczego od wejścia w `AWAITING_RETURN` (`businessDayDeadline`);
  - status przesyłki ponad `CREATED` oznacza nadanie, nawet jeśli event jeszcze nie dotarł.
- **Decyzja personelu:** tylko z `ESCALATED`. Spór, który wrócił do `ESCALATED` po zakwestionowaniu zwrotu, nie może żądać drugiego odesłania.
- **Strike:** tylko za przegraną po decyzji personelu (`FULL_REFUND`, wina `SELLER`). Zwrot częściowy, akceptacja i wina przewoźnika nie dają strike'a.
- **Nieudany zwrot u operatora** (`REFUND_FAILED`): spór zostaje `RESOLVED`, a zamówienie `DISPUTED`. Obsługuje to support (F-34), jak przy innych zwrotach.

## Bezpieczeństwo i prywatność

- Wszystkie trasy wymagają sesji. Spór widzą tylko jego strony i personel, a inni dostają 404. Akcje sprawdzają rolę i stan po stronie serwera.
- Zdjęcia ze sporu nigdy nie są publiczne. API wydaje tylko zdjęcia przypisane do tego sporu i tylko jego stronom oraz personelowi.
- Opis i notatki to zwykły tekst (bez HTML), z limitami długości.
- Kupujący na etykiecie zwrotnej widzi dane sprzedającego (imię i nazwisko, adres, telefon), bo są potrzebne przewoźnikowi; informuje o tym formularz nadania zwrotu. Sprzedający nie widzi danych nadawcy zwrotu poza nazwą i miastem.
- Decyzje personelu zapisują autora. Pełny audit log dojdzie w F-34.

## Analityka

PostHog (za zgodą, F-06), bez kwot i danych osobowych:

- `dispute_opened` (powód, liczba zdjęć);
- `dispute_seller_responded` (akcja, z odesłaniem);
- `dispute_offer_answered` (przyjęta);
- `dispute_return_shipped`;
- `dispute_return_reviewed` (przyjęty);
- `dispute_comment_added` (rola);
- `dispute_viewed` (rola, stan).

## Kryteria akceptacji

- [x] Given zamówienie `DELIVERED` w oknie 36 h, When kupujący zgłasza problem, Then zamówienie jest `DISPUTED`, spór `AWAITING_SELLER` z terminem 48 h, a auto-zakończenie go nie dotyka. Zgłoszenie po oknie albo w innym stanie zwraca 409.
- [x] Given spór bez odpowiedzi sprzedającego, When mija 48 h, Then spór jest `ESCALATED`, obie strony dostają powiadomienie, a personel widzi go w kolejce z terminem decyzji.
- [x] Given propozycja zwrotu częściowego większa niż cena przedmiotu, Then API odrzuca ją (400). Przyjęta propozycja kończy się zwrotem tej kwoty, a reszta ceny trafia na saldo sprzedającego (POK i dostawa nie wracają).
- [x] Given spór wygrany przez kupującego z winy sprzedającego, Then kupujący dostaje pełny zwrot, a koszt dostawy w obie strony jest potrącony z salda sprzedającego. Niedobór trafia na `seller_receivable`, a sprzedający dostaje strike `DISPUTE_LOST`.
- [x] Given zwrot z odesłaniem, Then kupujący dostaje etykietę zwrotną, a dalej:
  - brak nadania w 5 dni roboczych kończy spór na korzyść sprzedającego;
  - po odbiorze zwrotu sprzedający ma 36 h na weryfikację, a potem pieniądze wracają do kupującego.
- [x] Given wina przewoźnika, Then kupujący dostaje pełny zwrot, sprzedający rekompensatę równą cenie, a Biddy ma reklamację u przewoźnika.
- [x] Given każde rozstrzygnięcie (strony, personel, system), Then ma uzasadnienie widoczne dla obu stron w widoku sporu.
- [x] Given pełny albo częściowy zwrot potwierdzony przez operatora, Then saldo `buyer_funds_held` zamówienia wynosi 0, a zamówienie jest `REFUNDED` albo `PARTIALLY_REFUNDED`.
- [x] Given zdjęcie ze sporu, Then nie ma publicznego adresu, a API wydaje je tylko stronom sporu i personelowi.
- [x] Given web na atrapie API, Then:
  - kupujący zgłasza problem ze zdjęciem;
  - sprzedający proponuje zwrot częściowy;
  - kupujący go przyjmuje i widzi rozstrzygnięcie;
  - axe bez naruszeń WCAG 2.1 AA, bez poziomego przewijania przy 390 px.

## Plan testów

- **Jednostkowe (api):**
  - `canDisputeTransition` dla wszystkich par;
  - reguły: okno zgłoszenia, wymagane zdjęcia, limit zwrotu częściowego, koszty sprzedającego, wybór usługi zwrotu;
  - mapowanie statusu przesyłki zwrotnej na krok sporu.
- **Jednostkowe (shared):** powody i stany sporu, nowe typy powiadomień i ich e-maile.
- **Integracyjne (Postgres, Redis):**
  - trigger przejść sporu;
  - zgłoszenie: walidacje, 409, idempotencja, zdjęcia;
  - odpowiedzi sprzedającego i kupującego, eskalacja z joba;
  - decyzja personelu (role, 409, walidacje);
  - zwrot z odesłaniem: przesyłka zwrotna, nadanie, tracking, brak nadania, weryfikacja i 36 h;
  - rozliczenia w ledgerze dla każdego rozstrzygnięcia:
    - `buyer_funds_held` = 0;
    - koszty z saldem i z należnością;
    - zwrot częściowy z `fund_releases`;
    - rekompensata i reklamacja przy winie przewoźnika;
  - strike i historia przegranego sporu;
  - zdjęcia: brak dostępu dla obcej osoby, plik w prywatnym kubełku;
  - powiadomienia.
- **Web (Vitest, Testing Library):**
  - formularz zgłoszenia (walidacja, wymagane zdjęcie);
  - widok sporu dla obu ról w każdym stanie z akcjami;
  - link na stronie zamówienia.
- **E2E (Playwright, atrapa API):** zgłoszenie, propozycja, przyjęcie i rozstrzygnięcie; axe, 390 px.

## Postęp i odstępstwa (2026-11-03)

Gotowe:

- migracja `0022_disputes` z triggerem przejść sporu, `orders.disputed_at`, powodem zwrotu `DISPUTE_PARTIAL` i przeznaczeniem mediów `DISPUTE_EVIDENCE`;
- moduł `disputes`:
  - `DisputeService` (zgłoszenie, odpowiedzi stron, wyjaśnienia, zwrot, decyzja personelu);
  - `DisputeTransitions` (eskalacja, zwrot z odesłaniem, rozstrzygnięcie ze strike'iem);
  - `DisputeDeadlines` (3 joby i tracking zwrotu);
  - trasy stron i personelu;
- `OrderDisputes` w `orders` (zgłoszenie i rozliczenie);
- zwrot częściowy w `RefundService` i `EscrowService.releaseRemainder`;
- koszty sporu (`chargeDisputeCosts`);
- przesyłka zwrotna kurierem (`ShipmentService.prepareReturn`, `ShippingQuoteService.returnOption`);
- prywatne zdjęcia (`MediaService.privateVariant`);
- 6 typów powiadomień w grupie „Spory i zwroty”;
- web:
  - strona `/zamowienia/[publicId]/spor` z formularzem, akcjami stron, nadaniem zwrotu, rozstrzygnięciem i historią;
  - linki „Zgłoś problem” i „Zobacz spór” na stronie zamówienia;
  - `PhotoUploader` dla zdjęć prywatnych;
  - ostrzeżenie w oknie „Wszystko OK”.

Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 128–134.

Odstępstwa:

- **Powiadomienie o zwrocie częściowym** wychodzi z `RefundSucceeded` (jak każdy zwrot), a nie z nowego `OrderPartiallyRefunded`. Ten event zostaje kontraktem zmiany stanu zamówienia, na razie bez konsumenta.
- **Adresy zdjęć ze sporu** prowadzą do API (`API_PUBLIC_URL` + `/v1/disputes/:id/photos/…`). Przeglądarka wysyła ciasteczko sesji, bo web i API są w tej samej witrynie (jak przy innych wywołaniach API).
- **Odpowiedź sprzedającego** (`seller-response`) to jedno body z polem `action` i polami zależnymi od akcji, walidowanymi razem (`superRefine`). Klasa DTO nie przyjmuje unii.
- **Koszty dostawy po stronie sprzedającego** widzą tylko sprzedający i personel. Kupujący widzi kwotę swojego zwrotu.
- **Moje Biddy** zostawia pigułkę „Zgłoszony problem” (neutralna), a strona zamówienia pokazuje „Spór”.
- **`DISPUTE_RETURN_REQUESTED` dla sprzedającego** wychodzi tylko przy decyzji Biddy. Gdy sprzedający sam zgodził się na zwrot, wie o nim z własnej akcji.

## Otwarte pytania

- **Odwołanie od decyzji Biddy w sporze** (DSA, wewnętrzny system rozpatrywania skarg): czy wystarczy kontakt z pomocą, czy potrzebny jest formalny tryb jak przy strike'ach (F-61)?
- **Zwrot do paczkomatu sprzedającego:** taniej niż kurier, ale wymaga wyboru punktu przez sprzedającego. Zmierzymy, jak często zwrot jest potrzebny.
- **Brak odpowiedzi kupującego na propozycję:** eskalacja (przyjęte) czy uznanie propozycji za przyjętą?
- **Koszt etykiety zwrotnej przy rozstrzygnięciu na korzyść sprzedającego:** czy obciążać kupującego, np. przy odesłaniu innego przedmiotu?
