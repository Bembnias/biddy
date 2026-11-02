# F-19 · Wyszukiwarka i przeglądanie

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-04, F-11, F-14, F-15, F-16, F-18

## Kontekst i cel

Kupujący musi szybko znaleźć interesujące aukcje: wpisać „nike 42” (także z literówką), zawęzić kategorię, stan, cenę i atrybuty kategorii (rozmiar, kolor) i posortować wyniki, np. po aukcjach kończących się najwcześniej ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety), [§15.5](../PROJECT.md#155-indeksowanie-wyszukiwarki)). Strona główna i strony kategorii prowadzą do aukcji i są indeksowane przez wyszukiwarki, a sitemap pokazuje im aktywne aukcje. Dyrektywa Omnibus wymaga ujawnienia głównych parametrów ustalania kolejności wyników ([§17](../PROJECT.md#17-prawo-i-compliance)).

F-19 dodaje indeks aukcji w Meilisearch z synchronizacją przez outbox, API wyszukiwania z fasetami, stronę główną z aukcjami, wyszukiwarkę, strony kategorii i dynamiczną sitemap.

## Historyjki użytkownika

- Jako kupujący wpisuję „nikee air max” i widzę buty Nike mimo literówki.
- Jako kupujący w kategorii „Sneakersy” filtruję po rozmiarze, stanie i cenie i widzę, ile aukcji ma każda opcja.
- Jako kupujący sortuję wyniki: kończące się, najnowsze, cena rosnąco/malejąco, liczba ofert.
- Jako kupujący na stronie głównej widzę aukcje kończące się wkrótce i nowe aukcje oraz kategorie.
- Jako sprzedający chcę, żeby moja aukcja była wyszukiwalna kilka sekund po publikacji.

## Zakres

### Indeks (moduł `search`, worker)

- Indeks `{SEARCH_INDEX_PREFIX}-auctions` w Meilisearch, klucz `id` (UUID aukcji). Zawiera **tylko aktywne aukcje**: po zakończeniu albo anulowaniu dokument jest usuwany.
- Dokument (§15.5): `title`, `description`, `brand`, `categoryIds` (od głównej do liścia), `categoryPath` (nazwy), `attributes` (zapisane wartości do filtrów), `attributeText` (etykiety i wartości do wyszukiwania pełnotekstowego), `condition`, `price` (aktualna albo wywoławcza), `startPrice`, `currentPrice`, `bidCount`, `buyNowPrice` (gdy dostępne), `endsAt`/`endsAtTs`, `publishedAtTs`, `sellerId`, `carriers`, `publicId`, `slug`, zdjęcie główne (warianty 320 i 800 px). `sellerRating` i `city` dojdą z ocenami (F-30) i adresem sprzedawcy.
- Ustawienia: wyszukiwanie po `title`, `brand`, `attributeText`, `categoryPath`, `description` (w tej kolejności ważności); filtry po `status`, `categoryIds`, `condition`, `attributes`, `price`, `endsAtTs`, `sellerId`, `buyNowPrice`; sortowanie po `endsAtTs`, `publishedAtTs`, `price`, `bidCount`. Tolerancja literówek domyślna Meilisearch (1 literówka od 5 znaków, 2 od 9).
- **Synchronizacja przez outbox:** konsumenci `AuctionPublished`, `AuctionUpdated`, `BidPlaced`, `BidCancelled`, `AuctionEnded`, `AuctionCancelled` planują job `search.index-auction` w kolejce `search` na koniec 5-sekundowego okna (ID joba z końcem okna, jak rewalidacja w F-18). To jest **debounce zmian cen**: seria ofert w oknie daje jedną aktualizację. Job czyta aktualny stan aukcji: aktywna → dokument (pełny, zastępuje poprzedni), inna → usunięcie. Job czeka na zakończenie zadania Meilisearch (błąd = ponowienie).
- **Nocny pełny reindeks** (`search.reindex`, codziennie o 3:00): ustawienia indeksu, wszystkie aktywne aukcje partiami i usunięcie dokumentów aukcji, które nie są już aktywne.
- Ustawienia indeksu worker zapisuje przed pierwszym zapisem w procesie (zmiana ustawień w kodzie trafia do Meilisearch po wdrożeniu). Indeks powstaje z tą aktualizacją ustawień; przez krótką chwilę po utworzeniu Meilisearch odrzuca filtry (ustawienia jeszcze się nakładają), a API traktuje to jak brak wyników.

### API

- **`GET /v1/auctions`** (publiczne) — wyszukiwanie:
  - parametry: `q` (do 200 znaków), `category` (UUID), `condition` (powtarzalny), `priceMin`, `priceMax` (grosze), `attr` (powtarzalny: `klucz:wartość` dla opcji i tak/nie, `klucz:od..do` dla liczb, np. `rozmiarEu:40..44`), `seller` (UUID), `sort` (`relevance`, `ending`, `newest`, `price_asc`, `price_desc`, `bids`), `page`, `pageSize` (do 48, domyślnie 24);
  - domyślne sortowanie: trafność przy zapytaniu, kończące się bez zapytania;
  - zawsze tylko aktywne aukcje przed końcem (`endsAtTs > teraz`), więc aukcja po czasie znika z wyników, zanim job ją usunie;
  - filtry atrybutów tylko z atrybutów wybranej kategorii (z dziedziczeniem, F-11); nieznany atrybut, atrybut bez kategorii albo zła wartość: 400 `VALIDATION_FAILED`;
  - odpowiedź: karty aukcji (zdjęcie, tytuł, cena, liczba ofert, koniec, Kup teraz, stan), liczba wyników i stron (najwyżej 1000 wyników na zapytanie), fasety: podkategorie wybranej kategorii (albo kategorie główne) z liczbą aukcji, stany, zakres cen, atrybuty kategorii (opcje z etykietami i liczbą aukcji, zakres liczb);
  - błąd Meilisearch: 503 `SERVICE_UNAVAILABLE` („Wyszukiwarka jest chwilowo niedostępna.”), indeks jeszcze nieutworzony: pusta lista.
- **`GET /v1/sitemap/auctions`** — aktywne aukcje do sitemap (`publicId`, `slug`, data zmiany), najnowsze najpierw, najwyżej 50 000 (z indeksu, bez limitu 1000 wyników wyszukiwania).
- Konfiguracja: `MEILI_URL`, `MEILI_API_KEY` (na produkcji wymagane w API i workerze; lokalnie klucz z docker-compose), `SEARCH_INDEX_PREFIX` (domyślnie `biddy`; staging i testy mają własny).

### Web

- **Strona główna** (ISR 60 s): sekcje „Kończą się wkrótce” i „Nowe aukcje” (po 8 kart), kategorie główne z linkami, dalej obecne sekcje o Biddy. Gdy wyszukiwarka nie odpowiada, sekcji z aukcjami nie ma, a strona działa.
- **Wyszukiwarka `/szukaj`** i **strony kategorii `/kategoria/{ścieżka slugów}`** (np. `/kategoria/moda/sneakersy`), ten sam widok:
  - filtry w zwykłym formularzu GET (działa bez JavaScriptu): podkategorie (linki z liczbą aukcji), stan, cena od/do (zł), atrybuty kategorii (opcje jako pola wyboru z liczbą aukcji, liczby jako zakres od/do, tak/nie), sortowanie; przycisk „Pokaż wyniki” i „Wyczyść filtry”;
  - parametry w adresie po polsku: `q`, `kategoria` (tylko `/szukaj`), `stan`, `cena_od`, `cena_do`, `a.{klucz}` (opcje, powtarzalny), `a.{klucz}.od`, `a.{klucz}.do`, `sort`, `strona`;
  - siatka kart (2/3/4 kolumny), paginacja (poprzednia, numery, następna), komunikat o braku wyników z podpowiedzią;
  - filtry w rozwijanym panelu „Filtry” (natywne `<details>`): na telefonie zwinięte, na desktopie rozwijane po załadowaniu;
  - „Jak ustalamy kolejność wyników?” (Omnibus): główne parametry rankingu, informacja, że pozycji nie można kupić.
- SEO: strony kategorii indeksowane (tytuł, opis, adres kanoniczny bez filtrów), `/szukaj` z `noindex, follow`; okruszki kategorii na stronie aukcji (F-18) stają się linkami.
- **Sitemap** (`/sitemap.xml`): strona główna, kategorie i aktywne aukcje, renderowana przy żądaniu z danych w cache (10 min), żeby sitemap zbudowany bez dostępu do API nie był pusty; `robots.txt` na produkcji wskazuje sitemap.
- **Profil publiczny** (F-10): sekcja „Aktywne aukcje” pokazuje aukcje sprzedawcy (filtr `seller`).

## Poza zakresem

- Podpowiedzi przy wpisywaniu, zapisane wyszukiwania z alertami i rekomendacje (v1/v2), obserwowane (F-20).
- Fasety z licznikami „rozłącznymi” (liczba przy opcji uwzględnia pozostałe filtry tej samej grupy); w MVP liczby uwzględniają wszystkie wybrane filtry.
- Wyszukiwanie zakończonych aukcji, filtr po lokalizacji (`city`) i ocenie sprzedawcy.
- Sitemap powyżej 50 000 aukcji (podział na wiele plików, gdy będzie potrzebny).

## UX

- Karta aukcji: zdjęcie (kwadrat), tytuł (2 linie), cena („Aktualna cena” albo „Cena wywoławcza”), liczba ofert, data i godzina końca, „Kup teraz {cena}” gdy dostępne. Cała karta jest linkiem do strony aukcji.
- Nagłówek wyników: „{n} aukcji” (odmiana), przy zapytaniu „Wyniki dla „{q}””; powyżej 1000: „ponad 1000 aukcji”.
- Brak wyników: „Nic nie znaleźliśmy. Sprawdź pisownię albo usuń część filtrów.” i link „Wyczyść filtry”.
- Dostępność: formularz filtrów z `fieldset`/`legend`, paginacja w `nav` z `aria-current="page"`, karty jako lista.

## Model danych

Brak zmian w bazie (indeks w Meilisearch).

## API i zdarzenia

- `GET /v1/auctions` → `AuctionSearchDto` (`cache-control: public, max-age=10`).
- `GET /v1/sitemap/auctions` → `SitemapAuctionsDto` (`cache-control: public, max-age=300`).
- Niedostępna wyszukiwarka: istniejący kod `SERVICE_UNAVAILABLE` (503).
- Kolejka `search` (współbieżność 5): `search.index-auction` `{ auctionId }`, `search.reindex` (cron `0 3 * * *`).
- Konsumenci `search.index-*` (po jednym na event z listy wyżej).

## Reguły biznesowe i przypadki brzegowe

- Nowa aukcja jest wyszukiwalna w ciągu ok. 5 s od publikacji (koniec okna + zadanie Meilisearch).
- Zakończona albo anulowana aukcja znika z wyników od razu po `endsAt` (filtr) i z indeksu w ciągu kilku sekund od zamknięcia (F-16).
- Zmiana tytułu, opisu albo ceny przed pierwszą ofertą (`AuctionUpdated`) aktualizuje dokument.
- Aukcja zablokowanego sprzedawcy zostaje w indeksie do decyzji moderacji (F-61); strona aukcji zwraca wtedy 404 (F-18).
- Strona wyników powyżej limitu 1000 wyników: paginacja kończy się na ostatniej dostępnej stronie.
- Cena w filtrach w złotych (web), w API w groszach.

## Bezpieczeństwo i prywatność

- Klucz Meilisearch tylko w API i workerze; przeglądarka nie łączy się z Meilisearch.
- Filtry budowane z walidowanych parametrów (wartości w cudzysłowach z escapowaniem), bez przekazywania surowego wyrażenia filtra od klienta.
- Dokument nie zawiera maksimów, ceny minimalnej ani danych licytujących.

## Analityka

PostHog (po zgodzie): `search_performed` (`hasQuery`, `category`, `filters` — liczba filtrów, `sort`, `results`).

## Kryteria akceptacji

- [x] Given opublikowana aukcja, Then jest wyszukiwalna w mniej niż 10 s (test integracyjny z workerem i Meilisearch).
- [x] Given aukcja zakończona przez worker, Then znika z domyślnych wyników w mniej niż 1 minutę (test integracyjny).
- [x] Given seria ofert, Then indeks aktualizuje cenę (debounce: jedna aktualizacja na okno 5 s; test jednostkowy okna i integracyjny).
- [x] Given wybrana kategoria, Then filtry i fasety atrybutów pochodzą z jej schematu; atrybut spoza kategorii daje 400.
- [x] Given zapytanie z literówką („nikee”), Then wyniki zawierają aukcje „Nike”.
- [x] Given sitemap, Then zawiera stronę główną, kategorie i aktywne aukcje (bez zakończonych).
- [x] Given strona wyników, Then widać opis głównych parametrów rankingu (Omnibus).

## Plan testów

- **API, jednostkowe:** budowa filtra (escapowanie, zakresy, OR w ramach atrybutu), parsowanie `attr`, mapowanie dokumentu i faset.
- **API, integracyjne (Postgres, Redis, Meilisearch w kontenerach, worker):** publikacja → wyszukiwalna < 10 s; literówka; filtry kategorii, stanu, ceny i atrybutów z fasetami; 400 dla atrybutu spoza kategorii; sortowania; oferta → nowa cena w indeksie; zamknięcie → znika; nocny reindeks usuwa nieaktywne i dodaje brakujące; sitemap.
- **Web, jednostkowe:** parametry adresu ↔ API, karta, filtry (formularz GET), paginacja.
- **Web, e2e:** strona główna z sekcjami, wyszukiwarka z filtrami bez JavaScriptu (formularz GET), strona kategorii, brak wyników, sitemap, dostępność (axe).

## Otwarte pytania

- Domyślne sortowanie bez zapytania: **domyślnie** „kończące się”; zmienimy, jeśli dane z bety pokażą, że kupujący wolą „najnowsze”.
