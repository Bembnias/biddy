# F-23 · Port płatności i FakeGateway

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-04 (kolejki i outbox), F-22 (ledger)

## Kontekst i cel

Operatora płatności jeszcze nie wybraliśmy (PayU albo Mangopay, [PROJECT.md §7.6](../PROJECT.md#76-operator-płatności)), a checkout (F-25), cykl zamówienia (F-26), wypłaty (F-27) i spory (F-28) muszą powstać wcześniej. Dlatego domena Biddy rozmawia z operatorem wyłącznie przez port `PaymentGateway` ([§7.8](../PROJECT.md#78-moduł-płatności-adapter)), a do czasu umowy pracuje na pełnoprawnym adapterze testowym `FakeGateway`.

F-23 dostarcza ten port, rejestr adapterów, FakeGateway z asynchronicznymi webhookami i narzędziami deweloperskimi oraz cały operator-niezależny tor zdarzeń: odbiór webhooka z weryfikacją podpisu, idempotencję (`processed_webhooks`), obsługę zdarzenia w jednej transakcji z ledgerem i outboxem oraz polling zapasowy. Prawdziwy adapter (F-31) będzie musiał przejść ten sam zestaw testów kontraktowych.

## Historyjki użytkownika

- Jako zespół chcemy przejść cały przepływ płatności (utworzenie, potwierdzenie, webhook, ledger, event) lokalnie i na stagingu, zanim podpiszemy umowę z operatorem.
- Jako tester chcę wymusić wynik płatności magicznym kodem BLIK albo przyciskiem na testowej stronie płatności i ręcznie wywołać zdarzenia, które u prawdziwego operatora zdarzają się rzadko (chargeback, nieudana wypłata, zmiana statusu KYC).
- Jako Biddy chcemy, żeby zgubiony, zdublowany albo podrobiony webhook nie zmienił stanu płatności błędnie ani dwa razy.
- Jako zespół chcemy mieć pewność, że adapter testowy nie uruchomi się na produkcji.

## Zakres

### Port i rejestr

- **Port `PaymentGateway`** (`modules/payments/ports/payment-gateway.port.ts`): operacje biznesowe Biddy (rejestracja sprzedawcy i jego status, płatność i jej stan, zwolnienie środków, zwrot, wypłata, parsowanie webhooka), typy wejścia i wyniku, `GatewayCapabilities` (z `internalTransfers` i `paymentRequiresVerifiedSeller`), znormalizowane zdarzenia `NormalizedPaymentEvent` i błąd `PaymentGatewayError` z kodami. Kształt jak szkic w §7.8, z uzupełnieniami opisanymi w sekcji „API i zdarzenia”.
- **`GatewayRegistry`**: adapter po nazwie operatora zapisanej w rekordzie (`payments.provider`, `seller_accounts.provider`) i adapter domyślny dla nowych płatności z `PAYMENTS_DEFAULT_PROVIDER`. Brak adaptera dla operatora domyślnego zatrzymuje start aplikacji.
- **Środowisko wdrożenia `DEPLOYMENT_ENV`** (`local`, `preview`, `staging`, `production`, §18.1). Staging działa z `NODE_ENV=production`, więc samo `NODE_ENV` nie odróżnia go od produkcji. Przy `NODE_ENV=production` bez tej zmiennej przyjmujemy `production` (bezpieczna wartość domyślna).

### FakeGateway (`modules/payments/adapters/fake/`)

- **Stan symulowanego operatora w Postgresie** (tabele `fake_gateway_*`), bo API tworzy płatności, a worker je rozlicza i wysyła webhooki.
- **Asynchroniczność przez BullMQ** (nowa kolejka `payments`):
  - job `fake-gateway.settle` z opóźnieniem `PAYMENTS_FAKE_WEBHOOK_DELAY_MS` (domyślnie 2 s) rozlicza płatność, zwrot albo wypłatę;
  - job `fake-gateway.deliver` wysyła podpisany webhook HTTP na nasz własny endpoint `/v1/webhooks/payments/fake`, z ponowieniami jak każdy job;
  - testujemy więc prawdziwą ścieżkę z podpisem, a nie skrót w pamięci.
- **Magiczne kody BLIK:**
  - `777123`: płatność udana,
  - `111111`: odrzucona,
  - `222222`: zostaje w `PENDING` bez webhooka (test pollingu i terminów),
  - każdy inny kod: od razu `FAILED` z powodem `INVALID_BLIK_CODE`.
- **Przepływy z przekierowaniem** (BLIK bez kodu, karta, przelew, Apple Pay, Google Pay): wynik `ACTION_REQUIRED` z adresem testowej strony płatności w web `/dev/fake-pay/{paymentId}`, na której są przyciski „Zapłać” i „Odrzuć”.
- **Symulacja KYC:**
  - rejestracja sprzedawcy jest domyślnie od razu `VERIFIED`;
  - e-mail z `+kyc-pending` albo `+kyc-rejected` w części lokalnej daje odpowiednio `PENDING` albo `REJECTED`;
  - status zmienia też panel deweloperski (webhook `SELLER_STATUS_CHANGED`).
- **Saldo sprzedawcy u operatora** (model `SELLER_BALANCE`, jak przewidujemy w PayU):
  - udana płatność dodaje część sprzedawcy;
  - zwrot odejmuje najpierw z części sprzedawcy;
  - wypłata ponad saldo kończy się błędem `INSUFFICIENT_BALANCE`.
- **Panel deweloperski** (web `/dev/fake-gateway`, dla zalogowanych):
  - ostatnie płatności, sprzedawcy, wypłaty i webhooki ze stanem dostarczenia;
  - ręczne zdarzenia: chargeback (otwarcie, zamknięcie wygrane albo przegrane), nieudana wypłata, zmiana statusu KYC;
  - ponowne dostarczenie webhooka, żeby pokazać idempotencję;
  - płatność rozliczona bez webhooka, żeby pokazać polling.
- **Blokada na produkcji:**
  - konfiguracja z `fake` przy `DEPLOYMENT_ENV=production` nie przechodzi walidacji, więc aplikacja nie startuje;
  - FakeGateway nie trafia wtedy do rejestru;
  - trasy deweloperskie odpowiadają 404.

### Płatności w domenie (operator-niezależne)

- **Tabele:**
  - `payments`: płatność zamówienia u operatora;
  - `seller_accounts`: konto sprzedawcy u operatora, minimalne kolumny; KYC i DAC7 dojdą w F-32;
  - `processed_webhooks`: idempotencja webhooków.
- **`SellerAccountService.register`**: idempotentna rejestracja sprzedawcy u operatora domyślnego (`registerSeller`) z zapisem w `seller_accounts`.
- **`PaymentService.createPayment`**: tworzy płatność dla zamówienia w trzech krokach:
  1. wiersz `PENDING` idempotentny po kluczu wywołującego;
  2. wywołanie operatora z kluczem `payment:{id}`;
  3. zapis wyniku: identyfikator operatora i adres przekierowania, a od razu `FAILED` albo `SUCCEEDED`, gdy operator tak odpowie.
- **Pipeline webhooków** `POST /v1/webhooks/payments/:provider`:
  - surowe body (podpis liczymy z bajtów), `adapter.parseWebhook()`;
  - każde zdarzenie we własnej transakcji: wpis `processed_webhooks` (duplikat = pominięcie), handler, ledger, outbox.
- **Handler zdarzeń:**
  - `PAYMENT_SUCCEEDED`: status `SUCCEEDED`, księgowanie `PAYMENT_RECEIVED` (i `PAYMENT_FEE_CHARGED`, gdy operator poda opłatę), event `PaymentSucceeded`;
  - `PAYMENT_FAILED`: status `FAILED`, event `PaymentFailed`;
  - `SELLER_STATUS_CHANGED`: `seller_accounts.kyc_status`, event `SellerKycStatusChanged`;
  - zdarzenia zwrotów, wypłat i chargebacków są przyjmowane i zapisywane jako bez obsługi; obsłużą je F-26–F-28.
- **Polling zapasowy:** job `payments.poll-pending` co minutę dociąga przez `getPayment()` płatności w `PENDING` starsze niż 15 minut. Płatność bez identyfikatora operatora po 15 minutach jest `FAILED` (`PROVIDER_ERROR`).
- **Testy kontraktowe:** wspólny zestaw `describeGatewayContract` w `apps/api/test/support/` uruchamiany dla FakeGateway w testach integracyjnych (każdy PR).
- **Wdrożenie:**
  - `DEPLOYMENT_ENV` i adres webhooka dla workera w `render.yaml`, stosie Dokploy i teście dymnym obrazu;
  - na stagingu działa FakeGateway.

## Poza zakresem

- Endpoint i ekran checkoutu, wybór metody, kod BLIK w UI, stany oczekiwania (F-25). F-23 daje `PaymentService.createPayment` i testową stronę płatności.
- Przejścia zamówienia po płatności (`OrderPaid`, anulowanie, spóźniona płatność ze zwrotem): F-25 i F-26 konsumują `PaymentSucceeded` i `PaymentFailed`.
- Tabele i obsługa zwrotów, wypłat i chargebacków (`refunds`, `payouts`, `chargebacks`): F-26–F-28. Port i FakeGateway je już obsługują (testy kontraktowe), a pipeline przyjmuje ich webhooki.
- Rejestracja sprzedawcy przy pierwszym wystawieniu, onboarding i pełne KYC, dane DAC7 (F-32). `createPayment` wymaga istniejącego konta sprzedawcy u operatora.
- Prawdziwy adapter operatora i nocne testy kontraktowe na jego sandboksie (F-31), uzgodnienia z raportami operatora (F-33).
- Rejestracja sprzedawcy w trakcie checkoutu, gdy jeszcze nie ma konta (decyzja w F-25).

## UX

Dwa ekrany deweloperskie w web, poza nawigacją, z `noindex`. Na produkcji API odpowiada na ich zapytania 404, więc pokazują „nie znaleziono”.

**Testowa strona płatności `/dev/fake-pay/[paymentId]`** (bez logowania, jak strona operatora: adres jest trudny do odgadnięcia):

- pasek „Środowisko testowe: FakeGateway, żadne pieniądze nie są pobierane”;
- kwota, metoda, numer płatności i stan;
- dla płatności w toku przyciski „Zapłać” (główny) i „Odrzuć”;
- po kliknięciu powrót na `returnUrl`, ale tylko w obrębie domeny web; w innym przypadku link;
- płatność już rozliczona pokazuje stan i link powrotu;
- błąd sieci: komunikat z ponowieniem.

**Panel `/dev/fake-gateway`** (wymaga logowania; bez sesji link do logowania):

- tabele z akcjami w wierszach, odświeżanie co 5 s:
  - **Płatności:** stan, kwota, metoda; „Zapłać” i „Odrzuć” dla `PENDING`; „Rozlicz bez webhooka” (test pollingu); dla udanych „Chargeback”, a przy otwartym „Wygrany” i „Przegrany”;
  - **Sprzedawcy:** status KYC z wyborem nowego statusu;
  - **Wypłaty:** „Odrzuć wypłatę”;
  - **Webhooki:** typ, obiekt, czas, liczba prób, dostarczono albo ostatni błąd; „Wyślij ponownie”.
- każda akcja potwierdza wynik krótkim komunikatem `role="status"`.

Teksty neutralne płciowo, po polsku.

## Model danych

Migracja `0016_payments`. Kwoty w groszach (`bigint`), ID UUIDv7 nadawane przez aplikację; identyfikatory operatora to nieprzezroczyste teksty. Kolumny `order_id`, `buyer_id`, `seller_id`, `user_id` bez kluczy obcych (granice modułów, §13.1).

**`payments`**

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `order_id`, `buyer_id`, `seller_id` | zamówienie i strony |
| `provider` | operator, np. `fake` |
| `provider_payment_id` | ID u operatora; null do czasu odpowiedzi; unikalne z `provider` |
| `method` | `BLIK`, `CARD`, `PAY_BY_LINK`, `APPLE_PAY`, `GOOGLE_PAY` |
| `currency`, `amount` | cała wpłata (> 0) |
| `seller_amount`, `platform_amount` | podział (split): cena dla sprzedającego i część Biddy (POK + dostawa); suma = `amount` (CHECK) |
| `status` | `PENDING`, `SUCCEEDED`, `FAILED` |
| `failure_reason` | powód przy `FAILED` (CHECK: tylko i zawsze przy `FAILED`) |
| `redirect_url` | adres strony operatora dla `ACTION_REQUIRED` |
| `idempotency_key` | klucz wywołującego (unikalny), np. `order:{orderId}:attempt:1` |
| `raw` | ostatnia surowa odpowiedź operatora (jsonb) |
| `polled_at` | ostatnie sprawdzenie przez polling |
| `succeeded_at`, `failed_at`, `created_at`, `updated_at` | czasy |

Indeksy: unikalny `(provider, provider_payment_id)`, `(status, created_at)` dla pollingu, `(order_id)`.

**`seller_accounts`**: id, `user_id`, `provider`, `provider_account_id`, `type` (`PRIVATE`/`BUSINESS`), `kyc_status` (`PENDING`/`VERIFIED`/`REJECTED`), `created_at`, `updated_at`. Unikalne `(user_id, provider)` i `(provider, provider_account_id)`. Pozostałe kolumny z §13.3 (`payout_method_masked`, `payouts_blocked_until`, `dac7_data`, `nip`) dojdą z F-27 i F-32.

**`processed_webhooks`**: `provider`, `event_id` (klucz główny z `provider`), `event_type`, `outcome` (`HANDLED` albo `IGNORED`: zdarzenie bez obsługi w tej wersji), `processed_at`.

**Tabele FakeGateway** (tylko adapter testowy; na produkcji puste):

- `fake_gateway_sellers`: konto sprzedawcy, status KYC, saldo;
- `fake_gateway_payments`: płatność, wynik pierwszego wywołania (do idempotencji), kwota zwrócona, stan chargebacku;
- `fake_gateway_refunds`, `fake_gateway_payouts`;
- `fake_gateway_events`: webhooki w formacie operatora, z liczbą prób dostarczenia, ostatnim błędem i czasem dostarczenia.

Klucze idempotencji są unikalne w swojej tabeli.

## API i zdarzenia

### Port (różnice wobec szkicu z §7.8)

- `PaymentProvider = 'fake' | 'payu' | 'mangopay' | 'stripe'`.
- `RegisterSellerInput`: `sellerId`, `idempotencyKey`, `type`, `email`, `displayName`. `SellerAccountResult`: `providerSellerId`, `status` (`SellerStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'`).
- `PaymentSnapshot`: `providerPaymentId`, `status` (`PENDING`/`SUCCEEDED`/`FAILED`), `amount`, `refundedAmount`, `failureReason?`, `providerFee?`.
- `ReleaseFundsInput`: płatność, konto sprzedawcy, kwota sprzedawcy i klucz. `ReleaseFundsResult`: `SUCCEEDED` albo `NOT_REQUIRED` (model `SELLER_BALANCE`: zwolnienie jest tylko w ledgerze).
- `RefundResult` i `PayoutResult`: ID operatora i stan (`PENDING`, potem webhook).
- `PaymentFailureReason`: `DECLINED`, `INVALID_BLIK_CODE`, `EXPIRED`, `CANCELLED`, `SELLER_NOT_VERIFIED`, `PROVIDER_ERROR`.
- Chargebacki mają ID operatora, a `CHARGEBACK_CLOSED` niesie wynik `WON`/`LOST` (bez niego F-28 nie rozstrzygnie, kto ponosi koszt).
- `PaymentGatewayError.code`:
  - `INVALID_REQUEST`, `IDEMPOTENCY_CONFLICT`, `INVALID_SIGNATURE`, `NOT_FOUND`;
  - `REFUND_EXCEEDS_PAYMENT`, `INSUFFICIENT_BALANCE`, `SELLER_NOT_VERIFIED`, `UNAVAILABLE`.

### Publiczne API modułu `payments`

- `PaymentService.createPayment(input)`:
  - wejście: `orderId`, `buyer` (`id`, `email`, `ip`), `sellerId`, `amount`, `sellerAmount`, `method`, `returnUrl`, `idempotencyKey`;
  - wynik: `PaymentView` (status, `redirectUrl`, powód porażki);
  - `PaymentService.get(id)` zwraca ten sam widok.
- `SellerAccountService.register({ userId, email, displayName, type })` i `find(userId, provider?)`.
- `GatewayRegistry` (adapter dla rekordu, domyślny operator).
- `PendingPaymentsPoller.pollPending()`: wykonanie joba, także ręcznie w testach.
- Eventy (outbox, wersja 1):
  - `PaymentSucceeded` (agregat `payment`): `orderId`, `buyerId`, `sellerId`, `provider`, `method`, `amount`;
  - `PaymentFailed`: `orderId`, `buyerId`, `provider`, `reason`;
  - `SellerKycStatusChanged` (agregat `seller-account`): `userId`, `provider`, `status`, `previousStatus`.

### REST

| Metoda i ścieżka | Kto | Opis |
|---|---|---|
| `POST /v1/webhooks/payments/:provider` | operator | Surowe body, podpis w nagłówkach adaptera. 200 `{ received, processed, duplicates }`; 401 zły podpis; 404 nieznany operator; 500 błąd obsługi (operator ponowi). Poza OpenAPI (trasa Fastify). |
| `GET /v1/dev/fake-gateway/payments/:id` | każdy | Płatność FakeGateway dla strony testowej |
| `POST /v1/dev/fake-gateway/payments/:id/complete` | każdy | `{ outcome: 'SUCCEEDED' \| 'FAILED', deliverWebhook?: true }`; 409, gdy płatność nie czeka |
| `GET /v1/dev/fake-gateway` | sesja | Przegląd panelu: płatności, sprzedawcy, wypłaty, webhooki (po 50 najnowszych) |
| `POST /v1/dev/fake-gateway/payments/:id/chargeback` | sesja | `{ action: 'OPEN' \| 'WON' \| 'LOST' }` |
| `POST /v1/dev/fake-gateway/payouts/:id/fail` | sesja | Odrzucenie wypłaty, zwrot na saldo |
| `POST /v1/dev/fake-gateway/sellers/:id/status` | sesja | `{ status }` |
| `POST /v1/dev/fake-gateway/events/:id/redeliver` | sesja | Ponowne dostarczenie webhooka |

Wszystkie `/v1/dev/fake-gateway/*` odpowiadają 404, gdy FakeGateway jest wyłączony.

### Format webhooka FakeGateway

- Nagłówek `x-fake-signature: t={unix},v1={hex}`, gdzie `hex = HMAC-SHA256(sekret, "{t}.{body}")`.
- Body: `{ id, type, created, object }`.
- Typy w notacji operatora:
  - `payment.completed`, `payment.rejected`;
  - `refund.completed`, `refund.rejected`;
  - `payout.completed`, `payout.rejected`;
  - `seller.status_changed`;
  - `chargeback.opened`, `chargeback.closed`.
- `parseWebhook` mapuje je na zdarzenia znormalizowane.
- Sekret wyprowadzamy z `BETTER_AUTH_SECRET` (HMAC z etykietą `biddy:fake-payments-webhook`). API i worker mają go zawsze ten sam, więc staging nie potrzebuje nowego sekretu.

### Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `DEPLOYMENT_ENV` | `production` przy `NODE_ENV=production`, inaczej `local` | Środowisko wdrożenia (§18.1); `fake` tylko poza `production` |
| `PAYMENTS_DEFAULT_PROVIDER` | `fake` poza produkcją | Operator nowych płatności; na produkcji wymagany i różny od `fake` |
| `PAYMENTS_FAKE_WEBHOOK_URL` | `{API_PUBLIC_URL}/v1/webhooks/payments/fake` | Dokąd worker wysyła webhooki FakeGateway. Przy `NODE_ENV=production` worker wymaga go albo `API_PUBLIC_URL` |
| `PAYMENTS_FAKE_WEBHOOK_DELAY_MS` | `2000` | Opóźnienie rozliczenia i webhooka |

### Joby (kolejka `payments`)

- `fake-gateway.settle`: rozliczenie z opóźnieniem.
- `fake-gateway.deliver`: wysłanie webhooka, ID joba z ID zdarzenia i numerem dostarczenia.
- `payments.poll-pending`: cykliczny, co 60 s.

## Reguły biznesowe i przypadki brzegowe

- **Idempotencja na trzech poziomach:**
  - wywołujący → `payments.idempotency_key`: ponowienie zwraca tę samą płatność, a inne dane z tym samym kluczem dają 422 `IDEMPOTENCY_KEY_REUSED`;
  - my → operator: klucz `payment:{id}`, ponowienie po błędzie sieci nie tworzy drugiej płatności u operatora;
  - operator → my: `processed_webhooks (provider, event_id)`.
- **Ten sam webhook dostarczony wiele razy**, także równolegle, zmienia stan raz: drugi wpis do `processed_webhooks` czeka na pierwszą transakcję i trafia na konflikt.
- **Przejścia stanu:**
  - `PENDING → SUCCEEDED | FAILED`;
  - `FAILED → SUCCEEDED` jest dozwolone (pieniądze wpłynęły, np. po naszym `PROVIDER_ERROR`);
  - `SUCCEEDED` jest końcowy: późniejsze `PAYMENT_FAILED` ignorujemy z ostrzeżeniem.
  Każde przejście robi `SELECT … FOR UPDATE`, więc webhook i polling nie zaksięgują wpłaty dwa razy. Księgowanie ma też własny klucz `payment:{id}:received`.
- **Webhook przed zapisem identyfikatora operatora** (wyścig z `createPayment`): płatność nieznana, więc 500 i operator ponawia (FakeGateway: ponowienia BullMQ).
- **Kwota w zdarzeniu różna od kwoty płatności:** błąd, bez zmiany stanu (ponowienia, potem dead-letter i Sentry). Nie księgujemy niezgodnej kwoty.
- **Operator nieznany albo nieobsługiwany w rejestrze:** webhook 404, polling pomija płatność z ostrzeżeniem.
- **Polling:**
  - płatności `PENDING` starsze niż 15 minut, najdawniej sprawdzane najpierw, po 100 na wykonanie;
  - błąd jednej płatności nie przerywa reszty;
  - stan `PENDING` u operatora tylko ustawia `polled_at`.
- **BLIK:** kodu nie zapisujemy ani nie logujemy (jest jednorazowy). Klucz idempotencji płatności nie zależy od kodu.
- **Konto sprzedawcy:** `createPayment` bez konta sprzedawcy u operatora domyślnego kończy się 409 `CONFLICT`. Rejestracja jest idempotentna po `(user_id, provider)`.
- **Zwrot FakeGateway** przekraczający kwotę płatności (łącznie z wcześniejszymi): `REFUND_EXCEEDS_PAYMENT`. Wypłata ponad saldo albo dla niezweryfikowanego sprzedawcy: `INSUFFICIENT_BALANCE` albo `SELLER_NOT_VERIFIED`.
- **`returnUrl`** musi być adresem `http(s)`. Strona testowa przekierowuje automatycznie tylko w obrębie własnej domeny.

## Bezpieczeństwo i prywatność

- **Podpis webhooka:**
  - HMAC-SHA256 z bajtów body i znacznika czasu;
  - porównanie w stałym czasie, tolerancja ±5 minut (ochrona przed powtórzeniem starego webhooka);
  - zły podpis to 401 bez szczegółów.
- **Endpoint webhooka** ma własny parser (surowe bajty, limit 1 MiB) tylko w swoim zakresie Fastify. Reszta API nadal przyjmuje wyłącznie JSON. Nie wymaga sesji, więc CSRF go nie dotyczy (brak ciasteczek).
- **`fake` na produkcji jest zablokowany na trzech poziomach:**
  - walidacja konfiguracji: aplikacja nie startuje;
  - rejestr bez FakeGateway;
  - trasy `/dev/*` odpowiadają 404.
- **Panel deweloperski wymaga sesji.** Strona testowa płatności działa bez sesji tylko z identyfikatorem płatności (UUIDv7, 74 bity losowe), jak strona operatora.
- **Dane:**
  - żadnych danych kart;
  - e-mail kupującego trafia do operatora (wymaga tego każdy operator), ale nie do eventów;
  - `raw` przechowuje odpowiedź operatora bez danych wrażliwych (FakeGateway nie zwraca żadnych).

## Analityka

Brak zdarzeń produktowych (narzędzie deweloperskie). Logi: odebrany webhook (operator, liczba zdarzeń, duplikaty), wynik pollingu (sprawdzone, zmienione), ostrzeżenia o zdarzeniach bez obsługi i niezgodnych kwotach.

## Kryteria akceptacji

- [x] Given wspólny zestaw testów kontraktowych `describeGatewayContract`, When uruchamiamy go dla FakeGateway, Then przechodzi:
  - idempotentne `createPayment` (ten sam wynik, inne dane → `IDEMPOTENCY_CONFLICT`);
  - `parseWebhook` odrzuca zmanipulowane body, podpis i stary znacznik czasu;
  - częściowe zwroty nie przekraczają kwoty płatności;
  - wypłata ponad saldo kończy się błędem;
  - każdy typ webhooka operatora mapuje się na zdarzenie znormalizowane.
- [x] Given udana płatność, When ten sam webhook przychodzi 3 razy (kolejno i równolegle), Then płatność zmienia stan raz, ledger ma jedno księgowanie `PAYMENT_RECEIVED`, a outbox jeden `PaymentSucceeded`.
- [x] Given płatność w `PENDING` dłużej niż 15 minut, której webhook zaginął, When działa polling, Then płatność przechodzi w stan od operatora z księgowaniem i eventem. Płatność młodsza niż 15 minut nie jest sprawdzana.
- [x] Given `PAYMENTS_DEFAULT_PROVIDER=fake` (albo brak operatora) i `DEPLOYMENT_ENV=production` (także domyślnie przy `NODE_ENV=production`), When startuje API albo worker, Then konfiguracja jest odrzucona z czytelnym komunikatem. Na stagingu (`DEPLOYMENT_ENV=staging`) FakeGateway działa.
- [x] Given kod BLIK `777123`, `111111` albo `222222`, When tworzymy płatność, Then po opóźnieniu worker wysyła podpisany webhook HTTP, a płatność kończy się odpowiednio `SUCCEEDED` lub `FAILED` albo zostaje w `PENDING` (test end-to-end API + worker).
- [x] Given panel deweloperski i strona testowa płatności, Then działają na FakeGateway, a przy wyłączonym FakeGateway API odpowiada 404.

## Plan testów

- **Jednostkowe:**
  - konfiguracja: `DEPLOYMENT_ENV`, blokada `fake`, wymagany adres webhooka workera, wyprowadzenie sekretu;
  - podpis webhooka (poprawny, zmieniony bajt, zły sekret, stary i przyszły znacznik, zły format nagłówka);
  - mapowanie typów operatora na zdarzenia;
  - scenariusze kodów BLIK;
  - podział zwrotu na część sprzedawcy;
  - walidacja wejścia `createPayment`;
  - rejestr adapterów;
  - web: bezpieczny `returnUrl`.
- **Integracyjne (Postgres, Redis):**
  - testy kontraktowe FakeGateway;
  - `createPayment` z idempotencją i konfliktem;
  - webhook przez HTTP (`inject`): zły podpis 401, nieznany operator 404, 3 dostarczenia kolejno i równolegle;
  - zdarzenie bez obsługi (`IGNORED`), niezgodna kwota, płatność nieznana (500), opłata operatora;
  - polling (15 minut, zaginiony webhook, płatność bez ID operatora), zmiana KYC z eventem;
  - end-to-end z workerem i API nasłuchującym na porcie: magiczne kody BLIK;
  - trasy deweloperskie (404 przy wyłączonym FakeGateway, 401 bez sesji w panelu);
  - spójność wdrożenia (`deployment.test.ts`).
- **Web (Vitest, Testing Library):** strona testowa (zapłać, odrzuć, powrót tylko w obrębie Biddy, płatność rozliczona, 404) i panel (lista, ponowny webhook, rozliczenie bez webhooka).
- **E2E (Playwright):** brak nowych; pełny przepływ płatności z UI w F-25.

## Otwarte pytania

- **Rejestracja sprzedawcy w checkoutcie:** czy F-25 rejestruje sprzedawcę u operatora w momencie płatności, gdy nie zrobił tego F-32 (wystawienie)? Do F-32 tak, z kontaktem z modułu `identity`. **Rozstrzygnięte w F-25:** checkout rejestruje sprzedawcę przed pierwszą płatnością.
- **Płatność bez identyfikatora operatora:** oznaczamy ją `FAILED` po 15 minutach, ale operator mógł ją przyjąć. Wtedy jego późny webhook nie znajdzie płatności i trafi do dead-letter. Domknięcie przez uzgodnienia z raportami (F-33) albo szukanie po naszym kluczu, jeśli operator to umożliwia (do sprawdzenia przy F-31).
- **Model wstrzymania FakeGateway:** odwzorowuje `SELLER_BALANCE` (PayU). Jeśli wybierzemy Mangopay (`BUYER_WALLET`), dodamy wariant FakeGateway z portfelem kupującego, żeby testy domeny sprawdzały oba modele.
