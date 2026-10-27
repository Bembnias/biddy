# F-25 · Checkout (web)

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-13 (POK), F-16 (zamówienia), F-23 (port płatności), F-24 (dostawy)

## Kontekst i cel

Zwycięzca ma 24 h na zapłatę ([PROJECT.md §6.8](../PROJECT.md#68-brak-płatności-zwycięzcy)). Po F-16 zamówienie `AWAITING_PAYMENT` ma cenę i POK, F-23 umie założyć płatność u operatora (FakeGateway), a F-24 wycenić dostawę i zapisać jej wybór. Brakuje ekranu, który to łączy, i przejść zamówienia po płatności.

F-25 dodaje checkout: wybór dostawy i punktu albo adresu, podsumowanie liczone przez backend, wybór metody płatności z kodem BLIK albo przekierowaniem do operatora, stany oczekiwania, błędu i ponowienia. Do tego przejścia zamówienia, bez których płatność nic nie zmienia: `AWAITING_PAYMENT → PAID` po udanej płatności, `AWAITING_PAYMENT → CANCELLED_UNPAID` po terminie (z przedłużeniem o 30 min dla płatności w toku) i automatyczny pełny zwrot płatności, która przyszła za późno albo drugi raz ([§7.2](../PROJECT.md#72-przebieg-szczęśliwej-ścieżki), [§7.4](../PROJECT.md#74-terminy)).

Cel: zwycięzca płaci szybko i bez niespodzianek. Kwota na przycisku jest kwotą w zamówieniu i w żądaniu do operatora.

## Historyjki użytkownika

- Jako zwycięzca wybieram dostawę (paczkomat, punkt albo kurier), widzę od razu sumę z dostawą i płacę BLIK-iem, kartą albo szybkim przelewem.
- Jako zwycięzca, któremu bank odrzucił BLIK, płacę jeszcze raz w tym samym zamówieniu, bez zaczynania od nowa.
- Jako zwycięzca wiem do kiedy mam zapłacić i co się stanie, jeśli nie odbiorę paczki.
- Jako zwycięzca, który zapłacił po terminie, dostaję pieniądze z powrotem automatycznie.
- Jako sprzedający dostaję powiadomienie „nadaj paczkę”, gdy tylko kupujący zapłaci.

## Zakres

### API checkoutu (moduł `orders`)

- **`GET /v1/orders/:id/checkout`** (kupujący): widok checkoutu:
  - zamówienie: numer, status, tytuł i zdjęcie ze snapshotu, link do aukcji, cena, POK, dostawa (albo null), suma, waluta;
  - termin płatności i termin efektywny (przedłużony o 30 min, gdy płatność rozpoczęta przed terminem jest w `PENDING`);
  - opcje dostawy z cenami (jak `shipping-options`);
  - wybrana dostawa (usługa, cena, punkt albo adres, odbiorca), jeśli już jest;
  - ostatnia płatność (stan, metoda, powód porażki, adres powrotu do operatora) albo null;
  - metody płatności dostępne w checkoutcie: `BLIK`, `CARD`, `PAY_BY_LINK`.
- **`PUT /v1/orders/:id/delivery`** (kupujący): wybór dostawy `{ carrierId, pickupPointId?, recipient: { name, phone, address? } }`:
  - woła `ShipmentService.prepare` (F-24): sprawdza usługę, punkt u dostawcy i dane odbiorcy;
  - zapisuje w zamówieniu `shipping_fee` i nową sumę (cena + POK + dostawa);
  - ponowny wybór zastępuje poprzedni;
  - wynik: widok checkoutu.
- **`POST /v1/orders/:id/payments`** (kupujący, nagłówek `Idempotency-Key`): `{ method, blikCode?, expectedTotal }`:
  - backend liczy kwotę sam, a `expectedTotal` (suma, którą kupujący widział na przycisku) musi być jej równa, inaczej 409 `CHECKOUT_TOTAL_CHANGED` z bieżącą sumą;
  - zakłada płatność przez `PaymentService.createPayment` (F-23): kwota = suma zamówienia, część sprzedającego = cena;
  - kod BLIK idzie tylko do operatora (nie zapisujemy go ani nie logujemy);
  - wynik 201: widok checkoutu z płatnością (dla przekierowania z adresem strony operatora).
  Ponowienie z tym samym kluczem zwraca tę samą płatność (nagłówek `idempotent-replayed: true`), a inna metoda z tym samym kluczem to 422 `IDEMPOTENCY_KEY_REUSED`.
- **Rejestracja sprzedawcy u operatora** (otwarte pytanie z F-23): gdy sprzedający nie ma jeszcze konta u operatora domyślnego, checkout rejestruje go (`SellerAccountService.register`, imię i e-mail z modułu `identity`) przed założeniem płatności. Pełny onboarding dojdzie w F-32.

### Przejścia zamówienia (moduł `orders`)

- **Opłacenie** (konsument `orders.payment-succeeded` eventu `PaymentSucceeded`), w transakcji konsumenta:
  - zamówienie `AWAITING_PAYMENT` → `PAID`, `paid_at`, `ship_by` = koniec 5. dnia roboczego od opłacenia (`businessDayDeadline`, §7.4);
  - event `OrderPaid` (kontrakt z F-24; powiadomienie „nadaj paczkę” już go konsumuje);
  - zamówienie w innym stanie (anulowane albo już opłacone inną płatnością): zlecenie pełnego zwrotu tej płatności (`LATE_PAYMENT` albo `DUPLICATE_PAYMENT`), bez zmiany zamówienia.
- **Anulowanie nieopłaconego** (job `orders.expire-unpaid` co minutę):
  - zamówienia `AWAITING_PAYMENT` po terminie płatności, najstarsze najpierw, po 100;
  - płatność w `PENDING` założona przed terminem przesuwa anulowanie o maks. 30 min (§6.8);
  - `CANCELLED_UNPAID`, `cancelled_at`, anulowanie przygotowanej przesyłki (`ShipmentService.cancel`), event `OrderCancelled` (`reason: 'UNPAID'`, `paymentPending`).
  Strike, oferta drugiej szansy i ponowne wystawienie zostają w F-26 (konsument `OrderCancelled`).

### Zwroty (moduł `payments`)

- **Tabela `refunds`** i **`RefundService.request(tx, …)`**: wiersz `PENDING` z kluczem idempotencji (np. `refund:payment:{id}:late`) i event `RefundRequested` w tej samej transakcji.
- **Konsument `payments.execute-refund`**: wywołanie `gateway.refund()` z kluczem `refund:{id}` (ponowienie nie robi drugiego zwrotu) i zapis ID operatora.
- **Webhooki `REFUND_SUCCEEDED` / `REFUND_FAILED`** (dotąd zapisywane jako bez obsługi):
  - udany: `SUCCEEDED`, księgowanie `ORDER_REFUNDED` z powodem zwrotu, event `RefundSucceeded`;
  - nieudany: `FAILED` z błędem w logach (Sentry) do ręcznej obsługi przez support (panel: F-34).
- Ledger: nowy powód pełnego zwrotu `DUPLICATE_PAYMENT`.

### Web

- **Strona `/zamowienia/[publicId]/zaplac`** (kupujący): checkout opisany w „UX”.
- **Wejścia do checkoutu:**
  - Moje Biddy → Wygrane: aktywne „Zapłać” (dotąd nieaktywne z F-21);
  - panel wygranej na stronie aukcji (F-63): „Zapłać {suma}” zamiast linku do Moje Biddy;
  - powiadomienie o wygranej: link do checkoutu.
- **Stany zamówienia po polsku** w Moje Biddy: „Opłacone”, „Nie zapłacono w terminie”.

## Poza zakresem

- Strike za brak płatności, przypomnienia po 1 h, 12 h i 20 h, oferta drugiej szansy, ponowne wystawienie (F-26, F-61).
- „Opłacaj automatycznie” z zapisaną metodą płatności (v1, §6.8).
- Apple Pay i Google Pay: wymagają integracji z prawdziwym operatorem (F-31). Port i FakeGateway je znają.
- Mapa punktów odbioru: v1 ma wyszukiwarkę punktów (miasto, adres, kod) i listę wyników. Mapa dojdzie później.
- Anulowanie płatności w toku przez kupującego (zmiana metody w trakcie przekierowania): port nie ma tej operacji, otwarte pytanie.
- Faktura za POK (F-26/F-33), widok zamówienia dla kupującego po opłaceniu z trackingiem (F-26).

## UX

Układ jak strona nadania (F-63): tło `canvas`, kontener `max-w-page`, formularz w kartach z lewej, podsumowanie z prawej (od 1024 px przyklejone), na telefonie podsumowanie pod formularzem, a przycisk płatności na końcu.

**Nagłówek:** link „Wygrane”, h1 „Zapłać za zamówienie”, „Zamówienie nr B-4821” i pigułka ostrzegawcza „Zapłać do 25 października, 18:02” (przy przedłużeniu: „Czekamy na płatność do …”).

**Karta 1. Dostawa:**

- karty wyboru usług z nazwą, rodzajem („Paczkomat”, „Punkt odbioru”, „Kurier”) i ceną;
- dla paczkomatu i punktu: wyszukiwarka „Miasto, adres albo kod punktu”, lista do 10 punktów (nazwa, adres, godziny) jako karty wyboru, wybrany punkt z „Zmień punkt”;
- dla kuriera: ulica z numerem, kod pocztowy, miejscowość;
- odbiorca: imię i nazwisko, telefon („Przewoźnik wyśle na ten numer informacje o przesyłce”), wypełnione domyślnym adresem dostawy z konta (F-10).

**Karta 2. Płatność:**

- karty wyboru: „BLIK” (pole „Kod BLIK”, 6 cyfr, `inputMode="numeric"`, `autocomplete="one-time-code"`), „Karta płatnicza”, „Szybki przelew” (z opisem „Przejdziesz na stronę operatora płatności”);
- informacja: „Pieniądze czekają u operatora płatności, aż potwierdzisz odbiór. Sprzedający dostanie je dopiero wtedy.”

**Podsumowanie (aside):** zdjęcie i tytuł, wiersze „Cena”, „Pakiet Ochrony Kupujących” (z linkiem „Co to jest?”), „Dostawa” („wybierz dostawę” przed wyborem), „Do zapłaty” dużą liczbą; przycisk CTA „Zapłać 377,49 zł” (gradient F-63); pod nim zasada nieodebranej paczki: „Jeśli nie odbierzesz paczki, zwrócimy cenę i POK, bez kosztu dostawy.” (§7.4 pkt 5) i link do regulaminu.

**Przebieg:**

1. „Zapłać” sprawdza formularz (błędy przy polach, fokus na pierwszym), zapisuje dostawę, potem zakłada płatność z sumą z przycisku.
2. Suma po zapisie dostawy różna od pokazanej (zmiana cennika): komunikat „Kwota się zmieniła. Sprawdź podsumowanie i zapłać ponownie.” i nowa suma; płatność nie jest zakładana.
3. Płatność z przekierowaniem: przejście na stronę operatora (FakeGateway: `/dev/fake-pay/...`), a powrót na checkout.
4. **Oczekiwanie** (`PENDING`): karta z animowanym wskaźnikiem (bez animacji przy `prefers-reduced-motion`) „Potwierdź płatność w aplikacji banku” (BLIK) albo „Sprawdzamy płatność…” (po powrocie od operatora, z linkiem „Wróć do strony płatności”), `role="status"`, odświeżanie co 2 s.
5. **Błąd** (`FAILED`): komunikat `role="alert"` nad kartą płatności według powodu („Bank odrzucił płatność.”, „Kod BLIK jest błędny albo wygasł. Wygeneruj nowy kod w aplikacji banku.”, „Płatność wygasła.”, „Płatność anulowano.”, „Operator płatności nie odpowiedział.”), formularz znowu aktywny, przycisk „Zapłać ponownie”. To samo zamówienie, nowa płatność.
6. **Sukces** (`PAID`): zielona karta „Zapłacone!”, kwota, „Sprzedający ma czas na nadanie do {ship_by}. Dostaniesz numer przesyłki.” i trzy kroki z panelu wygranej, linki „Zobacz w Moje Biddy” i „Wróć do aukcji”.
7. **Termin minął** (`CANCELLED_UNPAID` albo po terminie bez płatności w toku): karta „Termin płatności minął”, zdanie o zwrocie, jeśli płatność jednak przejdzie, link „Szukaj podobnych”.
8. Inne stany (zamówienie już w drodze itd.): karta „To zamówienie jest już opłacone” z linkiem do Moje Biddy. Nie-kupujący: „Nie znaleziono zamówienia”.

Teksty po polsku i neutralne płciowo. Błąd sieci przy „Zapłać” ponawia żądanie z tym samym kluczem idempotencji (przycisk „Spróbuj ponownie”).

## Model danych

Migracja `0018_checkout`. Kwoty w groszach (`bigint`), czasy `timestamptz`.

**`orders`** (nowe kolumny):

| Kolumna | Opis |
|---|---|
| `paid_at` | chwila opłacenia (z eventu `PaymentSucceeded`) |
| `ship_by` | termin nadania: koniec 5. dnia roboczego od opłacenia |
| `cancelled_at` | chwila anulowania |

CHECK: `paid_at` i `ship_by` są razem albo żadne; `cancelled_at` tylko przy stanach `CANCELLED_*`.

**`refunds`** (moduł `payments`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `payment_id`, `order_id` | płatność (FK w module) i zamówienie (bez FK, granica modułów) |
| `provider`, `provider_refund_id` | operator i ID zwrotu u niego (null do wywołania) |
| `currency`, `amount` | kwota zwrotu (> 0) |
| `reason` | powód z ledgera: `LATE_PAYMENT`, `DUPLICATE_PAYMENT`, a w kolejnych feature'ach także `NOT_SHIPPED`, `LOST`, `DISPUTE`, `CHARGEBACK` |
| `status` | `PENDING`, `SUCCEEDED`, `FAILED` |
| `idempotency_key` | klucz wywołującego (unikalny) |
| `succeeded_at`, `failed_at`, `created_at`, `updated_at` | czasy |

Indeksy: unikalny `(provider, provider_refund_id)`, `(payment_id)`. CHECK: zwroty jednej płatności nie przekraczają jej kwoty pilnuje serwis pod blokadą płatności (`FOR UPDATE`).

## API i zdarzenia

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `GET /v1/orders/:id/checkout` | kupujący | Widok checkoutu (`CheckoutDto`); inni 404 |
| `PUT /v1/orders/:id/delivery` | kupujący | Wybór dostawy; 409 `ORDER_NOT_AWAITING_PAYMENT`, `PAYMENT_DEADLINE_PASSED`, `PAYMENT_IN_PROGRESS`; 422 jak w F-24 (`SHIPPING_OPTION_UNAVAILABLE`, `PICKUP_POINT_*`, `DELIVERY_ADDRESS_REQUIRED`, `VALIDATION_FAILED`) |
| `POST /v1/orders/:id/payments` | kupujący | Płatność; `Idempotency-Key`; 201; 409 jak wyżej oraz `DELIVERY_REQUIRED`, `CHECKOUT_TOTAL_CHANGED`; 422 `IDEMPOTENCY_KEY_REUSED` |

`:id` to UUID albo numer zamówienia. Odpowiedzi `cache-control: private, no-store`.

### Eventy (outbox, wersja 1)

- `OrderPaid` (istniejący kontrakt z F-24): publikuje go teraz F-25.
- `OrderCancelled` (agregat `order`): `publicId`, `auctionId`, `buyerId`, `sellerId`, `reason` (`UNPAID`), `paymentPending` (czy płatność była w toku). Konsumenci: strike i druga szansa (F-26).
- `RefundRequested` (agregat `refund`): `paymentId`, `orderId`, `amount`, `reason`. Konsument: `payments.execute-refund`.
- `RefundSucceeded` (agregat `refund`): `paymentId`, `orderId`, `buyerId`, `amount`, `reason`. Konsumenci: powiadomienia (F-26).

### Joby

- `orders.expire-unpaid` (nowa kolejka `orders`), co 60 s.

## Reguły biznesowe i przypadki brzegowe

- **Kwoty liczy backend:** suma = cena + POK (z zamówienia, F-16) + dostawa (cena z cennika zapisana przy wyborze). Klient wysyła tylko sumę, którą widział, do porównania.
- **Nie da się zapłacić dwa razy:** zakładanie płatności i zapis dostawy blokują wiersz zamówienia (`FOR UPDATE`) aż do zapisu płatności, więc dwa równoległe „Zapłać” z różnymi kluczami dają jedną płatność i 409 `PAYMENT_IN_PROGRESS`. Płatność `PENDING` albo `SUCCEEDED` blokuje nową płatność i zmianę dostawy.
- **Ponowienie po porażce:** płatność `FAILED` nie blokuje nowej; zamówienie zostaje to samo. Klucz płatności u nas: `checkout:{orderId}:{Idempotency-Key}`.
- **Termin:** nowa płatność i zmiana dostawy tylko przed `payment_due_at`. Płatność w `PENDING` założona przed terminem przesuwa anulowanie do `payment_due_at + 30 min`; po tym czasie zamówienie jest anulowane, nawet jeśli płatność wciąż czeka.
- **Spóźniona płatność:** `PaymentSucceeded` dla zamówienia `CANCELLED_UNPAID` → pełny zwrot (`LATE_PAYMENT`), bez strike'a. `OrderCancelled.paymentPending` pozwala F-26 nie dawać strike'a od razu, gdy płatność jeszcze może przyjść.
- **Druga udana płatność** (np. kupujący zapłacił, a potem webhook zaginionej wcześniejszej płatności): pełny zwrot (`DUPLICATE_PAYMENT`).
- **Zwrot:** w ledgerze dopiero po potwierdzeniu operatora (`ORDER_REFUNDED`: wstrzymane środki zamówienia → `provider_cash`). Nieudany zwrot czeka na support.
- **Konsument `PaymentSucceeded`** jest idempotentny (`processed_events`) i blokuje zamówienie, więc wyścig z jobem anulowania rozstrzyga kolejność blokad: jeśli job był pierwszy, płatność jest spóźniona i wraca.
- **Dostawa:** usługa musi być akceptowana przez sprzedającego i pasować do gabarytu ze snapshotu (F-24). Wybór dostawy przed opłaceniem nie tworzy przesyłki u przewoźnika.
- **Sprzedający zablokowany albo bez potwierdzonego e-maila:** płatność odrzucona 409 `SELLER_UNAVAILABLE` z prośbą o kontakt z pomocą.
- **Odpowiedzi checkoutu nie ujawniają** danych sprzedającego poza nazwą wyświetlaną z aukcji.

## Bezpieczeństwo i prywatność

- Wszystkie trasy wymagają sesji; tylko kupujący zamówienia (inni 404).
- Kod BLIK: tylko w pamięci żądania i w wywołaniu operatora. Logger HTTP nie zapisuje treści żądań, a kod nie trafia do bazy, eventów ani odpowiedzi.
- Adres powrotu od operatora to strona checkoutu w domenie web (`WEB_URL`), bez parametrów z danymi.
- Idempotencja na trzech poziomach (klucz klienta, `payment:{id}` u operatora, webhooki) jak w F-23.
- Dane odbiorcy trafiają do przesyłki (F-24) i do przewoźnika dopiero przy nadaniu.

## Analityka

PostHog (za zgodą, F-06): `checkout_viewed`, `checkout_delivery_selected` (rodzaj usługi), `checkout_payment_started` (metoda), `checkout_payment_failed` (powód), `checkout_paid`. Bez kwot i danych osobowych.

## Kryteria akceptacji

- [x] Given checkout z wybraną dostawą, When kupujący płaci, Then kwota na przycisku, `orders.total` i kwota w żądaniu do operatora (FakeGateway) są identyczne, a podział to cena dla sprzedającego i POK + dostawa dla Biddy (test end-to-end API z workerem i webhookiem).
- [x] Given suma na ekranie inna niż w zamówieniu, When kupujący płaci, Then 409 `CHECKOUT_TOTAL_CHANGED` i płatność nie powstaje.
- [x] Given płatność w `PENDING` albo opłacone zamówienie, When kupujący płaci jeszcze raz (także równolegle innym kluczem), Then druga płatność nie powstaje.
- [x] Given termin płatności minął, When kupujący płaci albo zmienia dostawę, Then 409 `PAYMENT_DEADLINE_PASSED`.
- [x] Given odrzucony BLIK (`111111`), When kupujący płaci ponownie (`777123`), Then to samo zamówienie przechodzi w `PAID` z jedną udaną płatnością.
- [x] Given udana płatność, Then zamówienie jest `PAID` z `ship_by` po 5 dniach roboczych, a outbox ma `OrderPaid`.
- [x] Given płatność w `PENDING` założona przed terminem, Then job anuluje zamówienie dopiero 30 min po terminie; bez płatności w toku zaraz po terminie (`CANCELLED_UNPAID`, `OrderCancelled`, przesyłka anulowana).
- [x] Given zamówienie anulowane, When przychodzi webhook o udanej płatności, Then powstaje pełny zwrot (`LATE_PAYMENT`), po webhooku zwrotu ledger ma `ORDER_REFUNDED`, a saldo wstrzymane zamówienia wynosi 0; zamówienie zostaje `CANCELLED_UNPAID` bez strike'a.
- [x] Given web na atrapie API, Then pełna ścieżka działa w Playwright: wybór paczkomatu, BLIK, oczekiwanie, sukces; odrzucony BLIK i ponowienie; przekierowanie; termin minął; axe bez naruszeń WCAG 2.1 AA, bez poziomego przewijania przy 390 px.

## Plan testów

- **Jednostkowe (api):** termin efektywny z przedłużeniem, wyliczenie sumy, decyzja konsumenta (opłać, zwrot spóźnionej, zwrot duplikatu), walidacja kodu BLIK.
- **Jednostkowe (shared/ledger):** powód `DUPLICATE_PAYMENT`.
- **Integracyjne (Postgres, Redis):**
  - `GET checkout`, `PUT delivery` (punkt, kurier, błędy F-24, zmiana wyboru, po terminie, w trakcie płatności);
  - `POST payments`: idempotencja (replay, inny body → 422), równoległe dwa klucze, `CHECKOUT_TOTAL_CHANGED`, `DELIVERY_REQUIRED`, rejestracja sprzedawcy;
  - konsument `PaymentSucceeded` (opłacenie, spóźniona, duplikat, ponowne dostarczenie);
  - job `orders.expire-unpaid` (przedłużenie 30 min, anulowanie przesyłki);
  - zwroty: `RefundRequested` → operator → webhook → ledger;
  - end-to-end z workerem i FakeGateway: BLIK `777123`, `111111` z ponowieniem, kwoty zamówienia i FakeGateway równe.
- **Web (Vitest, Testing Library):** formularz dostawy (punkt, kurier, walidacja), wybór metody i kod BLIK, stany (oczekiwanie, błąd, sukces, termin minął), następna akcja „Zapłać” w Moje Biddy.
- **E2E (Playwright, atrapa API):** pełna ścieżka BLIK, odrzucenie i ponowienie, przekierowanie, termin minął, axe, 390 px.

## Postęp i odstępstwa (2026-10-27)

Gotowe: migracja `0018_checkout`, trasy checkoutu, konsument `orders.payment-succeeded`, job `orders.expire-unpaid` (nowa kolejka `orders`), tabela `refunds` z `RefundService` i obsługą webhooków zwrotów, strona `/zamowienia/[publicId]/zaplac`, „Zapłać” w Moje Biddy i w panelu wygranej, link w powiadomieniu o wygranej. Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 106–109.

Odstępstwa:

- **Kryterium 1 i „pełna ścieżka na FakeGateway”:** równość kwot ekran = zamówienie = operator sprawdza test end-to-end API z workerem, webhookami i FakeGateway (`checkout.int.test.ts`). Playwright działa na atrapie API (jak cały E2E web) i sprawdza, że suma na przycisku jest sumą wysłaną jako `expectedTotal` i zapisaną w zamówieniu. E2E web na prawdziwym API z workerem to osobna praca na infrastrukturze testów.
- **Przejścia zamówienia z F-26** (opłacenie i anulowanie nieopłaconego) są w F-25, bo bez nich płatność nie zmienia zamówienia i nie da się sprawdzić kryteriów 6–8 (decyzja nr 106).
- **Wybór punktu bez mapy** (wyszukiwarka i lista) i **bez Apple Pay / Google Pay**: zgodnie z „Poza zakresem” (decyzja nr 109).
- **Płótno F-63** nie ma osobnego ekranu checkoutu: układ jak strona nadania (formularz w kartach, podsumowanie obok) i kroki z panelu wygranej.

## Otwarte pytania

- **Zmiana metody w trakcie przekierowania:** kupujący, który porzuci stronę operatora, czeka, aż płatność wygaśnie (operator wysyła `PAYMENT_FAILED`). Prawdziwy operator (F-31) może dać anulowanie płatności; wtedy dodamy „Zmień metodę”.
- **Mapa punktów:** czy w becie wystarczy wyszukiwarka punktów, czy potrzebujemy mapy (widżet InPost Geowidget albo mapa Furgonetki)?
