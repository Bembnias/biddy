# F-24 · Dostawy

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-04 (kolejki i outbox), F-14 (gabaryt i przewoźnicy w przedmiocie), F-12 (magazyn plików)

## Kontekst i cel

Kupujący wybiera dostawę w checkoutcie (F-25), sprzedający nadaje paczkę po opłaceniu, a zamówienie przechodzi dalej według statusów przewoźnika (F-26): „odebrana” uruchamia okno 36 h, a zwrot nieodebranej paczki ścieżkę `NOT_PICKED_UP` ([PROJECT.md §7.4](../PROJECT.md#74-terminy), [§8](../PROJECT.md#8-dostawa)). Te feature'y potrzebują modułu `shipping`, który ukrywa przed domeną konkretnego przewoźnika.

F-24 dostarcza:

- port `ShippingProvider` z rejestrem adapterów;
- adapter testowy `FakeShippingProvider`, który w kilka minut przechodzi cały cykl dostawy, oraz adapter Furgonetki ([§8.1](../PROJECT.md#81-opcje-dostawy));
- cennik dostaw Biddy i mapowanie „gabaryt → przewoźnicy” w konfiguracji;
- przesyłki z etykietą albo kodem nadania, tracking przez webhooki i polling oraz mapowanie statusów;
- eventy dla cyklu zamówienia, przesyłki zwrotne i rejestr reklamacji u przewoźników.

## Historyjki użytkownika

- Jako kupujący chcę widzieć ceny dostawy już na stronie aukcji („dostawa od …”), a w zamówieniu tylko opcje, które sprzedający akceptuje i które pasują do gabarytu.
- Jako sprzedający po opłaceniu zamówienia chcę dostać powiadomienie, kliknąć „Nadaj”, podać dane nadawcy i sposób nadania, a potem dostać kod nadania albo etykietę do druku.
- Jako Biddy chcemy wiedzieć, kiedy paczka została odebrana albo wraca do nadawcy, nawet gdy webhook przewoźnika zaginie.
- Jako zespół chcemy przejść cały cykl dostawy lokalnie i na stagingu bez umowy z Furgonetką, także ścieżki nieodebranej i zagubionej paczki.

## Zakres

### Konfiguracja przewoźników i cennik (moduł `shipping`)

- **Przewoźnicy (`shipping_carriers`, z F-14)** dostają nowe kolumny:
  - sposoby nadania (`dispatch_methods`): `DROP_OFF` (nadanie w paczkomacie lub punkcie) i `COURIER_PICKUP` (kurier odbiera od nadawcy);
  - limity dla gabarytu XL: maksymalna waga, najdłuższy bok, obwód z długością (`max_weight_grams`, `max_length_cm`, `max_girth_cm`);
  - kody usług u dostawców (`provider_codes`, np. `{"furgonetka": "inpost"}`).
  Mapowanie „gabaryt → przewoźnicy” zostaje konfiguracją w bazie (§8.2), a nie stałą w kodzie.
- **Cennik dostaw Biddy (`shipping_rates`):**
  - cena brutto dla kupującego per usługa, gabaryt i waluta, z okresem obowiązywania;
  - okresy bez nakładania (ograniczenie wykluczające, jak cennik POK).
  Startowy cennik to migracja danych. Koszt u dostawcy zapisujemy osobno w przesyłce (`cost`).
- **Opcje dostawy dla przedmiotu** (`ShippingQuoteService.options`):
  - usługa aktywna, zaakceptowana przez sprzedającego i obsługująca gabaryt;
  - z ceną w cenniku na dziś;
  - XL tylko wtedy, gdy waga i wymiary mieszczą się w limitach usługi.
  Kolejność jak w konfiguracji.
- **Strona aukcji** pokazuje cenę przy każdym przewoźniku, a cena łączna przy licytacji i Kup teraz dostaje „+ dostawa od X zł” (najtańsza opcja; `GET /auctions/:id` ma `carriers[].price` i `shippingFrom`).
- **`GET /orders/:id/shipping-options`** (kupujący): opcje dla przedmiotu z zamówienia, liczone ze snapshotu z chwili zakupu.

### Port i adaptery

- **Port `ShippingProvider`** (`modules/shipping/ports/shipping-provider.port.ts`):
  - operacje: punkty odbioru, utworzenie przesyłki (idempotentne po kluczu), etykieta, tracking, anulowanie, parsowanie webhooka;
  - `capabilities.dispatchMethods`: sposoby nadania, które adapter umie obsłużyć;
  - błąd `ShippingProviderError` z kodami.
- **`ShippingProviderRegistry`**: adapter po nazwie zapisanej w przesyłce i adapter domyślny z `SHIPPING_DEFAULT_PROVIDER`. Brak adaptera dla dostawcy domyślnego zatrzymuje start.
- **FakeShippingProvider** (`adapters/fake/`), tylko poza produkcją:
  - stan symulowanego dostawcy w Postgresie (`fake_shipping_*`);
  - etykieta: wygenerowany PDF z napisem „Etykieta testowa”;
  - kod nadania (6 cyfr) dla paczkomatów i punktów, etykieta dla wszystkich usług.
- **Automat FakeShipping** (kolejka `shipping`):
  - po utworzeniu przesyłki job co `SHIPPING_FAKE_STEP_DELAY_MS` (domyślnie 20 s) dodaje kolejny status;
  - po każdym statusie podpisany webhook HTTP trafia na `/v1/webhooks/shipping/fake`;
  - cały cykl trwa około 2 minut.
- **Scenariusze FakeShipping:**
  - `DELIVERED` (domyślny): nadana, w drodze, w punkcie albo u kuriera, odebrana;
  - `NOT_PICKED_UP`: w punkcie, termin odbioru minął, zwrot do nadawcy, zwrócona;
  - `LOST`: utyka „w drodze”;
  - `MANUAL`: bez automatu.
  Scenariusz wybiera się w panelu deweloperskim albo magicznym punktem odbioru: wyszukiwarka punktów FakeShipping zwraca też punkty `…-NOPICKUP` i `…-LOST`.
- **Magiczne telefony nadawcy:** `+48500000000` (przewoźnik odrzuca dane, pole `sender.phone`) i `+48500000001` (przewoźnik niedostępny przy każdej próbie).
- **Adapter Furgonetki** (`adapters/furgonetka/`, REST API z mediami `application/vnd.furgonetka.v2+json`):
  - OAuth2: logowanie hasłem raz na instalację, potem odświeżanie tokenu (jednorazowy refresh token) pod blokadą wiersza w bazie; tokeny szyfrowane;
  - przesyłka: `PUT /create-package-command/{uuid}`, potem `PUT /order-commands/{uuid}`, z UUID wyprowadzonym z naszego klucza (ponowienie po błędzie sieci nie tworzy drugiej przesyłki);
  - etykieta: `GET /packages/{id}/label` (204: jeszcze nie ma);
  - tracking: `GET /packages/{id}/tracking`;
  - punkty: `POST /points/map`;
  - anulowanie: `PUT /cancel-command/{uuid}`;
  - koszt: `POST /packages/calculate-price`;
  - webhook: suma kontrolna MD5 z tokenem konta (`control`), odpowiedź `{"status":"OK"}`.
  W F-24 adapter obsługuje tylko nadanie `DROP_OFF`; zamówienie kuriera po paczkę to otwarte pytanie.

### Przesyłki

- **Tabele:**
  - `shipments`: przesyłka zamówienia (`OUTBOUND`) albo zwrot (`RETURN`);
  - `shipment_events`: historia trackingu;
  - `carrier_claims`: reklamacje u przewoźnika.
- **Wybór dostawy** (`ShipmentService.prepare`, woła go checkout F-25):
  - zapisuje przesyłkę `PENDING`: usługa, gabaryt i parametry paczki ze snapshotu, punkt odbioru (z nazwą i adresem) albo adres, odbiorca, cena z cennika;
  - punkt sprawdzamy u dostawcy;
  - ponowny wybór przed nadaniem zastępuje dane (jedna aktywna przesyłka na zamówienie i kierunek);
  - wynik: cena dostawy do zamówienia.
- **„Nadaj”** (`ShipmentService.dispatch`, `POST /orders/:id/shipment`):
  - sprzedający podaje dane nadawcy (imię i nazwisko, telefon, adres) i sposób nadania;
  - przesyłka przechodzi w `REQUESTED`, a job `shipping.create` w workerze tworzy ją u dostawcy;
  - potem pobiera etykietę do prywatnego kubełka;
  - na koniec status `CREATED` z numerem, kodem nadania lub etykietą i event `ShipmentCreated`.
  Błąd danych zgłoszony przez dostawcę (np. zły telefon) wraca jako `PENDING` z komunikatem do poprawy. Błąd przejściowy ponawia job, a po ostatniej próbie przesyłka też wraca do `PENDING` z komunikatem „spróbuj ponownie”.
- **Tracking:**
  - webhook dostawcy jest tylko wskazówką: kolejkuje `shipping.sync-tracking`, który pobiera pełną historię z API dostawcy;
  - polling zapasowy `shipping.poll-tracking` co 10 minut dociąga aktywne przesyłki niesprawdzane od 2 godzin (§8.3);
  - zdarzenia są idempotentne: unikalne `(shipment_id, raw_status, occurred_at)`.
- **Statusy wewnętrzne** (§8.3), plus stany przed utworzeniem u dostawcy:
  `PENDING → REQUESTED → CREATED → DROPPED_OFF → IN_TRANSIT → OUT_FOR_DELIVERY | READY_FOR_PICKUP → DELIVERED`, a także `EXCEPTION`, `RETURNING → RETURNED` i `CANCELLED`.
- **Event `ShipmentStatusChanged`** dla każdej zmiany, w kolejności chronologicznej:
  - niesie czas zdarzenia u przewoźnika i czas, w którym się o nim dowiedzieliśmy;
  - przy `RETURNING` niesie też powód: `NOT_COLLECTED` (paczka czekała na kupującego, czyli minął termin odbioru albo nie udało się doręczyć) albo `OTHER`.
  F-26 na tej podstawie uruchamia okno 36 h, przełącza zamówienie w `NOT_PICKED_UP` i robi zwrot po `RETURNED`.
- **Przesyłki zwrotne** (`direction = RETURN`): ten sam przepływ (`prepare` i `dispatch`) z nadawcą i odbiorcą zamienionymi miejscami. Uruchamia je F-28.
- **Anulowanie** (`ShipmentService.cancel`): `PENDING` od razu; `CREATED` przed nadaniem u dostawcy. Woła je F-26 przy `CANCELLED_NOT_SHIPPED`.
- **Rejestr reklamacji** (`CarrierClaimService`, §8.4):
  - otwarcie (`LOST`/`DAMAGED`, kwota roszczenia), zgłoszenie u przewoźnika, rozstrzygnięcie z kwotą odzyskaną;
  - event `CarrierClaimResolved`.
  Księgowanie (`CARRIER_CLAIM_SETTLED`) i UI dla supportu dodadzą F-26 i F-34.

### Zamówienie: powiadomienie i „Nadaj”

- **Event `OrderPaid`** (kontrakt w module `orders`, wersja 1): `publicId`, `auctionId`, `buyerId`, `sellerId`, `paidAt`, `shipBy`. Publikuje go checkout (F-25; pierwotnie planowany F-26) po konsumpcji `PaymentSucceeded`.
- **Powiadomienie `ORDER_PAID`** dla sprzedającego (in-app i e-mail transakcyjny):
  - treść: „Kupujący zapłacił za „{tytuł}”. Nadaj paczkę do {termin}.”;
  - link do strony nadania.
- **Strona nadania w web** `/zamowienia/[publicId]/nadaj` (sprzedający):
  - formularz danych nadawcy, wypełniony domyślnym adresem nadania (F-10), i wybór sposobu nadania;
  - informacja, że dane nadawcy zobaczy kupujący na etykiecie (§8.3);
  - po nadaniu: kod nadania, „Pobierz etykietę (PDF)”, numer przesyłki i status.
  „Moje Biddy → Sprzedane” dostaje aktywny link „Nadaj paczkę” dla opłaconych zamówień (F-21).
- **Trasy zamówienia** (moduł `orders`, który woła publiczne API `shipping`):
  - `GET /orders/:id/shipping-options`;
  - `GET /orders/:id/shipment`;
  - `POST /orders/:id/shipment`;
  - `GET /orders/:id/label`.

### Narzędzia deweloperskie

**Panel `/dev/fake-shipping`** (web, sesja; poza produkcją):

- przesyłki FakeShipping ze statusem w Biddy i u dostawcy, scenariuszem i historią;
- akcje:
  - „Następny status” według scenariusza;
  - ustawienie dowolnego statusu;
  - zmiana scenariusza;
  - „Synchronizuj” (pobranie trackingu bez webhooka);
  - pobranie etykiety;
- **przesyłka testowa bez zamówienia**: usługa, gabaryt, punkt (z magicznymi punktami), a potem ten sam formularz „Nadaj”, co na stronie zamówienia; odbiorcą jest zalogowana osoba z numerem testowym.

Na produkcji wszystkie trasy `/dev/fake-shipping` odpowiadają 404.

## Poza zakresem

- **Checkout:**
  - wybór dostawy, punktu na mapie i adresu w UI;
  - zapis `shipping_fee` w zamówieniu;
  - wołanie `ShipmentService.prepare` (F-25).
  F-24 daje API opcji, punktów i przygotowania przesyłki.
- **Przejścia zamówienia:**
  - `PAID` i publikacja `OrderPaid`, `SHIPPED`, `DELIVERED`, `NOT_PICKED_UP`, `LOST`;
  - terminy nadania i doręczenia;
  - zwroty środków i strike'i (F-26).
  F-24 daje eventy `ShipmentCreated`, `ShipmentStatusChanged` i `CarrierClaimResolved`.
- Zwroty w sporach: kto płaci za przesyłkę zwrotną i kiedy ją tworzymy (F-28).
- UI reklamacji i cennika w panelu admina (F-34). Do tego czasu zmiana cennika to migracja.
- Zamówienie kuriera po paczkę przez Furgonetkę (`COURIER_PICKUP` w adapterze Furgonetki), Poczta Polska i kurier gabarytowy (v1), InPost ShipX (v1), odbiór osobisty (v2).
- „Dostawa od” na kartach wyników wyszukiwarki (indeks Meilisearch).

## UX

**Strona aukcji** (F-18):

- sekcja „Dostawa” pokazuje każdego akceptowanego przewoźnika z ceną, np. „InPost Paczkomat 24/7 · 12,99 zł”;
- obok ceny aktualnej: „+ dostawa od 12,99 zł”;
- przewoźnik bez ceny w cenniku albo niepasujący do gabarytu nie jest pokazywany;
- gdy żadna opcja nie pasuje: „Żadna dostawa nie pasuje teraz do tego przedmiotu.” (stan awaryjny, np. usługa bez ceny w cenniku).

**Strona nadania `/zamowienia/[publicId]/nadaj`** (sprzedający, z linku w powiadomieniu i w „Moje Biddy”):

- nagłówek z tytułem przedmiotu, numerem zamówienia i terminem nadania;
- karta „Dokąd”: usługa, punkt odbioru (nazwa, adres) albo miasto odbiorcy, gabaryt;
- **formularz** (przesyłka `PENDING`):
  - imię i nazwisko, telefon, ulica z numerem, kod pocztowy, miejscowość, wypełnione domyślnym adresem nadania z konta;
  - sposób nadania jako pola wyboru tylko z dostępnych opcji, np. „Nadam w paczkomacie lub punkcie” albo „Kurier odbierze paczkę”;
  - informacja: „Te dane będą na etykiecie i zobaczy je kupujący.”;
  - przycisk „Nadaj”;
- **po kliknięciu** stan „Przygotowujemy przesyłkę…” z odświeżaniem co 2 s;
- **po utworzeniu:**
  - kod nadania dużą czcionką z instrukcją „Podaj kod w paczkomacie lub punkcie”;
  - albo przycisk „Pobierz etykietę (PDF)” z instrukcją „Wydrukuj etykietę i naklej ją na paczkę”;
  - numer przesyłki i bieżący status;
- **błąd dostawcy:** komunikat przy formularzu (np. „Przewoźnik odrzucił numer telefonu nadawcy”) i możliwość poprawy;
- **zamówienie, które nie czeka na nadanie** (nieopłacone, bez wybranej dostawy, już nadane przez kogoś innego): komunikat z linkiem do „Moje Biddy”; nie-sprzedający widzi „Nie znaleziono zamówienia”.

**Panel `/dev/fake-shipping`:**

- pasek „Środowisko testowe: FakeShipping, żadne paczki nie są wysyłane”;
- formularz „Nowa przesyłka testowa”;
- tabela przesyłek z akcjami w wierszach (opisane w „Zakresie”), odświeżanie co 5 s;
- każda akcja potwierdza wynik komunikatem `role="status"`.

Teksty po polsku i neutralne płciowo.

## Model danych

Migracja `0017_shipping`. Kwoty w groszach (`bigint`), ID UUIDv7, czasy `timestamptz`. `order_id` bez klucza obcego (granice modułów, §13.1).

**`shipping_carriers`** (nowe kolumny):

| Kolumna | Opis |
|---|---|
| `dispatch_methods` | `text[]`: `DROP_OFF`, `COURIER_PICKUP`; niepusta |
| `max_weight_grams`, `max_length_cm`, `max_girth_cm` | limity XL (null: bez limitu); obwód = najdłuższy bok + 2 × pozostałe |
| `provider_codes` | `jsonb`: kod usługi u dostawcy, np. `{"furgonetka": "inpost"}` |

**`shipping_rates`**: `id`, `carrier_id` (FK), `package_size`, `currency`, `price` (> 0), `valid_from`, `valid_to`, `created_at`. Ograniczenie wykluczające: jeden cennik dla `(carrier_id, package_size, currency)` w każdej chwili.

**`shipments`**

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7; też klucz idempotencji u dostawcy (z numerem próby) |
| `order_id` | zamówienie; null tylko dla przesyłki testowej FakeShipping (CHECK `order_id is not null or provider = 'fake'`) |
| `direction` | `OUTBOUND`, `RETURN` |
| `provider` | dostawca, np. `fake`, `furgonetka` |
| `carrier_id` | usługa z `shipping_carriers` (FK) |
| `package_size`, `parcel` | gabaryt i paczka (`jsonb`: waga, wymiary) ze snapshotu |
| `pickup_point` | `jsonb`: `id`, `name`, `address` punktu odbioru; null dla kuriera |
| `recipient`, `sender` | `jsonb`: imię i nazwisko, telefon, e-mail, adres (adres odbiorcy tylko dla kuriera); `sender` po „Nadaj” |
| `dispatch_method` | sposób nadania po „Nadaj” |
| `declared_value`, `reference` | wartość zawartości dla przewoźnika (cena przedmiotu) i numer zamówienia na etykiecie, zapisane przy „Nadaj” |
| `currency`, `price` | cena dla kupującego z cennika Biddy |
| `cost` | koszt u dostawcy (null, gdy dostawca nie podał) |
| `status`, `status_changed_at` | status wewnętrzny i czas zdarzenia, które go ustawiło |
| `provider_shipment_id`, `tracking_number`, `dropoff_code`, `label_key` | dane od dostawcy; etykieta w prywatnym kubełku |
| `dispatch_attempts`, `last_error` | numer próby utworzenia i komunikat ostatniego błędu dla sprzedającego |
| `requested_at`, `delivered_at`, `returned_at`, `cancelled_at`, `polled_at`, `created_at`, `updated_at` | czasy |

Indeksy:

- unikalny `(provider, provider_shipment_id)`;
- unikalny częściowy `(order_id, direction) WHERE status <> 'CANCELLED'`;
- `(status, polled_at)` dla pollingu.

**`shipment_events`**: `id`, `shipment_id` (FK), `raw_status` (status dostawcy), `status` (wewnętrzny), `description` (opis przewoźnika do pokazania, nie do logiki), `occurred_at`, `recorded_at`. Unikalne `(shipment_id, raw_status, occurred_at)`.

**`carrier_claims`**: `id`, `shipment_id` (FK, unikalny: najwyżej jedna reklamacja na przesyłkę), `type` (`LOST`/`DAMAGED`), `status` (`OPEN`/`SUBMITTED`/`ACCEPTED`/`REJECTED`), `currency`, `claimed_amount`, `recovered_amount` (przy rozstrzygnięciu), `provider_claim_ref`, `note`, `submitted_at`, `resolved_at`, `created_at`, `updated_at`.

**`furgonetka_tokens`**: jeden wiersz z zaszyfrowanym tokenem dostępu i odświeżania (AES-256-GCM, klucz wyprowadzony z `BETTER_AUTH_SECRET`) oraz `expires_at`.

**Tabele FakeShipping** (na produkcji puste):

- `fake_shipping_parcels`: przesyłka u symulowanego dostawcy, klucz idempotencji, scenariusz, numer, kod nadania;
- `fake_shipping_tracking`: statusy w notacji dostawcy;
- `fake_shipping_webhooks`: webhooki ze stanem dostarczenia.

## API i zdarzenia

### Port

- `ShippingProviderName = 'fake' | 'furgonetka'` (InPost ShipX dojdzie w v1 jako kolejna wartość i adapter).
- `findPoints({ carrier, near: { lat, lng } | phrase, pointId?, limit })` → `PickupPoint[]` (`id`, `name`, `address`, `location`, `distanceMeters`, `openingHours`).
- `createShipment(input)` → `{ providerShipmentId, trackingNumber, dropoffCode, cost }`:
  - wejście: `idempotencyKey`, usługa (`carrier` z kodami dostawcy), paczka, nadawca, odbiorca (punkt albo adres), `dispatchMethod`, `reference` (numer zamówienia);
  - ten sam klucz zwraca tę samą przesyłkę.
- `getLabel(providerShipmentId)` → PDF albo `null` (jeszcze nie gotowa).
- `getTracking(providerShipmentId)` → zdarzenia `{ rawStatus, status, occurredAt, description, returnReason? }` w kolejności chronologicznej.
- `cancelShipment(providerShipmentId)`.
- `parseWebhook({ headers, rawBody })` → `{ providerShipmentIds }`.
- `ShippingProviderError.code`: `INVALID_REQUEST` (z polem i komunikatem dla sprzedającego), `NOT_FOUND`, `INVALID_SIGNATURE`, `UNSUPPORTED`, `UNAVAILABLE`.

### Publiczne API modułu `shipping`

- `ShippingQuoteService.options(parcel, currency, at?)` i `cheapest(...)`.
- `ShipmentService`:
  - `prepare(input)`;
  - `dispatch(id, { sender, dispatchMethod })`;
  - `cancel(id)`;
  - `view(id)`, `forOrder(orderId, direction)`;
  - `label(id)`.
- `PickupPointService.find(query)`.
- `CarrierClaimService`: `open`, `submit`, `resolve`.
- `TrackingSync.sync(shipmentId)` i `TrackingPoller.pollActive()`: wykonanie jobów, także ręcznie w testach.

**Eventy** (outbox, wersja 1, agregat `shipment`):

- `ShipmentCreated`: `orderId`, `direction`, `provider`, `carrierId`, `trackingNumber`.
- `ShipmentStatusChanged`: `orderId`, `direction`, `status`, `previousStatus`, `occurredAt`, `detectedAt`, `returnReason` (przy `RETURNING`).
- `CarrierClaimResolved` (agregat `carrier-claim`): `shipmentId`, `orderId`, `type`, `status`, `claimed`, `recovered`.

`orderId` jest null tylko dla przesyłki testowej.

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `GET /v1/shipping/carriers` | każdy | Bez zmian (F-14) |
| `GET /v1/shipping/points?carrier=&lat=&lng=` albo `&q=` | sesja | Punkty odbioru usługi (najwyżej 50) |
| `GET /v1/auctions/:id` | każdy | `carriers[]` z `price`, nowe pole `shippingFrom` |
| `GET /v1/orders/:id/shipping-options` | kupujący | Opcje dla przedmiotu z zamówienia; `:id` = UUID albo numer zamówienia |
| `GET /v1/orders/:id/shipment` | kupujący, sprzedający | `{ order: { id, publicId, status, role, title }, shipment }`; kod nadania, dane nadawcy, etykieta i błąd utworzenia tylko dla sprzedającego |
| `POST /v1/orders/:id/shipment` | sprzedający | „Nadaj”: `{ sender, dispatchMethod }` → 202 z tym samym widokiem co `GET`. Wymaga zamówienia `PAID` i przesyłki `PENDING`; dla `REQUESTED` i dalszych zwraca bieżący stan (idempotentnie) |
| `GET /v1/orders/:id/label` | sprzedający | PDF etykiety (`application/pdf`); 404, gdy jej nie ma |
| `POST /v1/webhooks/shipping/:provider` | dostawca | Surowe body, poza OpenAPI. 200 `{ status: 'OK', received, unknown }`; 401 zły podpis; 404 nieznany dostawca |
| `GET /v1/dev/fake-shipping` | sesja | Przegląd panelu (50 najnowszych przesyłek z historią i webhookami) |
| `POST /v1/dev/fake-shipping/shipments` | sesja | Przesyłka testowa `{ carrierId, packageSize, pickupPointId? }` (scenariusz z magicznego punktu albo zmieniany po „Nadaj”) |
| `POST /v1/dev/fake-shipping/shipments/:id/dispatch` | sesja | „Nadaj” dla przesyłki testowej |
| `GET /v1/dev/fake-shipping/shipments/:id/label` | sesja | Etykieta przesyłki testowej |
| `POST /v1/dev/fake-shipping/shipments/:id/sync` | sesja | Synchronizacja trackingu |
| `POST /v1/dev/fake-shipping/parcels/:id/advance` | sesja | `{ status?, deliverWebhook? }`: następny status według scenariusza albo wskazany |
| `POST /v1/dev/fake-shipping/parcels/:id/scenario` | sesja | `{ scenario }` |

Błędy domenowe:

- 422 `SHIPPING_OPTION_UNAVAILABLE`: usługa nie pasuje albo nie ma ceny;
- 422 `PICKUP_POINT_REQUIRED`, `PICKUP_POINT_NOT_FOUND`, `DELIVERY_ADDRESS_REQUIRED`;
- 422 `DISPATCH_METHOD_UNAVAILABLE`;
- 409 `ORDER_NOT_AWAITING_SHIPMENT`: zamówienie nie jest `PAID` albo nie ma wybranej dostawy;
- 409 `SHIPMENT_ALREADY_DISPATCHED`: `prepare` po „Nadaj”;
- 400 `VALIDATION_FAILED` z błędami pól (`sender.phone`, `sender.address.postalCode`…);
- 503 `SERVICE_UNAVAILABLE`: dostawca nie odpowiada przy wyszukiwaniu punktów albo wyborze dostawy.

Klient API (`@biddy/api-client`) zwraca odpowiedzi PDF jako `Blob` (etykieta), a nie tekst.

### Format webhooka FakeShipping

- Nagłówek `x-fake-signature: t={unix},v1={hex}` jak w FakeGateway, z osobnym sekretem: HMAC z `BETTER_AUTH_SECRET` i etykietą `biddy:fake-shipping-webhook`.
- Body: `{ id, type: 'parcel.updated', created, parcel_id }`.
- Statusy FakeShipping, celowo w innej notacji niż nasze:
  - `confirmed`, `posted`, `in_transit`;
  - `out_for_delivery`, `awaiting_pickup`, `delivered`;
  - `exception`, `return_expired`, `returning`, `returned`, `cancelled`.

### Mapowanie statusów Furgonetki

| Furgonetka (`state`) | Biddy |
|---|---|
| `waiting`, `ordered`, `ready-for-transport` | `CREATED` |
| `collected` | `DROPPED_OFF` |
| `transit` | `IN_TRANSIT` |
| `delivery` | `OUT_FOR_DELIVERY` |
| `waiting-for-receiver` | `READY_FOR_PICKUP` |
| `delivered` | `DELIVERED`, a po `returned` w historii: `RETURNED` |
| `collect-problem`, `delivery-problem`, `unexpected-situation` | `EXCEPTION` |
| `returned` | `RETURNING` |
| `canceled` | `CANCELLED` |
| nieznany | pomijany z ostrzeżeniem w logach |

Furgonetka ma jeden stan zwrotu. Przyjmujemy więc, że `returned` to zwrot w drodze, a późniejsze `delivered` to doręczenie zwrotu do nadawcy. To założenie do potwierdzenia na sandboksie (otwarte pytania).

### Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `SHIPPING_DEFAULT_PROVIDER` | `fake` poza produkcją | Dostawca nowych przesyłek; na produkcji wymagany i różny od `fake` |
| `SHIPPING_FAKE_WEBHOOK_URL` | `{API_PUBLIC_URL}/v1/webhooks/shipping/fake` | Dokąd worker wysyła webhooki FakeShipping; przy `NODE_ENV=production` worker wymaga go albo `API_PUBLIC_URL` |
| `SHIPPING_FAKE_STEP_DELAY_MS` | `20000` | Odstęp automatu FakeShipping; `0` wyłącza automat |
| `FURGONETKA_API_URL` | sandbox poza produkcją, `https://api.furgonetka.pl` na produkcji | Adres API |
| `FURGONETKA_CLIENT_ID`, `FURGONETKA_CLIENT_SECRET` | — | Aplikacja OAuth; włączają adapter (wszystkie zmienne Furgonetki razem) |
| `FURGONETKA_USERNAME`, `FURGONETKA_PASSWORD` | — | Konto do pierwszego logowania (potem refresh token z bazy) |
| `FURGONETKA_WEBHOOK_TOKEN` | — | Token sumy kontrolnej webhooka z ustawień konta |

### Joby (kolejka `shipping`)

- `shipping.create`: utworzenie przesyłki u dostawcy i pobranie etykiety (ID z przesyłki i numeru próby).
- `shipping.fetch-label`: ponowne pobranie etykiety, gdy dostawca jeszcze jej nie ma.
- `shipping.sync-tracking`: pobranie trackingu. ID z przesyłki i 5-sekundowego okna, więc seria webhooków to jedna synchronizacja.
- `shipping.poll-tracking`: cykliczny, co 10 minut.
- `fake-shipping.advance` i `fake-shipping.deliver`: automat i webhooki FakeShipping.

## Reguły biznesowe i przypadki brzegowe

- **Opcje dostawy:**
  - liczymy je zawsze ze snapshotu przedmiotu w zamówieniu, więc późniejsza zmiana przedmiotu nie ma znaczenia;
  - cennik z dnia wyceny, a cenę zapisujemy w przesyłce;
  - zmiana cennika po checkoutcie nie zmienia zamówienia.
- **Gabaryt XL:**
  - tylko kurier;
  - waga, najdłuższy bok i obwód (najdłuższy bok + 2 × pozostałe) muszą mieścić się w limitach usługi;
  - brak danych w przedmiocie wyklucza usługę z limitami.
  S, M i L sprawdzamy tylko gabarytem (limit 25 kg pilnuje kreator).
- **Punkt odbioru:**
  - wymagany dla paczkomatu i punktu, a zabroniony dla kuriera (wtedy wymagany adres);
  - `prepare` sprawdza punkt u dostawcy (`findPoints` z `pointId`) i zapisuje jego nazwę oraz adres do wyświetlania.
- **„Nadaj”:**
  - tylko sprzedający zamówienia, zamówienie `PAID` i przesyłka `PENDING`;
  - sposób nadania musi być w konfiguracji usługi i w możliwościach adaptera;
  - telefon polski (9 cyfr, opcjonalnie +48), kod pocztowy `NN-NNN`.
  Podwójne kliknięcie i równoległe żądania dają jedną przesyłkę: przejście `PENDING → REQUESTED` robi `UPDATE … WHERE status = 'PENDING'`, a job ma ID z numerem próby.
- **Idempotencja u dostawcy:**
  - klucz `shipment:{id}:{numer próby}`;
  - Furgonetka dostaje deterministyczny UUID z tego klucza;
  - powtórka joba po utracie odpowiedzi nie tworzy drugiej przesyłki;
  - poprawione dane po błędzie to nowa próba z nowym kluczem.
- **Etykieta:**
  - pobieramy ją od razu po utworzeniu;
  - gdy dostawca jej jeszcze nie ma (204), ponawia `shipping.fetch-label`;
  - status `CREATED` nie czeka na etykietę, a strona pokazuje „Etykieta w przygotowaniu”.
- **Tracking:**
  - zdarzenia stosujemy w kolejności `occurred_at`;
  - zdarzenie starsze niż bieżący status zapisujemy w historii, ale nie zmienia statusu;
  - `DELIVERED`, `RETURNED` i `CANCELLED` są końcowe;
  - `EXCEPTION` nie jest końcowy (paczka może ruszyć dalej);
  - kilka nowych zdarzeń naraz (np. z pollingu) daje osobne eventy dla każdej zmiany statusu, w kolejności;
  - synchronizacja blokuje wiersz przesyłki (`FOR UPDATE`), więc webhook i polling nie zdublują eventów.
- **Powód zwrotu:** `NOT_COLLECTED`, gdy paczka była wcześniej `READY_FOR_PICKUP` albo `OUT_FOR_DELIVERY`, albo gdy dostawca podał ten powód (FakeShipping `return_expired`). W innym przypadku `OTHER` (np. problem w sortowni).
- **Webhook dla nieznanej przesyłki:** pomijamy go z ostrzeżeniem i odpowiadamy 200, bo Furgonetka wysyła powiadomienia o wszystkich paczkach konta.
- **Polling:**
  - przesyłki w stanach od `CREATED` do `RETURNING` (bez końcowych), niesprawdzane od 2 godzin;
  - najdawniej sprawdzane najpierw, po 100 na wykonanie;
  - błąd jednej przesyłki nie przerywa reszty.
- **Reklamacje:**
  - jedna na przesyłkę;
  - przejścia `OPEN → SUBMITTED → ACCEPTED | REJECTED`;
  - przy `ACCEPTED` kwota odzyskana jest od 0 do kwoty roszczenia, a przy `REJECTED` wynosi 0.

## Bezpieczeństwo i prywatność

- **Dane osobowe** (adresy, telefony, imiona i nazwiska) są w `shipments.sender`, `shipments.recipient` i na etykiecie:
  - kupujący widzi swój punkt lub adres, status i numer przesyłki;
  - sprzedający widzi też odbiorcę (jest na etykiecie), swój kod nadania i etykietę;
  - inni dostają 404.
  Retencję i anonimizację obejmie F-41.
- **Etykiety** trzymamy w prywatnym kubełku (`biddy-uploads`, klucz `shipping-labels/{id}.pdf`). API zwraca je tylko sprzedającemu, bez publicznego adresu.
- **Webhook Furgonetki** ma tylko sumę MD5 z tokenem. Traktujemy go więc jako wskazówkę: stan zawsze pobieramy z API Furgonetki uwierzytelnionym żądaniem, a fałszywy webhook może najwyżej wywołać dodatkową synchronizację. Webhook FakeShipping ma HMAC-SHA256 z tolerancją 5 minut.
- **Tokeny Furgonetki** są w bazie, zaszyfrowane, z blokadą przy odświeżaniu (jednorazowy refresh token). Hasło konta jest tylko w zmiennych środowiska i służy do pierwszego logowania.
- **Wyszukiwarka punktów** wymaga sesji, bo chronimy limit zapytań do dostawcy (5000 na godzinę).
- **`fake` na produkcji** jest zablokowany jak FakeGateway: walidacja konfiguracji, rejestr bez adaptera i 404 na trasach `/dev/fake-shipping`.

## Analityka

Brak nowych zdarzeń produktowych. Logi:

- utworzenie przesyłki (dostawca, usługa, czas);
- błędy dostawcy z kodem;
- webhooki (przesyłki znane i nieznane);
- polling (sprawdzone, zmienione);
- nieznane statusy dostawcy.

## Kryteria akceptacji

- [x] Given przedmiot z gabarytem i akceptowanymi przewoźnikami, When kupujący pobiera opcje dostawy zamówienia (i ogląda stronę aukcji), Then widzi tylko usługi zaakceptowane przez sprzedającego, obsługujące gabaryt (XL w limitach wagi i wymiarów) i mające cenę w cenniku, a strona aukcji pokazuje „dostawa od” z najtańszej opcji.
- [x] Given zamówienie, When `OrderPaid` trafia do outboxa, Then sprzedający dostaje powiadomienie z linkiem do nadania. Given opłacone zamówienie z wybraną dostawą, When sprzedający klika „Nadaj” z danymi nadawcy, Then worker tworzy przesyłkę u dostawcy, a sprzedający dostaje kod nadania lub etykietę PDF. Dwa kliknięcia dają jedną przesyłkę.
- [x] Given nadana przesyłka, When tracking (webhook albo polling) zgłasza odbiór, Then przesyłka ma `DELIVERED`, a outbox `ShipmentStatusChanged` z `status = DELIVERED` i czasem odbioru (start okna 36 h). Ten sam status z webhooka i pollingu daje jeden event.
- [x] Given przesyłka w punkcie, When termin odbioru mija i przewoźnik zgłasza zwrot, a potem doręczenie zwrotu, Then outbox ma `ShipmentStatusChanged` z `RETURNING` (`returnReason = NOT_COLLECTED`) i potem z `RETURNED`.
- [x] Given FakeShippingProvider z domyślnym odstępem, When sprzedający nadaje przesyłkę, Then automat przechodzi cały cykl do `DELIVERED` w kilka minut (test end-to-end API + worker z krótkim odstępem; scenariusz nieodebranej paczki też). Panel deweloperski pozwala wymusić każdy status, a przy wyłączonym FakeShipping trasy odpowiadają 404.
- [x] Given `SHIPPING_DEFAULT_PROVIDER=fake` (albo brak dostawcy) i `DEPLOYMENT_ENV=production`, When startuje API albo worker, Then konfiguracja jest odrzucona z czytelnym komunikatem.
- [x] Given adapter Furgonetki z atrapą HTTP, Then tworzy przesyłkę idempotentnie (te same UUID komend przy ponowieniu), odświeża token pod blokadą, mapuje statusy według tabeli i weryfikuje sumę kontrolną webhooka. Given wspólny zestaw testów kontraktowych `describeShippingProviderContract`, Then przechodzi dla FakeShipping (i dla sandboksu Furgonetki, gdy są dane dostępu).

## Plan testów

- **Jednostkowe:**
  - wybór opcji: akceptacja, gabaryt, limity XL, obwód, brak ceny, okres cennika;
  - mapowanie statusów FakeShipping i Furgonetki (`returned` i potem `delivered`);
  - reguły przejść i powód zwrotu;
  - podpis FakeShipping i suma MD5 Furgonetki;
  - UUID z klucza idempotencji;
  - adapter Furgonetki z atrapą `fetch`: logowanie, odświeżenie, 401 i powtórka, komendy z `commandExists`, etykieta 204, tracking v2, punkty, błędy 400 z `path`;
  - szyfrowanie tokenów;
  - PDF etykiety testowej;
  - walidacja danych nadawcy;
  - konfiguracja (blokada `fake`, zmienne Furgonetki razem, adres webhooka workera).
- **Integracyjne (Postgres, Redis, RustFS):**
  - testy kontraktowe FakeShipping;
  - opcje zamówienia (tylko kupujący, filtr) i ceny na stronie aukcji;
  - `prepare` (punkt, adres, zastąpienie, 409 po nadaniu);
  - „Nadaj” przez HTTP: tylko sprzedający, tylko `PAID`, równoległe kliknięcia, błąd dostawcy wraca do `PENDING`;
  - job tworzenia z etykietą w magazynie i `GET /label`;
  - webhook (401, nieznana przesyłka, deduplikacja);
  - polling;
  - przesyłka zwrotna;
  - anulowanie;
  - reklamacje;
  - `OrderPaid` → powiadomienie;
  - trasy deweloperskie (404 przy wyłączonym, 401 bez sesji);
  - end-to-end z workerem i API na porcie: scenariusze `DELIVERED` i `NOT_PICKED_UP` z eventami w kolejności.
- **Web (Vitest, Testing Library):**
  - ceny i „dostawa od” na stronie aukcji;
  - strona nadania: formularz z adresem domyślnym, walidacja, oczekiwanie, kod nadania, etykieta, błąd dostawcy, zamówienie nie do nadania;
  - panel FakeShipping;
  - link „Nadaj paczkę” w „Moje Biddy”.
- **E2E (Playwright):** brak nowych; pełna ścieżka z checkoutem w F-25 i F-26.
- **Kontrakt na sandboksie Furgonetki:** `test/integration/shipping-contract.int.test.ts` uruchamia ten sam zestaw dla Furgonetki, gdy są zmienne `FURGONETKA_SANDBOX_CLIENT_ID`, `_CLIENT_SECRET`, `_USERNAME`, `_PASSWORD` (opcjonalnie `_WEBHOOK_TOKEN`, `_POINT`); bez nich jest pominięty.

## Otwarte pytania

- **Stany zwrotu w Furgonetce:** czy `returned` oznacza zwrot w drodze, czy doręczony, i czy po zwrocie przychodzi `delivered`? Do sprawdzenia na sandboksie (`PUT /packages/tracking/simulate`) przed startem. Od tego zależy moment zwrotu środków za nieodebraną paczkę (§7.4).
- **Kod nadania bez etykiety** (InPost Paczkomat, Orlen Paczka) przez Furgonetkę: czy API go zwraca? Do czasu odpowiedzi adapter Furgonetki daje etykietę PDF, a kod nadania tylko wtedy, gdy przyjdzie w danych przesyłki.
- **Zamówienie kuriera po paczkę** (`COURIER_PICKUP`) przez Furgonetkę: `pickup-commands` z propozycją terminu. Do zrobienia po potwierdzeniu, czy sprzedający w becie tego potrzebują.
- **Koszt przesyłki a cena dla kupującego:** cennik Biddy jest stały, a koszt u Furgonetki zależy od umowy. Marżę lub stratę na dostawie zmierzymy w becie (`shipments.price − cost`).
- **Limity XL i startowy cennik** to wartości robocze. Potwierdzimy je stawkami Furgonetki (§8.5).
