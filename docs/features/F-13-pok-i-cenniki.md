# F-13 · Kalkulator POK i cenniki

**Status:** Review
**Rozmiar:** S · **Właściciel:** Mateusz Bienias · **Zależności:** F-01, F-03

## Kontekst i cel

Kupujący płaci za zamówienie wylicytowaną kwotę, Pakiet Ochrony Kupujących (POK) i dostawę ([PROJECT.md §3.1](../PROJECT.md#31-pakiet-ochrony-kupujących-pok)). Kwotę POK widać przy każdym przycisku licytacji („Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł”), liczy ją backend przy tworzeniu zamówienia (F-24) i księguje ledger (F-22). Jeśli front i backend liczą inaczej, kupujący widzi jedną kwotę, a płaci inną: to problem konsumencki (UOKiK) i problem zaufania. Podobnie z krokami przebicia ([§6.3](../PROJECT.md#63-kroki-przebicia)): formularz oferty (F-16) i silnik licytacji (F-15) muszą znać tę samą minimalną kolejną ofertę.

F-13 dostarcza jedną implementację obu reguł w `@biddy/shared` oraz wersjonowany cennik POK w bazie, który można zmienić bez deployu, a zamówienie zawsze da się przeliczyć według cennika, z którym powstało.

## Historyjki użytkownika

- Jako kupujący chcę przed złożeniem oferty wiedzieć, ile zapłacę razem z opłatami.
- Jako kupujący chcę wiedzieć, ile minimalnie muszę zaoferować.
- Jako zespół chcemy zmienić stawki POK (np. po becie) bez wdrażania kodu, nie zmieniając kwot już utworzonych zamówień.
- Jako księgowość chcemy mieć POK rozbity na netto i VAT, zawsze co do grosza.

## Zakres

- **Kalkulator POK** (`@biddy/shared`, `pricing`): `calculatePok(kwota, cennik)` → POK brutto, netto i VAT, kwota z POK oraz części składowe (opłata stała, część zmienna).
  - POK = opłata stała + Σ (stawka progu × część kwoty w progu). Progi są **krańcowe** (jak progi podatkowe).
  - **Jedno zaokrąglenie na końcu:** sumę iloczynów (grosze × punkty bazowe) liczymy dokładnie na `bigint` i dzielimy raz, half-up do grosza (`divideRoundHalfUp` z F-03). Zaokrąglanie każdego progu osobno mogłoby dać kwotę różną o grosz od wzoru z §3.1, a pojedyncze zaokrąglenie monotonicznej sumy zachowuje monotoniczność.
  - VAT: `splitGross(POK, stawka)` (netto half-up, VAT = brutto − netto), więc netto + VAT = brutto co do grosza.
  - Kwota ujemna albo w innej walucie niż cennik: błąd (`MoneyError`).
- **Cennik** (`FeeSchedule`): waluta, opłata stała (grosze), progi `[{ upTo, bp }]` (górna granica progu w groszach, `null` = bez limitu; stawka w punktach bazowych, 700 = 7%) i stawka VAT (`vatRateBp`, 2300 = 23%). Schemat Zod `feeScheduleSchema` (w `@biddy/shared`) sprawdza: co najmniej jeden próg, rosnące granice, `null` tylko w ostatnim progu, stawki 0–10 000 bp, opłata stała ≥ 0. VAT jest częścią cennika, więc zmiana stawki VAT to nowy cennik, a stare zamówienia zostają przy swojej.
- **Kroki przebicia** (`@biddy/shared`): tabela z §6.3, `bidIncrement(cena)` i `minimumNextBid({ startPrice, currentPrice })` (bez ofert: cena wywoławcza; z ofertami: cena + krok). Tabela jest w kodzie, nie w bazie: silnik licytacji (F-15) przelicza historię ofert od nowa (§15.6) i musi dostać ten sam wynik.
- **Tabela `fee_schedules`** (moduł `payments`, §7.8): wersje cennika z okresem obowiązywania `[valid_from, valid_to)`. W danej walucie w każdej chwili obowiązuje dokładnie jeden cennik (ograniczenie wykluczające w Postgresie). Wiersz jest **niezmienny**: wolno tylko zamknąć otwarty cennik (ustawić `valid_to`), a usuwanie jest zablokowane (trigger). Startowy cennik z §3.1 to migracja danych, więc jest w każdym środowisku.
- **Publiczne API modułu `payments`** (`FeeScheduleService`) dla zamówień (F-24) i panelu admina (F-34):
  - `current(currency, at)`: cennik obowiązujący w danej chwili;
  - `quote(kwota)`: POK według bieżącego cennika razem z `feeScheduleId` do zapisania w zamówieniu;
  - `recalculate(kwota, feeScheduleId)`: POK według cennika zamówienia (np. przy anulowaniu części zamówienia);
  - `publish(cennik, validFrom)`: nowy cennik od wskazanej chwili (nie wcześniej niż teraz); poprzedni otwarty cennik dostaje `valid_to = validFrom`.
- **Zmiana stawek bez deployu** do czasu panelu admina (F-34): skrypt `fees:publish` (`--file cennik.json --from <data>`). Bez `--confirm` pokazuje porównanie POK dla przykładowych kwot, z `--confirm` publikuje przez `FeeScheduleService.publish`. Na stagingu i produkcji: `node dist/fees-publish.js` w powłoce usługi API.
- **Endpoint** `GET /v1/fee-schedules/current` (publiczny, cache 60 s): bieżący cennik dla klientów (web, mobile), którzy liczą POK tym samym kodem z `@biddy/shared`.
- **Web:** komponent `TotalPrice` (cena łączna) w trzech wariantach:
  - oferta: „Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł”;
  - maksimum (licytacja automatyczna): „Licytujesz do 500 zł · zapłacisz najwyżej 537,99 zł + dostawa od 12,99 zł”;
  - Kup teraz: „Kupujesz za 300 zł · zapłacisz 323,99 zł + dostawa od 12,99 zł”.
  Pod spodem rozwijane „Skąd ta kwota?”: kwota, POK z opisem progów („2,99 zł + 7% kwoty do 1000 zł + 4% nadwyżki”) i dostawa. Bez ceny dostawy komponent pomija „+ dostawa od”. Komponent sam pobiera cennik (`GET /v1/fee-schedules/current`, ważny 60 s), a strona renderowana na serwerze (F-18) może podać go od razu (`initialFeeSchedule`). Panel licytacji (F-16) użyje go przy przycisku oferty.

## Poza zakresem

- Cenniki per kategoria (§3.1: „docelowo”): kolumna `category_id` dojdzie razem z regułą wyboru cennika dla zamówienia z przedmiotami z wielu kategorii.
- Cennik dostaw Biddy (feature dostaw) i wybór dostawy; tu tylko kwota „dostawa od” podana z zewnątrz.
- Tabela `orders` i zapis `fee_schedule_id` w zamówieniu (F-24); F-13 daje `quote`/`recalculate`, które to umożliwiają.
- Edycja cenników w panelu admina (F-34), minimalny POK (dźwignia z §3.2, decyzja po becie), reguła Kup teraz ≥ 130% ceny wywoławczej (kreator, F-14).

## UX

**Cena łączna (`TotalPrice`):**

```
Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł
▸ Skąd ta kwota?
    Kwota oferty                      100,00 zł
    Pakiet Ochrony Kupujących           9,99 zł
      2,99 zł + 7% kwoty do 1000 zł + 4% nadwyżki
    Razem bez dostawy                 109,99 zł
    Dostawa                    od 12,99 zł (wybierasz po wygranej)
```

| Stan | Zachowanie |
|---|---|
| Cennik się ładuje | „Licytujesz 100 zł · zapłacisz …” ze szkieletem w miejscu kwoty |
| Brak cennika (błąd API) | „Licytujesz 100 zł + Pakiet Ochrony Kupujących + dostawa od 12,99 zł” (bez wymyślonej kwoty łącznej) |
| Brak ceny dostawy | bez „+ dostawa od” |
| Zmiana kwoty w formularzu | kwota łączna przelicza się od razu (bez zapytań do API) |

Przy przycisku licytacji (F-16) komponent może działać bez rozwijanej części (`withDetails={false}`).

## Model danych

Migracje `0008_fee_schedules` (tabela, rozszerzenie `btree_gist`, ograniczenia, trigger) i `0009_initial_fee_schedule` (dane):

- `fee_schedules`: `id`, `currency` (`char(3)`), `fixed_fee` (`bigint`, grosze), `tiers` (JSONB: `[{"upTo":100000,"bp":700},{"upTo":null,"bp":400}]`), `vat_rate_bp`, `valid_from`, `valid_to` (null = bez końca), `note`, `created_at`.
  - Ograniczenia: `fixed_fee ≥ 0`, `vat_rate_bp` 0–10 000, `valid_to > valid_from`, `tiers` to niepusta tablica (pełna walidacja: Zod przy zapisie i odczycie), wykluczenie nakładających się okresów w tej samej walucie (`EXCLUDE USING gist (currency WITH =, tstzrange(valid_from, valid_to) WITH &&)`).
  - Trigger: UPDATE może tylko ustawić `valid_to` w otwartym cenniku; DELETE jest zabroniony.
- Startowy cennik (§3.1): PLN, 2,99 zł, 7% do 1000 zł, 4% powyżej, VAT 23%, od `2026-01-01`.

## API i zdarzenia

- `GET /v1/fee-schedules/current?currency=PLN` → `FeeScheduleDto`: `id`, `currency`, `fixedFee` (grosze), `tiers` (`upTo` w groszach albo null, `bp`), `vatRateBp`, `validFrom`, `validTo` (albo null). `cache-control: public, max-age=60`. Nieobsługiwana waluta: 400 `VALIDATION_FAILED`; waluta bez cennika: 404 `NOT_FOUND`.
- Publiczne API modułu `payments`: `FeeScheduleService` (`current`, `quote`, `recalculate`, `publish`). `publish` z błędnym cennikiem albo datą w przeszłości: 400 `VALIDATION_FAILED`.
- Eventy domenowe: brak (zmiana cennika nie wymaga reakcji innych modułów; klienci odświeżają cennik po 60 s).

## Reguły biznesowe i przypadki brzegowe

- Kwoty w groszach (`bigint` w bazie, `Money` w kodzie), nigdy float. Zaokrąglenie half-up do grosza, raz.
- POK liczony od sumy wylicytowanych kwot zamówienia; opłata stała raz na zamówienie.
- Granica progu należy do niższego progu: przy 1000,00 zł cała kwota jest w progu 7%, 4% dotyczy dopiero groszy powyżej.
- Krok przebicia zależy od aktualnej ceny; granice należą do wyższego przedziału (20,00 zł → krok 1 zł, 19,99 zł → 0,50 zł).
- Cennik obowiązujący w chwili `t` to ten, dla którego `valid_from ≤ t < valid_to`. Nowy cennik zaczyna się dokładnie w chwili zamknięcia poprzedniego, więc nie ma przerwy ani nakładania.
- Zamówienie zapisuje `fee_schedule_id`; przeliczenie zamówienia zawsze używa tego cennika, nawet po zmianie stawek.

## Bezpieczeństwo i prywatność

- Klient tylko wyświetla kwotę łączną; kwotę do zapłaty zawsze liczy backend (F-24), więc zmanipulowany cennik w przeglądarce niczego nie zmienia.
- Cennik jest niezmienny w bazie (trigger), więc nawet błąd w kodzie nie zmieni kwot istniejących zamówień.
- Brak danych osobowych.

## Analityka

Brak w F-13 (zdarzenia licytacji w F-16).

## Kryteria akceptacji

- [x] Given cennik startowy, Then POK zgadza się z przykładami z §3.1 i §3.2: 20 zł → 4,39 zł, 100 zł → 9,99 zł, 1000 zł → 72,99 zł, 3000 zł → 152,99 zł, 10 000 zł → 432,99 zł, a netto i VAT z tabeli §3.2 (np. 9,99 zł = 8,12 zł + 1,87 zł).
- [x] Given dowolny poprawny cennik i dowolne kwoty a ≤ b, Then POK(a) ≤ POK(b), a 1 grosz więcej kwoty zmienia POK najwyżej o 1 grosz, także na granicach progów (test property-based).
- [x] Given kwota, przy której część zmienna ma pół grosza, Then wynik jest zaokrąglony w górę (half-up), np. 7% z 0,50 zł = 0,035 zł → 0,04 zł.
- [x] Given nowy cennik opublikowany po utworzeniu zamówienia, Then przeliczenie według `fee_schedule_id` zamówienia daje poprzednią kwotę, a stary cennik w bazie nie da się zmienić ani usunąć.
- [x] Given tabela kroków przebicia z §6.3, Then minimalna kolejna oferta zgadza się na granicach przedziałów (19,99 zł → 20,49 zł, 20,00 zł → 21,00 zł, 5000 zł → 5050 zł).

## Plan testów

- **Shared, jednostkowe:** przykłady z §3.1 i §3.2, half-up, granice progów, walidacja cennika (`feeScheduleSchema`), kroki przebicia na granicach; **property-based (fast-check):** monotoniczność, przyrost najwyżej o grosz, zgodność z wzorem na liczbach wymiernych, netto + VAT = brutto, minimalna kolejna oferta > aktualnej ceny.
- **API, integracyjne (Postgres w Testcontainers):** cennik startowy z migracji, `GET /v1/fee-schedules/current` (dane, cache, nieobsługiwana waluta), `publish` (zamknięcie poprzedniego, granica okresów, data w przeszłości), `recalculate` po zmianie cennika, niezmienność wiersza (UPDATE i DELETE odrzucone), wykluczenie nakładających się okresów, skrypt `fees:publish` jako osobny proces (podgląd, publikacja, błędy).
- **Web, jednostkowe:** `TotalPrice` (trzy warianty, bez dostawy, ładowanie, brak cennika, opis progów, cennik z serwera bez zapytania, przeliczenie przy zmianie kwoty).
- **Web, e2e:** brak w F-13 (komponent nie ma jeszcze strony); pokryje go e2e panelu licytacji (F-16).

## Otwarte pytania

- Stawki POK: **domyślnie** §3.1 (decyzja nr 2 w §22), weryfikacja w becie.
- Cenniki per kategoria i wybór cennika dla zamówienia z wielu kategorii: **domyślnie** jeden cennik globalny do czasu decyzji po becie.
