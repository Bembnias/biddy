# F-22 · Ledger

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-03 (kwoty i POK: F-01, F-13)

## Kontekst i cel

Biddy nie trzyma pieniędzy kupujących: środki leżą u licencjonowanego operatora płatności ([PROJECT.md §7.1](../PROJECT.md#71-zasada-nadrzędna)). Biddy decyduje jednak, kiedy je zwolnić, komu zwrócić i ile wolno wypłacić. U operatorów z modelem `SELLER_BALANCE` (PayU) pieniądze trafiają na saldo sprzedawcy od razu przy płatności, więc jedyną blokadą przed przedwczesną wypłatą jest nasza księga ([§7.8](../PROJECT.md#78-moduł-płatności-adapter)).

F-22 dostarcza moduł `ledger`: wewnętrzną księgę podwójnego zapisu z planem kont i wzorcowymi księgowaniami z [§7.7](../PROJECT.md#77-księga-ledger). Każdy ruch pieniądza to transakcja z co najmniej dwoma wpisami, które sumują się do zera. Wpisów nie da się zmienić ani usunąć, a salda kont zawsze wynikają z wpisów. Na tym API stoją kolejne feature'y: płatności (F-23), cykl zamówienia i zwolnienie środków (F-26), saldo i wypłaty (F-27), spory i zwroty (F-28) oraz uzgodnienia z operatorem (F-33).

## Historyjki użytkownika

- Jako sprzedający chcę widzieć, ile pieniędzy mam do wypłaty, ile czeka na zakończenie zamówień i ile jestem winien Biddy (widok w F-27, dane z F-22).
- Jako Biddy chcemy mieć pewność, że nie wypłacimy sprzedającemu więcej, niż mu się należy, także przy równoległych żądaniach.
- Jako księgowość i support chcemy prześledzić każdy ruch pieniądza zamówienia, a pomyłkę poprawić nową transakcją, nie edycją historii.
- Jako zespół chcemy, żeby kod pozostałych modułów nie mógł zapisać księgowania, które się nie bilansuje albo zostawia ujemne saldo.

## Zakres

- **Moduł `ledger`** (§10.3) z publicznym API `LedgerService` (zaksięguj, odczytaj salda) i `LedgerIntegrity` (sprawdzenie spójności).
- **Plan kont z §7.7** (12 kont). Konta z parametrem (`provider_cash:{provider}`, `seller_receivable:{userId}`, `buyer_funds_held:{orderId}`, `seller_balance_available:{userId}`, `payouts_in_transit:{payoutId}`) powstają przy pierwszym księgowaniu. Konto ma walutę, więc każda waluta ma osobne konta.
- **Księgowanie przez szablony.** Inne moduły nie podają dowolnych wpisów, tylko zdarzenie biznesowe z kwotami (`LedgerPosting`), a ledger buduje z niego wpisy według §7.7. Wszystkie wzorcowe księgowania z §7.7 i trzy z §7.9, które domykają plan kont (tabela niżej).
- **Idempotencja:** każde księgowanie ma klucz (`idempotencyKey`, np. `order:{orderId}:completed`). Ponowienie z tym samym kluczem i tymi samymi danymi zwraca istniejącą transakcję bez nowych wpisów, a z innymi danymi kończy się błędem.
- **Korekty przez nowe wpisy:** storno całej transakcji (`reverse`) jako nowa transakcja `REVERSAL` z przeciwnymi wpisami. Transakcję można wycofać raz.
- **Salda:** dowolnego konta, salda sprzedającego (dostępne, w trakcie, należność, wypłaty w drodze) i środki wstrzymane na zamówieniu.
- **Gwarancje w bazie:**
  - transakcja sumuje się do zera i ma co najmniej dwa wpisy (odroczony trigger sprawdzany przy zatwierdzeniu),
  - wpisy, transakcje i konta są niemodyfikowalne (triggery na UPDATE, DELETE i TRUNCATE),
  - saldo konta (`ledger_accounts.balance`) zmienia wyłącznie trigger przy wstawieniu wpisu, więc zawsze równa się sumie wpisów,
  - salda kont użytkowników i zamówień nie mogą przejść na niewłaściwą stronę (CHECK).
- **Codzienny job** `ledger.verify-integrity` (kolejka `maintenance`, 4:30 czasu polskiego): przelicza salda z samych wpisów i porównuje z zapisanymi, sprawdza bilans transakcji; rozjazd to błąd w Sentry (alert „rozjazd ledgera ≠ 0” z §18.3).

## Poza zakresem

- Wywołania księgowań z przepływów: płatność (F-23, F-25), przejścia zamówienia (F-26), wypłaty (F-27), spory (F-28), chargebacki (F-31). F-22 daje im API i testy każdego szablonu.
- Endpointy i widoki sald oraz historii (F-27), widok ledgera i ręczne korekty z audit logiem w panelu admina (F-34).
- Uzgodnienia z raportami operatora (F-33) i eksport dla księgowości (format ustalimy z biurem księgowym).
- Blokada wypłat przy należności i 48 h po zmianie rachunku (reguły `PayoutService`, F-27). Ledger gwarantuje tylko, że wypłata nie przekroczy salda dostępnego.
- Spisanie należności po 180 dniach jako job (F-27 albo F-34). F-22 daje szablon księgowania.

## UX

Brak ekranów w F-22. Saldo sprzedającego i historia trafią do widoku „Saldo” w F-27, a ledger zamówienia do panelu admina w F-34.

## Model danych

Migracja `0015_ledger` (tabele z Drizzle, triggery i funkcje dopisane w SQL, jak w `0008_fee_schedules`). Kwoty w groszach (`bigint`), ze znakiem: `+` = Winien (debet), `−` = Ma (kredyt).

**`ledger_accounts`**: konto planu kont w jednej walucie.

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `code` | jedno z 12 kont §7.7 (CHECK) |
| `subject` | parametr konta: operator (`fake`, `payu`…), ID użytkownika, zamówienia albo wypłaty; null dla kont platformy (CHECK zależny od `code`) |
| `currency` | `char(3)` |
| `seller_id` | sprzedający, którego dotyczy konto: `seller_balance_available` i `seller_receivable` (= `subject`), `buyer_funds_held` (sprzedający zamówienia), `payouts_in_transit` (sprzedający wypłaty); null dla pozostałych (CHECK) |
| `seller_amount` | tylko `buyer_funds_held`: część wstrzymanych środków należna sprzedającemu (`items_total`), z niej liczymy saldo „w trakcie” (CHECK ≥ 0) |
| `balance` | saldo = suma wpisów konta; zmienia je tylko trigger `ledger_entries_apply`; nowe konto ma saldo 0 |
| `created_at` | |

- Unikalne `(code, subject, currency)` z `NULLS NOT DISTINCT` (jedno konto platformy na walutę).
- Indeks `(seller_id, code)` dla sald sprzedającego.
- CHECK nieujemności (strona normalna konta): `seller_balance_available`, `buyer_funds_held` i `payouts_in_transit` mają saldo ≤ 0 (zobowiązania, saldo po stronie Ma), a `seller_receivable` i `carrier_claims_receivable` ≥ 0 (należności). Pozostałe konta (operator, przychody, koszty, VAT, rozliczeniowe) mogą mieć dowolne saldo, bo korekty i storna mogą je chwilowo odwrócić.

**`ledger_transactions`**: jedno księgowanie (zdarzenie biznesowe).

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `type` | szablon księgowania (CHECK, lista niżej) |
| `idempotency_key` | unikalny klucz księgowania |
| `currency` | waluta wszystkich wpisów (trigger sprawdza walutę konta) |
| `order_id`, `payout_id` | zamówienie i wypłata, których dotyczy księgowanie (uuid bez FK między modułami; indeksy) |
| `reverses_transaction_id` | dla `REVERSAL`: wycofana transakcja (FK, unikalny: storno najwyżej raz) |
| `payload` | dane wejściowe szablonu (JSONB): kwoty, identyfikatory, powód; do audytu, eksportu i porównania przy ponowieniu |
| `created_at` | |

**`ledger_entries`**: wpis na koncie.

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 (sortuje się chronologicznie: historia konta) |
| `transaction_id` | FK do `ledger_transactions` |
| `account_id` | FK do `ledger_accounts` |
| `amount` | kwota ze znakiem, ≠ 0 (CHECK) |

- Indeksy `(account_id, id)` (historia konta) i `(transaction_id)`.

**Triggery i funkcje** (migracja SQL):

- `ledger_entries_apply` (AFTER INSERT na wpisie): dodaje kwotę do `ledger_accounts.balance` i sprawdza, że waluta konta = waluta transakcji.
- `ledger_entries_balanced` i `ledger_transactions_balanced` (CONSTRAINT TRIGGER, `DEFERRABLE INITIALLY DEFERRED`): przy zatwierdzeniu transakcji bazy każda dotknięta transakcja księgowa ma ≥ 2 wpisy i sumę 0. Odroczenie pozwala wstawić transakcję i wpisy osobnymi poleceniami.
- `ledger_immutable`: UPDATE, DELETE i TRUNCATE na `ledger_entries` i `ledger_transactions`, DELETE i TRUNCATE na `ledger_accounts` kończą się błędem `restrict_violation`.
- `ledger_accounts_guard`: nowe konto musi mieć saldo 0; UPDATE konta jest dozwolony tylko z triggera wpisów (`pg_trigger_depth() ≥ 2`) i tylko dla `balance`.

Migracja jest addytywna (nowe tabele), więc wstecznie kompatybilna.

## API i zdarzenia

Brak endpointów HTTP i zmian w OpenAPI. Publiczne API modułu (`src/modules/ledger/index.ts`):

- `LedgerService.post(tx, posting)`: księguje w transakcji wywołującego (zmiana stanu zamówienia, wpisy i event w outboxie to jedna transakcja, §7.3). Zwraca transakcję z wpisami i `replayed` (true przy ponowieniu z tym samym kluczem).
- `LedgerService.reverse(tx, { transactionId, idempotencyKey, reason })`: storno.
- `LedgerService.balance(account, tx?)`: saldo konta po stronie normalnej (np. saldo dostępne 70 zł to `+70 zł`, choć wpisy są po stronie Ma).
- `LedgerService.sellerBalances(sellerId, currency?, tx?)`: `{ available, pending, receivable, payoutsInTransit }`.
- `LedgerService.heldForOrder(orderId, currency?, tx?)`: środki wstrzymane na zamówieniu (F-26 sprawdza, że po stanie końcowym wynoszą 0).
- `LedgerIntegrity.verify()`: raport spójności (niezbilansowane transakcje, rozjazdy sald).
- Błędy: `LedgerError` z kodem `INVALID_POSTING` (błędne kwoty lub waluty), `INSUFFICIENT_FUNDS` (księgowanie zostawiłoby saldo po złej stronie, np. wypłata ponad saldo dostępne albo zwrot ponad środki wstrzymane), `IDEMPOTENCY_CONFLICT`, `ACCOUNT_MISMATCH` (konto istnieje z innym sprzedającym), `TRANSACTION_NOT_FOUND`, `ALREADY_REVERSED`. Błąd przerywa transakcję wywołującego; moduł z API HTTP mapuje go na swój kod (np. F-27).

**Szablony księgowań** (D = debet, C = kredyt; cena = `items_total`; „uznanie sprzedającego” = najpierw spłata `seller_receivable`, reszta na `seller_balance_available`; „obciążenie sprzedającego” = najpierw z `seller_balance_available` do wysokości salda, reszta na `seller_receivable`):

| `type` | Zdarzenie (§7.7, §7.9) | Wpisy |
|---|---|---|
| `PAYMENT_RECEIVED` | Płatność udana | D `provider_cash` total · C `buyer_funds_held` total |
| `ORDER_COMPLETED` | Zakończenie | D `buyer_funds_held` total · uznanie sprzedającego cena · C `platform_revenue_pok` POK netto · C `vat_payable` VAT · C `platform_shipping` dostawa |
| `ORDER_REFUNDED` | Pełny zwrot (brak nadania, zaginięcie, spór, spóźniona płatność, przegrany chargeback przed zakończeniem) | D `buyer_funds_held` kwota · C `provider_cash` kwota |
| `NOT_PICKED_UP_REFUNDED` | Zwrot nieodebranej | D `buyer_funds_held` total · C `provider_cash` total − dostawa · C `platform_shipping` dostawa |
| `ORDER_PARTIALLY_REFUNDED` | Zwrot częściowy | D `buyer_funds_held` total · C `provider_cash` zwrot · uznanie sprzedającego cena − zwrot · C POK netto · C VAT · C dostawa |
| `PAYOUT_REQUESTED` | Zlecenie wypłaty | D `seller_balance_available` · C `payouts_in_transit` |
| `PAYOUT_COMPLETED` | Wypłata zrealizowana | D `payouts_in_transit` · C `provider_cash` |
| `PAYOUT_FAILED` | Wypłata nieudana | D `payouts_in_transit` · uznanie sprzedającego |
| `PAYMENT_FEE_CHARGED` | Opłata operatora | D `payment_fees_expense` · C `provider_cash` |
| `DISPUTE_COSTS_CHARGED` | Koszty sporu po stronie sprzedającego | obciążenie sprzedającego · C `platform_shipping` |
| `CHARGEBACK_ABSORBED` | Chargeback po zakończeniu, ponosi Biddy | D `platform_losses` · C `provider_cash` |
| `CHARGEBACK_CHARGED_TO_SELLER` | Chargeback po zakończeniu, oszustwo sprzedającego (§7.9) | obciążenie sprzedającego · C `provider_cash` |
| `PARCEL_COMPENSATION_PAID` | Rekompensata za zaginioną lub uszkodzoną paczkę | D `carrier_claims_receivable` · uznanie sprzedającego albo C `platform_external` (przelew z rachunku firmowego) |
| `CARRIER_CLAIM_SETTLED` | Rozliczenie reklamacji u przewoźnika (§7.9) | D `platform_external` odzyskane · D `platform_losses` nieodzyskane · C `carrier_claims_receivable` |
| `RECEIVABLE_WRITTEN_OFF` | Spisanie należności po 180 dniach (§7.9) | D `platform_losses` · C `seller_receivable` |
| `REVERSAL` | Storno (korekta) | wpisy wycofanej transakcji z przeciwnym znakiem |

Przykład (§7.4): przedmiot 100 zł, POK 9,99 zł (8,12 zł netto + 1,87 zł VAT), dostawa 12,99 zł, razem 122,98 zł.

| Konto | `PAYMENT_RECEIVED` | `ORDER_COMPLETED` |
|---|---:|---:|
| `provider_cash:fake` | +122,98 | |
| `buyer_funds_held:{orderId}` | −122,98 | +122,98 |
| `seller_balance_available:{sellerId}` | | −100,00 |
| `platform_revenue_pok` | | −8,12 |
| `vat_payable` | | −1,87 |
| `platform_shipping` | | −12,99 |

**Eventy domenowe:** brak. Księgowanie jest częścią transakcji zdarzenia, które je wywołało (zamówienie, wypłata, spór), a eventy emituje tamten moduł.

## Reguły biznesowe i przypadki brzegowe

- Kwoty w groszach, nigdy float. Wszystkie kwoty księgowania w jednej walucie (`INVALID_POSTING`). Wpisy z kwotą 0 pomijamy (np. zamówienie bez dostawy, spłata należności 0), ale księgowanie bez żadnej niezerowej kwoty jest błędem.
- Kwoty wejściowe są nieujemne, a kwoty, które muszą coś przenieść (płatność, zwrot, wypłata, opłata, koszty, rekompensata, spisanie), są dodatnie. `pokVat ≤ pokFee`. Zwrot częściowy: 0 < zwrot ≤ cena (§7.5). Rozliczenie reklamacji: odzyskane + nieodzyskane > 0. `PAYMENT_RECEIVED`: część sprzedającego ≤ kwota płatności.
- **Saldo dostępne nigdy nie jest ujemne.** Obciążenie sprzedającego bierze z salda dostępnego najwyżej tyle, ile na nim jest, a niedobór trafia na `seller_receivable`. Wypłata ponad saldo dostępne: `INSUFFICIENT_FUNDS`. CHECK w bazie jest ostatnią linią obrony.
- **Uznanie salda sprzedającego zawsze najpierw spłaca należność** (zakończenie, reszta po zwrocie częściowym, nieudana wypłata, rekompensata). §7.7 mówi o tym przy zakończeniu, a F-22 stosuje to samo przy każdym uznaniu. Dzięki temu saldo dostępne i należność nigdy nie są jednocześnie dodatnie, a należność blokuje wypłaty bez osobnej reguły.
- **Saldo „w trakcie”** to nie osobne konto (§7.7): suma `seller_amount` kont `buyer_funds_held` sprzedającego, których saldo ≠ 0. Po stanie końcowym zamówienia saldo konta wynosi 0, więc zamówienie wypada z „w trakcie”. Druga płatność za to samo zamówienie (np. podwójna) nie podwaja „w trakcie”.
- **Konto `buyer_funds_held` zapamiętuje sprzedającego i jego część przy pierwszej płatności.** Księgowanie, które podaje dla tego konta innego sprzedającego albo inną część, kończy się `ACCOUNT_MISMATCH` (tak samo `payouts_in_transit` i sprzedający wypłaty).
- **Idempotencja:** klucz jest unikalny w bazie. Równoległe księgowania z tym samym kluczem czekają na siebie (indeks unikalny), a drugie zwraca wynik pierwszego. Porównujemy typ i dane wejściowe (`payload`), nie wyliczone wpisy: ponowienie zakończenia po zmianie należności nie przelicza podziału.
- **Współbieżność:** przed wyliczeniem wpisów ledger blokuje (`SELECT … FOR UPDATE`) wszystkie konta księgowania w stałej kolejności (`code`, `subject` w collation „C”), więc dwa księgowania tych samych kont nie zakleszczą się, a podział między saldo dostępne i należność liczymy na zablokowanych saldach. Kilka księgowań w jednej transakcji wywołującego może się zakleszczyć z innymi; Postgres przerywa wtedy jedną z nich, a job lub żądanie ponawia całość.
- **Gorące konta:** konta platformy (`provider_cash`, przychody, VAT) są blokowane przez prawie każde księgowanie do końca transakcji wywołującego. Przy skali MVP (rzędu ułamka księgowania na sekundę) to nie problem; przy dużym ruchu można przestać trzymać saldo kont bez ograniczeń w wierszu i liczyć je z wpisów.
- **Storno** odwraca wszystkie wpisy transakcji na tych samych kontach i podlega tym samym ograniczeniom (np. nie wycofamy zakończenia, jeśli sprzedający już wypłacił środki: `INSUFFICIENT_FUNDS`; wtedy korekta to inny szablon). Nie stosuje spłaty należności. Storna nie da się wycofać (`INVALID_POSTING`), a transakcję można wycofać raz (`ALREADY_REVERSED`).
- **Salda da się odtworzyć z samych wpisów:** `balance` to tylko pamięć podręczna sumy wpisów utrzymywana przez trigger. `LedgerIntegrity.verify()` liczy salda od nowa w jednym spójnym odczycie (`REPEATABLE READ`).

## Bezpieczeństwo i prywatność

- Brak endpointów: ledger jest dostępny tylko przez publiczne API modułu (reguła granic modułów). Ręczne korekty dojdą w F-34 z RBAC i audit logiem.
- Niemodyfikowalność wymuszana w bazie, więc błąd w kodzie ani ręczne zapytanie aplikacji nie zmieni historii ani sald. Ominąć to może tylko superużytkownik bazy (wyłączenie triggerów), co wykryje job spójności.
- Ledger przechowuje identyfikatory użytkowników, zamówień i wypłat oraz kwoty; bez danych kontaktowych i danych płatniczych. Dane finansowe nie podlegają usunięciu na żądanie (obowiązek przechowywania, §17); usunięcie konta to anonimizacja danych w `identity` (F-41), a ledger nie ma czego anonimizować.

## Analityka

Brak (zdarzenia biznesowe płatności i wypłat w F-25 i F-27).

## Kryteria akceptacji

- [x] Given transakcja księgowa, której wpisy nie sumują się do zera albo ma mniej niż dwa wpisy, When transakcja bazy jest zatwierdzana, Then baza ją odrzuca; każde księgowanie z szablonu sumuje się do zera (test każdego szablonu i test property-based).
- [x] Given każde wzorcowe księgowanie z §7.7 (i trzy z §7.9), Then test sprawdza jego wpisy na przykładzie z kwotami.
- [x] Given saldo dostępne sprzedającego mniejsze niż koszty sporu, When je księgujemy, Then saldo dostępne spada do 0, a niedobór trafia na `seller_receivable`; kolejne zakończenie najpierw spłaca należność. Wypłata ponad saldo dostępne kończy się `INSUFFICIENT_FUNDS`, także przy 10 równoległych żądaniach.
- [x] Given dowolny wpis, transakcja albo konto, When aplikacja próbuje go zmienić (UPDATE), usunąć (DELETE, TRUNCATE) albo zmienić saldo konta bez wpisu, Then baza odrzuca polecenie.
- [x] Given dowolna sekwencja księgowań, Then salda policzone od nowa z samych wpisów są równe zapisanym saldom i saldom modelu w pamięci (te same szablony, bez bazy), a `LedgerIntegrity.verify()` nie zgłasza rozjazdów (test property-based na Postgresie).
- [x] Given ponowienie księgowania z tym samym kluczem, Then nie powstają nowe wpisy; z innymi danymi: `IDEMPOTENCY_CONFLICT`.
- [x] Given otwarte zamówienia sprzedającego z wstrzymanymi środkami, Then saldo „w trakcie” to suma ich cen, a po zakończeniu lub zwrocie zamówienie z niego wypada.

## Plan testów

- **Jednostkowe (domena, bez bazy):** każdy szablon na przykładzie z §7.4 (wpisy, sumy, pomijanie zer), walidacja kwot i walut, uznanie i obciążenie sprzedającego na granicach (saldo równe kosztom, należność większa od ceny), storno. **Property-based (fast-check)** na modelu w pamięci: losowe sekwencje zdarzeń kilku zamówień i sprzedających; każda transakcja sumuje się do zera, saldo dostępne i należność ≥ 0 i nigdy jednocześnie > 0, środki wstrzymane zamówienia w stanie końcowym = 0, suma wszystkich sald = 0.
- **Integracyjne (Postgres w Testcontainers):** każdy szablon przez `LedgerService.post` (wpisy i salda w bazie), idempotencja (ponowienie, konflikt, równoległe ponowienie), `ACCOUNT_MISMATCH`, `INSUFFICIENT_FUNDS` i wycofanie transakcji wywołującego, 10 równoległych wypłat ponad saldo, storno (jednokrotne, z ograniczeniami), salda sprzedającego, triggery (niezbilansowana transakcja, transakcja bez wpisów, UPDATE/DELETE/TRUNCATE wpisów, transakcji i kont, ręczna zmiana salda, konto z saldem początkowym, niezgodna waluta, CHECK nieujemności), `verify()` (czysto i z celowym rozjazdem po wyłączeniu triggera), property-based: ta sama losowa sekwencja w bazie i w modelu w pamięci daje te same salda.
- **E2E:** brak (brak UI; przepływy pieniędzy end-to-end w F-25 i F-26).

## Otwarte pytania

- VAT od dostawy: §7.7 księguje dostawę brutto na `platform_shipping`. **Domyślnie** tak zostaje; rozbicie na netto i VAT po opinii księgowego (§17.1), jako nowe konto lub szablon bez zmiany istniejących wpisów.
- Data księgowa a data zdarzenia (np. płatność o 23:59, webhook po północy): **domyślnie** liczy się `created_at` transakcji; kolumnę z datą zdarzenia dodamy przy eksporcie dla księgowości (F-33), jeśli okaże się potrzebna.
- Opłaty operatora per płatność czy zbiorczo z raportu: **domyślnie** szablon przyjmuje dowolną kwotę z opcjonalnym zamówieniem; decyzja przy adapterze operatora (F-31) i uzgodnieniach (F-33).
