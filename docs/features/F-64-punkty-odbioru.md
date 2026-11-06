# F-64 · Punkty odbioru: mapa i zapisane punkty

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-10 (adresy), F-24 (dostawy i adapter Furgonetki), F-25 (checkout)

## Kontekst i cel

Checkout (F-25) wybiera paczkomat albo punkt odbioru przez wyszukiwarkę: miasto, adres albo kod punktu i lista do 10 wyników. Mapę odłożyliśmy (decyzja nr 109, tymczasowa, i otwarte pytanie w [F-25](F-25-checkout.md)). Kupujący zwykle odbiera paczki w jednym albo dwóch stałych punktach, a dziś szuka ich przy każdym zamówieniu od nowa.

F-64 dodaje:

- **mapę punktów Furgonetki** w checkoutcie i w koncie: widżet `https://furgonetka.pl/js/dist/map/map.js` ([dokumentacja](https://furgonetka.pl/api/mapa)), który oddaje kod wybranego punktu;
- **zapisane punkty odbioru** przy adresach w koncie, z punktem domyślnym dla każdej usługi, podpowiadane w checkoutcie;
- **osobnego dostawcę punktów** w konfiguracji, żeby staging pokazywał prawdziwą mapę z sandboksa Furgonetki, a przesyłki dalej przechodziły szybki cykl FakeShipping.

Mapa Furgonetki oddaje tylko kod, nazwę i typ punktu, bez adresu i godzin. Adres, godziny i sprawdzenie, czy punkt działa, bierzemy z naszego API (`findPoints` z `pointId`). To wywołanie przechodzi na sandboksie Furgonetki od 2026-11-06 ([F-24, „Postęp i odstępstwa”](F-24-dostawy.md#postęp-i-odstępstwa-2026-11-06)). Kontekst: [PROJECT.md §8.1](../PROJECT.md#81-opcje-dostawy), [§8.3](../PROJECT.md#83-przepływ).

## Historyjki użytkownika

- Jako kupujący wybieram paczkomat na mapie, żeby od razu widzieć, który jest najbliżej domu albo pracy.
- Jako kupujący zapisuję swoje punkty odbioru w koncie, a checkout sam wybiera mój domyślny punkt dla danej usługi.
- Jako kupujący, który nie korzysta z mapy (klawiatura, czytnik ekranu, zablokowany skrypt), wybieram punkt z listy wyników wyszukiwania.
- Jako zespół sprawdzamy mapę na stagingu na sandboksie Furgonetki, a zamówienie dalej przechodzi cały cykl dostawy FakeShipping w kilka minut.

## Zakres

### Mapa punktów (web)

- **Komponent `PickupPointMap`:** przycisk „Wybierz na mapie” przy usługach z punktami (paczkomat i punkt odbioru).
  - Skrypt mapy ładujemy dopiero po pierwszym kliknięciu, raz na stronę, i czekamy na niego najwyżej 10 s.
  - Mapa otwiera się w oknie Furgonetki (`new Furgonetka.Map({...}).show()`).
- **Opcje mapy:**
  - `apiKey`: `NEXT_PUBLIC_FURGONETKA_MAP_KEY`;
  - `env`: z API (`sandbox` albo `production`);
  - `courierServices` i `courierServicesFilter`: tylko usługa Furgonetki wybranej usługi Biddy (`provider_codes.furgonetka`, np. `inpost`), a `showServiceTypeFilter: false`;
  - `availableServiceTypes`: paczkomat (`LOCKER`) tylko `parcel_machine`, punkt odbioru (`PICKUP_POINT`) oba typy (otwarte pytania);
  - `city` i `postcode` z domyślnego adresu dostawy (bez ulicy), `pointId` aktualnie wybranego punktu, `locale: 'pl'`.
- **Wybór punktu (`callback`):**
  - `point.type` musi być usługą Furgonetki wybranej usługi Biddy, inaczej odrzucamy wybór;
  - nazwę, adres i godziny bierzemy z `GET /v1/shipping/points/{code}`;
  - punkt trafia do formularza jak punkt z listy.
- **Zamknięcie mapy** (`closeModalCallback`): fokus wraca na przycisk „Wybierz na mapie”.
- **Wyszukiwarka i lista z F-25 zostają** jako „Szukaj po adresie”:
  - to droga dla klawiatury i czytnika ekranu;
  - działa też przy braku klucza mapy, FakeShipping jako dostawcy punktów i błędzie wczytania mapy.
- **Kiedy pokazujemy mapę:** tylko gdy API podaje `pointMap` dla usługi, a web ma klucz mapy. Inaczej wyszukiwarka jest od razu rozwinięta, jak dziś.

### Dostawca punktów (API)

- **`SHIPPING_POINTS_PROVIDER`** (domyślnie równy `SHIPPING_DEFAULT_PROVIDER`): dostawca wyszukiwarki, punktu po kodzie, sprawdzenia punktu w `ShipmentService.prepare` i zapisu punktu w koncie. Przesyłki dalej tworzy `SHIPPING_DEFAULT_PROVIDER`.
- **Konfiguracja stagingu:** `SHIPPING_DEFAULT_PROVIDER=fake` i `SHIPPING_POINTS_PROVIDER=furgonetka` z kompletem `FURGONETKA_*` dla sandboksa. FakeShipping przyjmuje dowolny kod punktu, a scenariusz zmienia się w panelu deweloperskim.
- **`pointMap`** w `CarrierDto` (`GET /v1/shipping/carriers`) i w opcjach dostawy checkoutu:
  - `{ provider: 'furgonetka', service, env }`, gdzie `service` to kod usługi u Furgonetki, a `env` wynika z `FURGONETKA_API_URL`;
  - `null` dla kuriera i dla dostawcy punktów bez mapy (FakeShipping).
- **`GET /v1/shipping/points/{pointId}?carrier=`:** punkt po kodzie u dostawcy punktów. Służy do podglądu punktu z mapy i do zapisu punktu.

### Moje punkty odbioru

- **Tabela `saved_pickup_points`** w module `shipping` i API `/v1/me/pickup-points`:
  - limit 10 punktów na konto;
  - jeden punkt domyślny na usługę.
- **Konto:**
  - `/konto/adresy` ma drugą sekcję, „Punkty odbioru”;
  - nowy punkt dodaje się na stronie `/konto/adresy/punkty/nowy`.
- **Checkout:**
  - zapisane punkty wybranej usługi są kartami wyboru nad mapą i wyszukiwarką;
  - domyślny punkt jest wybrany automatycznie, gdy zamówienie nie ma jeszcze dostawy;
  - przy punkcie spoza zapisanych jest pole „Zapisz w moich punktach odbioru”.

## Poza zakresem

- Mapa w aplikacji mobilnej (F-40: WebView z tym samym skryptem albo mapa natywna).
- Mapa przy nadaniu: sprzedający nadaje w dowolnym punkcie przewoźnika (`DROP_OFF`), więc nie wybiera punktu nadania.
- Symulacja trackingu sandboksa Furgonetki na stagingu. Przesyłki na stagingu dalej tworzy FakeShipping.
- Nowe usługi z mapy Furgonetki (Żabka, Allegro One Punkt, Poczta Polska, DHL POP i inne): to konfiguracja przewoźników i F-48.
- Odświeżanie zapisanych punktów w tle i oznaczanie nieczynnych na liście w koncie. Punkt sprawdzamy dopiero przy użyciu (otwarte pytania).
- Punkty odbioru za granicą.

## UX

**Checkout, sekcja „Dostawa” (paczkomat albo punkt odbioru):**

1. **„Twoje punkty”** (gdy konto ma zapisane punkty tej usługi):
   - karty wyboru z nazwą, adresem i etykietą „Domyślny”;
   - domyślny punkt jest zaznaczony, gdy zamówienie nie ma jeszcze dostawy.
2. **Dwa przyciski:** „Wybierz na mapie” (z ikoną mapy) i „Szukaj po adresie”. Ten drugi rozwija wyszukiwarkę z F-25. Bez mapy wyszukiwarka jest od razu widoczna.
3. **Wybrany punkt:**
   - karta jak dziś (nazwa, adres, godziny) z „Zmień punkt”;
   - pod nią pole wyboru „Zapisz w moich punktach odbioru”, gdy punkt nie jest zapisany, a konto ma mniej niż 10 punktów.

**Stany w checkoutcie:**

| Stan | Co widać |
|---|---|
| Wczytywanie mapy | przycisk „Wczytywanie mapy…” (`aria-busy`), drugi klik nic nie robi |
| Błąd mapy (skrypt, czas) | ostrzeżenie „Nie udało się wczytać mapy. Wyszukaj punkt po adresie.” i rozwinięta wyszukiwarka |
| Sprawdzanie punktu | „Sprawdzamy punkt…” w miejscu karty punktu |
| Punkt spoza usługi albo nieczynny | „Ten punkt nie obsługuje wybranej dostawy albo jest nieczynny. Wybierz inny.” |
| Zapis punktu nieudany (limit) | informacja „Masz już 10 zapisanych punktów. Usuń któryś w Koncie, żeby dodać nowy.”; płatność bez zmian |

**Konto, `/konto/adresy`:**

- Dwie sekcje, „Adresy” (jak dziś) i „Punkty odbioru”.
- Karta punktu pokazuje:
  - usługę (np. „InPost Paczkomat 24/7”), nazwę i adres punktu;
  - etykietę „Domyślny” przy punkcie domyślnym;
  - akcje „Ustaw jako domyślny” i „Usuń” (z potwierdzeniem).
- Pusty stan: „Nie masz zapisanych punktów odbioru” i przycisk „Dodaj punkt odbioru”.
- Przy 10 punktach: „Możesz zapisać najwyżej 10 punktów odbioru” zamiast przycisku.

**Konto, `/konto/adresy/punkty/nowy`:**

1. Wybór usługi: karty usług z punktami (InPost Paczkomat 24/7, Orlen Paczka, DPD Pickup).
2. Wybór punktu: ten sam komponent co w checkoutcie (mapa i wyszukiwarka).
3. Pole „Ustaw jako domyślny dla tej usługi”. Pierwszy punkt usługi jest domyślny automatycznie, więc pole jest wtedy zaznaczone i nieaktywne, z wyjaśnieniem.
4. „Zapisz punkt”. Po zapisie wracamy do `/konto/adresy` z komunikatem „Punkt odbioru zapisany”.

**Szerokość 390 px:** karty jedna pod drugą, przyciski mapy i wyszukiwarki na pełną szerokość. Wygląd okna mapy Furgonetki na telefonie sprawdzamy ręcznie na stagingu.

Teksty bez form zależnych od płci.

## Model danych

**`saved_pickup_points`** (moduł `shipping`, migracja `0025_saved_pickup_points`, nowa tabela, więc wstecznie kompatybilna):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `user_id` | `uuid`, właściciel; bez FK między modułami, jak w innych modułach |
| `provider` | dostawca punktów przy zapisie: `fake` albo `furgonetka` |
| `carrier_id` | FK `shipping_carriers.id`; tylko usługi `LOCKER` i `PICKUP_POINT` |
| `point_id` | kod punktu u dostawcy, np. `WAW01M` |
| `name`, `address` | kopia z dostawcy przy zapisie, do wyświetlania |
| `opening_hours` | kopia z dostawcy, `null`, gdy jej nie podał |
| `is_default` | domyślny dla usługi |
| `created_at`, `updated_at` | |

Indeksy i ograniczenia:

- unikalny `(user_id, provider, carrier_id, point_id)`: ten sam punkt raz;
- unikalny częściowy `(user_id, provider, carrier_id) WHERE is_default`: jeden domyślny na usługę;
- `(user_id, created_at)`: lista konta.

## API i zdarzenia

### REST

| Metoda i ścieżka | Dostęp | Opis |
|---|---|---|
| `GET /v1/shipping/points/{pointId}?carrier=` | sesja | Punkt po kodzie u dostawcy punktów. 422 `PICKUP_POINT_NOT_FOUND` (nieczynny albo nieznany) i `SHIPPING_OPTION_UNAVAILABLE` (kurier, nieznana usługa) |
| `GET /v1/me/pickup-points` | sesja | Zapisane punkty dostawcy punktów: najpierw domyślne, potem od najnowszych |
| `POST /v1/me/pickup-points` | sesja | `{ carrierId, pointId, isDefault? }`. Sprawdza punkt u dostawcy i zapisuje kopię nazwy i adresu. 201 dla nowego, 200 dla już zapisanego (z ustawieniem domyślnego, gdy `isDefault`). 409 `PICKUP_POINT_LIMIT_REACHED`, 422 jak wyżej |
| `PATCH /v1/me/pickup-points/{id}` | sesja | `{ isDefault: true }`: punkt domyślny dla swojej usługi |
| `DELETE /v1/me/pickup-points/{id}` | sesja | 204. Cudzy albo nieznany punkt: 404 |

Zmiany w istniejących odpowiedziach:

- `CarrierDto` i opcje dostawy checkoutu dostają `pointMap` (`{ provider, service, env }` albo `null`);
- `PUT /v1/orders/:id/delivery` bez zmian: punkt z mapy albo z zapisanych idzie jako `pickupPointId`.

Nowy kod błędu: `PICKUP_POINT_LIMIT_REACHED` (409, „Możesz zapisać najwyżej 10 punktów odbioru.”).

### Zdarzenia

Brak nowych eventów domenowych i WS.

### Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `SHIPPING_POINTS_PROVIDER` (API, worker) | `SHIPPING_DEFAULT_PROVIDER` | Dostawca punktów odbioru. Przy `SHIPPING_DEFAULT_PROVIDER=furgonetka` musi być `furgonetka`. `furgonetka` wymaga kompletu `FURGONETKA_*` |
| `NEXT_PUBLIC_FURGONETKA_MAP_KEY` (web) | — | Klucz klienta mapy z panelu Furgonetki (Furgonetka Mapa → klienci mapy), przypisany do domen środowiska. Jest klucz dla `staging.biddy.pl`; produkcja dostanie własny. Klienta mapy nie da się przypisać do `localhost`, więc lokalnie zmiennej nie ustawiamy i działa wyszukiwarka. Bez klucza web pokazuje tylko wyszukiwarkę |

## Reguły biznesowe i przypadki brzegowe

- **Punkt z mapy to tylko podpowiedź.** API zawsze sprawdza kod u dostawcy punktów (`findPoints` z `pointId`): przy podglądzie, przy zapisie w koncie i w `prepare`. Nazwę i adres zawsze bierzemy z API, nie z mapy.
- **Typ punktu:** `point.type` z mapy musi być kodem usługi u Furgonetki (`provider_codes.furgonetka`) wybranej usługi Biddy. Inny typ odrzucamy bez zapytania do API.
- **Zapisane punkty:**
  - najwyżej 10 na konto, jak adresy;
  - pierwszy punkt usługi zostaje domyślny;
  - jeden domyślny na konto, dostawcę i usługę;
  - limit i zmiana domyślnego są pod blokadą konta (jak adresy w F-10), więc równoległe zapisy ich nie łamią;
  - ponowny zapis tego samego punktu nie tworzy drugiego wpisu;
  - usunięcie domyślnego nie wybiera nowego domyślnego.
- **Kopia nazwy i adresu** jest tylko do wyświetlania. Gdy punkt przestał działać, `PUT delivery` kończy się 422 `PICKUP_POINT_NOT_FOUND`, a checkout prosi o wybór innego punktu. Zapisany punkt zostaje na liście, a osoba może go usunąć.
- **Podpowiedź w checkoutcie:**
  - zapisana dostawa zamówienia ma pierwszeństwo przed punktem domyślnym;
  - punkt domyślny wybieramy tylko, gdy zamówienie nie ma jeszcze dostawy;
  - zmiana usługi wybiera domyślny punkt nowej usługi albo żaden.
- **Zapis z checkoutu:** dopiero po udanym `PUT delivery` i tylko przy zaznaczonym polu. Błąd zapisu (limit, sieć) pokazuje informację i nie blokuje płatności.
- **Dostawcy:**
  - lista w koncie i w checkoutcie pokazuje tylko punkty bieżącego dostawcy punktów, bo kody FakeShipping i Furgonetki się nie mieszają;
  - po przełączeniu stagingu stare punkty znikają z listy, ale zostają w bazie;
  - aplikacja nie startuje z `SHIPPING_DEFAULT_PROVIDER=furgonetka` i innym dostawcą punktów;
  - na produkcji obaj dostawcy to `furgonetka`.
- **Środowisko mapy:** `env: 'sandbox'`, gdy `FURGONETKA_API_URL` wskazuje sandbox, inaczej `production`. Kody punktów z mapy i z API pochodzą wtedy z tego samego środowiska.
- **Skrypt mapy:**
  - ładujemy go raz na stronę, a kolejne otwarcia go nie pobierają;
  - podwójne kliknięcie nie otwiera dwóch map;
  - błąd ładowania pozwala spróbować ponownie przy następnym kliknięciu.

## Bezpieczeństwo i prywatność

- **Zapisane punkty** widzi i zmienia tylko właściciel. Cudzy identyfikator to 404.
- **Lista punktów konta zdradza okolicę zamieszkania albo pracy**, więc traktujemy ją jak adresy: dane osobowe, usuwane razem z kontem (retencja w F-41).
- **Klucz mapy jest publiczny** (trafia do przeglądarki). Chroni go lista domen w panelu Furgonetki, a staging i produkcja mają osobne klucze. Klucza nie trzymamy w repozytorium.
- **Skrypt Furgonetki to kod strony trzeciej.** Ładujemy go dopiero po kliknięciu „Wybierz na mapie”, więc bez tego przeglądarka nie łączy się z furgonetka.pl. Do mapy przekazujemy tylko miasto i kod pocztowy domyślnego adresu, bez ulicy, imienia i nazwiska ani telefonu.
- **Polityka prywatności i CSP:**
  - F-41: polityka prywatności wymienia Furgonetkę jako dostawcę mapy punktów;
  - F-42: CSP dopuszcza skrypt z `furgonetka.pl` i domeny kafelków mapy, które ustalimy na stagingu.
- **Limit zapytań do dostawcy** wynosi 5000 na godzinę, dlatego `GET /v1/shipping/points/{pointId}` i `POST /v1/me/pickup-points` wymagają sesji. `POST` ma dodatkowo limit 30 zapisów na godzinę na konto.

## Analityka

Eventy PostHog, bez kodów punktów i adresów:

- `pickup_point_map_opened`: `carrierId`, `context` (`checkout` albo `account`);
- `pickup_point_map_failed`: `carrierId`, `reason` (`load`, `timeout`, `type_mismatch` albo `not_found`);
- `pickup_point_selected`: `carrierId`, `source` (`map`, `search` albo `saved`), `context`;
- `pickup_point_saved`: `carrierId`, `context`, `isDefault`;
- `checkout_delivery_selected` dostaje `pointSource` (`map`, `search` albo `saved`).

Z tych eventów zobaczymy, czy mapa zastępuje wyszukiwarkę i jak często kupujący wracają do zapisanych punktów.

## Kryteria akceptacji

- [x] Given usługa paczkomatowa, dostawca punktów Furgonetka i klucz mapy, When kupujący w checkoutcie klika „Wybierz na mapie” i wybiera punkt, Then:
  - skrypt ładuje się dopiero po kliknięciu, a mapa pokazuje tylko tę usługę;
  - wybrany punkt pokazuje się z nazwą i adresem z API Biddy;
  - punkt trafia do `PUT delivery` jako `pickupPointId`.
- [x] Given punkt z mapy innej usługi albo nieznany dostawcy, When kupujący go wybiera, Then wybór jest odrzucony z komunikatem, a dostawa się nie zapisuje.
- [x] Given skrypt mapy, który nie wczytał się w 10 s, brak klucza mapy albo FakeShipping jako dostawca punktów, Then kupujący wybiera punkt wyszukiwarką jak w F-25.
- [x] Given zapisany domyślny punkt usługi, When kupujący otwiera checkout bez wybranej dostawy i wybiera tę usługę, Then punkt jest wybrany automatycznie, a pozostałe zapisane punkty usługi są kartami wyboru.
- [x] Given wybrany punkt spoza zapisanych i zaznaczone „Zapisz w moich punktach odbioru”, When dostawa się zapisze, Then punkt jest w „Punktach odbioru” konta. Given 10 zapisanych punktów, Then kupujący widzi informację o limicie, a płatność działa bez zmian.
- [x] Given konto, When osoba dodaje, ustawia domyślny i usuwa punkty, Then:
  - każda usługa ma najwyżej jeden punkt domyślny, a pierwszy punkt usługi jest domyślny;
  - ten sam punkt zapisany dwa razy to jeden wpis;
  - 11. punkt kończy się 409 `PICKUP_POINT_LIMIT_REACHED`, a cudzy punkt 404;
  - równoległe zapisy nie łamią limitu ani domyślności.
- [x] Given staging z `SHIPPING_DEFAULT_PROVIDER=fake` i `SHIPPING_POINTS_PROVIDER=furgonetka` (sandbox), Then mapa, podgląd i sprawdzanie punktu idą przez sandbox Furgonetki, a przesyłka przechodzi cykl FakeShipping. Given `SHIPPING_DEFAULT_PROVIDER=furgonetka` i inny dostawca punktów, Then konfiguracja jest odrzucona z czytelnym komunikatem.
- [x] Dostępność:
  - przyciski mapy i wyszukiwarki działają z klawiatury, a fokus wraca na przycisk po zamknięciu mapy;
  - stany (wczytywanie, błąd, wybrany punkt) są ogłaszane czytnikowi ekranu;
  - axe nie zgłasza naruszeń, a przy 390 px strona nie przewija się w poziomie.

## Plan testów

- **Jednostkowe (API):**
  - konfiguracja: `SHIPPING_POINTS_PROVIDER`, domyślna wartość, zakaz innego dostawcy punktów przy Furgonetce, komplet zmiennych;
  - `pointMap`: `env` z `FURGONETKA_API_URL`, kod usługi z `provider_codes`, `null` dla kuriera i FakeShipping;
  - reguły zapisanych punktów: pierwszy domyślny, duplikat, limit.
- **Integracyjne (Postgres):**
  - `GET /v1/shipping/points/{pointId}`: sesja, 422 dla kuriera i nieznanego punktu;
  - `/v1/me/pickup-points`: zapis, lista, domyślny, usunięcie, duplikat, limit, cudzy punkt 404, równoległe zapisy, filtr dostawcy punktów;
  - `prepare` z dostawcą punktów innym niż dostawca przesyłek (atrapa dostawcy punktów i FakeShipping dla przesyłki).
- **Kontrakt na sandboksie Furgonetki:** bez zmian, bo `findPoints` po kodzie już w nim jest.
- **Web (Vitest, Testing Library):**
  - ładowanie skryptu: jeden raz, czas oczekiwania, błąd i ponowna próba;
  - `PickupPointMap` z atrapą `window.Furgonetka.Map`:
    - opcje: klucz, `env`, usługa, miasto i kod pocztowy;
    - wybór punktu, a potem podgląd z API;
    - zły typ punktu;
    - powrót fokusu po zamknięciu;
  - checkout: zapisane punkty, automatyczny wybór domyślnego, zmiana usługi, pole „Zapisz…” i informacja o limicie;
  - konto: lista, pusty stan, domyślny, usuwanie, limit, formularz nowego punktu.
- **E2E (Playwright):**
  - checkout z atrapą skryptu mapy (`page.route` na `furgonetka.pl/js/dist/map/map.js`) i zapisem punktu;
  - konto: dodanie punktu wyszukiwarką (FakeShipping) i zmiana domyślnego;
  - axe i 390 px.
- **Ręcznie na stagingu (sandbox Furgonetki):** to jedyne miejsce z prawdziwą mapą, bo klucza nie da się przypisać do `localhost`.
  - prawdziwa mapa z kluczem dla domeny stagingu, także na telefonie;
  - ciasteczka i żądania skryptu w narzędziach przeglądarki;
  - wybór punktu z listy czytnikiem ekranu.

## Postęp i odstępstwa (2026-11-06)

- **Zrobione według specu:**
  - API: `SHIPPING_POINTS_PROVIDER` z walidacją, `pointMap` w usługach i opcjach dostawy, punkt po kodzie, `/v1/me/pickup-points` z tabelą `saved_pickup_points` (migracja `0025`);
  - web: mapa ładowana po kliknięciu, wyszukiwarka jako zapas, zapisane punkty w checkoutcie i w koncie.
- **Bez limitu 30 zapisów na godzinę na konto.** API nie ma jeszcze ogólnego limitera żądań. Ochronę dają: sesja, limit 10 punktów i brak zapytania do dostawcy przy ponownym zapisie tego samego punktu. Limit dołożymy razem z limitami żądań (F-42).
- **Mapa w checkoutcie nie ma testu Playwright.** Build do e2e nie ma klucza mapy, a klucza nie da się przypisać do `localhost`. Mapę z atrapą skryptu sprawdzają testy Vitest, a prawdziwą mapę sprawdzamy ręcznie na stagingu. Playwright sprawdza dodanie punktu w koncie wyszukiwarką.
- **`pointMap` jest też w wycenie zwrotu w sporze** (`returnQuote`), bo ten DTO współdzieli opcję dostawy. Kurier zawsze ma tam `null`.
- **Wdrożenie stagingu:** Compose przekazuje do API `SHIPPING_DEFAULT_PROVIDER`, `SHIPPING_POINTS_PROVIDER` i `FURGONETKA_*`, a build web dostaje `NEXT_PUBLIC_FURGONETKA_MAP_KEY` ze zmiennej repozytorium. Wcześniej Compose nie przekazywał zmiennych Furgonetki.
- **Domyślny punkt w checkoutcie** wynika z listy zapisanych punktów przy renderowaniu, bez efektu. Dopóki osoba nie wybierze punktu sama, checkout pokazuje domyślny punkt usługi.

## Otwarte pytania

- **Opłaty i warunki mapy Furgonetki:** dokumentacja mapy ich nie podaje. Zapytamy razem z pytaniami z §8.5 (stany zwrotu, kod nadania).
- **InPost Paczkomat a PaczkoPunkty:** czy usługa „InPost Paczkomat 24/7” ma pokazywać tylko automaty? Domyślnie paczkomat (`LOCKER`) pokazuje tylko automaty (`parcel_machine`), a punkt odbioru (`PICKUP_POINT`) oba typy. Zmieniamy, jeśli Furgonetka doręcza usługą `inpost` także do PaczkoPunktów, a kupujący będą o to prosić.
- **Ciasteczka skryptu mapy:** czy skrypt zapisuje ciasteczka albo wysyła dane analityczne, co wpływa na baner zgód (F-41)? Sprawdzimy na stagingu.
- **Nieczynne zapisane punkty:** czy oznaczać je na liście w koncie? Sprawdzenie każdego punktu przy wyświetlaniu kosztuje zapytania do dostawcy. Domyślnie sprawdzamy punkt dopiero przy wyborze.
