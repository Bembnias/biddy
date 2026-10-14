# F-11 · Kategorie i atrybuty

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-03

## Kontekst i cel

Każdy przedmiot należy do kategorii, a kategoria określa, jakie atrybuty trzeba podać: rozmiar dla mody, model i pamięć dla telefonów, gra i stan karty dla kart kolekcjonerskich ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety), §13.3). Atrybuty zasilają filtry wyszukiwarki (F-19), opis aukcji (F-18) i kreator wystawiania (F-14). Niszami startowymi są kolekcjonerstwo, sneakersy/moda vintage i retro gaming ([§2.4](../PROJECT.md#24-strategia-wejścia-na-rynek)), więc tam atrybuty są najbogatsze.

## Historyjki użytkownika

- Jako sprzedający chcę wybrać kategorię w kilku krokach (np. Kolekcjonerstwo → Karty kolekcjonerskie) i wypełnić tylko pola, które w niej mają sens.
- Jako kupujący chcę, żeby przedmioty w kategorii miały te same atrybuty, żeby móc je porównać i filtrować.
- Jako moderator chcę oznaczyć kategorie z ograniczeniami i kategorie narażone na podróbki, żeby kreator wymagał więcej od sprzedającego.
- Jako zespół chcemy zmieniać atrybuty kategorii bez psucia już wystawionych przedmiotów.

## Zakres

- **Drzewo kategorii** w module `catalog`: `parent_id` i ścieżka `ltree` ze slugów (np. `kolekcjonerstwo.karty-kolekcjonerskie`), kolejność rodzeństwa (`position`), `is_active`. Slug jest globalnie unikalny (adresy stron kategorii w F-18). Przedmioty mogą trafić tylko do aktywnego **liścia** drzewa.
- **Atrybuty** to lista definicji w formacie Biddy (`@biddy/shared`, walidowany Zodem), a nie dowolny JSON Schema. Typy: `text` (z `maxLength`), `number` (`min`, `max`, `integer`, `unit`), `select` (lista opcji z etykietami), `boolean`. Każda definicja ma `key` (camelCase), `label`, opcjonalnie `required` i `hint`. Z definicji generujemy JSON Schema (dla API, wyszukiwarki i asystenta AI w v2), walidację i formularz.
  - Powód: formularz potrzebuje etykiet, kolejności, jednostek i etykiet opcji; pełny JSON Schema tego nie opisuje bez rozszerzeń, a jego dowolność utrudnia generowanie formularza i walidację po obu stronach. Decyzja w PROJECT.md §22.
- **Dziedziczenie:** kategoria ma atrybuty własne, a obowiązują atrybuty całej ścieżki od korzenia. Atrybut dziecka o tym samym kluczu zastępuje atrybut rodzica (np. zawężone opcje). Kolejność: najpierw przodkowie.
- **Flagi** (dziedziczone: liść ma flagę, jeśli ma ją którakolwiek kategoria na ścieżce):
  - `is_restricted`: kategoria z ograniczeniami. Oferty przechodzą moderację przed publikacją (F-35), a kreator pokazuje zasady z `listing_notice`.
  - `is_brand_sensitive`: kategoria narażona na podróbki. Kreator wymaga więcej zdjęć, w tym metek i kodów (F-12, F-14, PROJECT.md §16.2).
- **Walidacja atrybutów przedmiotu** w backendzie: publiczne API modułu `catalog` (`CategoryService.validateItemAttributes`) dla F-14. Błąd to 400 `VALIDATION_FAILED` z błędem pola na każdy atrybut (`attributes.<klucz>`) i komunikatem po polsku. Tę samą walidację (z `@biddy/shared`) wykonuje formularz w web.
- **Zmiana atrybutów nie psuje przedmiotów:** przedmiot przechowuje wartości tak, jak je zapisano (JSONB). Walidacja działa tylko przy zapisie. Wyświetlanie (`describeAttributes`) pokazuje znane atrybuty z aktualnymi etykietami, a wartości spoza aktualnych opcji i usunięte atrybuty nie powodują błędu.
- **API:** `GET /v1/categories` (płaska lista aktywnych kategorii w kolejności drzewa, z rodzicem, głębokością, informacją o liściu i flagami) i `GET /v1/categories/{id}/schema` (obowiązujące atrybuty, flagi, zasady i JSON Schema).
- **Seed** (migracja danych, więc kategorie są w każdym środowisku): 9 kategorii głównych (Kolekcjonerstwo, Moda, Elektronika, RTV, AGD, Dom i ogród, Książki/muzyka/filmy, Sport i hobby, Inne) i ok. 35 podkategorii z atrybutami, najbogatszymi w niszach startowych.
- **Web:** komponenty `CategoryPicker` (wybór kategorii krok po kroku do liścia) i `AttributeFields` (pola formularza z definicji, walidacja z `@biddy/shared`, react-hook-form). Kreator wystawiania, który ich użyje, to F-14.

## Poza zakresem

- Zarządzanie kategoriami w panelu admina (F-34); do tego czasu zmiany drzewa i atrybutów to migracje.
- Strony kategorii, okruszki i SEO (F-18), filtry wyszukiwarki z atrybutów (F-19).
- Słowniki marek i modeli (marka to osobne pole przedmiotu, F-14).
- Tłumaczenia nazw kategorii (tylko polski).

## UX

**CategoryPicker** (kreator, F-14):

```
Kategoria
[ Kolekcjonerstwo        ▾ ]
[ Karty kolekcjonerskie  ▾ ]   (kolejny poziom pojawia się po wyborze)
✓ Wybrano: Kolekcjonerstwo › Karty kolekcjonerskie
ⓘ Kategoria narażona na podróbki: dodasz zdjęcia metek i kodów.
```

**AttributeFields:** pole na atrybut w kolejności definicji: `text` → pole tekstowe, `number` → pole liczbowe z jednostką w etykiecie (np. „Rozmiar (EU)”), `select` → lista wyboru z pustą opcją „Wybierz”, `boolean` → pole wyboru. Pola wymagane mają oznaczenie „(wymagane)”, błędy są powiązane z polem (`aria-describedby`).

| Stan | Zachowanie |
|---|---|
| Ładowanie listy kategorii | Szkielet pola wyboru |
| Błąd API | Komunikat (`role="alert"`) i ponowienie |
| Kategoria bez atrybutów | Brak sekcji atrybutów |
| Błędne wartości | Błędy przy polach po polsku |

## Model danych

Migracje `0005_categories` (rozszerzenie `ltree`, tabela) i `0006_initial_categories` (dane):

- `categories`: `id`, `parent_id` → `categories` (FK w obrębie modułu), `path` (`ltree`, unikalna, indeks GiST), `slug` (unikalny), `name`, `position`, `attributes` (JSONB: lista definicji), `is_restricted`, `is_brand_sensitive`, `listing_notice`, `is_active`, `created_at`, `updated_at`.

## API i zdarzenia

- `GET /v1/categories` → `CategoryDto[]`: `id`, `parentId`, `slug`, `name`, `path` (lista slugów), `depth`, `isLeaf`, `isRestricted`, `isBrandSensitive` (efektywne). `cache-control: public, max-age=300`.
- `GET /v1/categories/{id}/schema` → `CategorySchemaDto`: `categoryId`, `isLeaf`, flagi, `listingNotice`, `attributes` (obowiązujące definicje), `jsonSchema`. Nieznana albo nieaktywna kategoria: 404.
- Publiczne API modułu: `CategoryService.validateItemAttributes(categoryId, values)` (rzuca `VALIDATION_FAILED`; kategoria nieaktywna albo nie-liść też) i `CategoryService.describeAttributes(categoryId, values)`.
- Eventy domenowe: brak.

## Reguły biznesowe i przypadki brzegowe

- Atrybut wymagany: wartość musi być podana (dla `text` niepusta po przycięciu; `boolean` jest zawsze podany: brak to `false`).
- Wartości atrybutów nieopisanych w kategorii są odrzucane („Nieznany atrybut”).
- `number`: liczba skończona, w granicach `min`–`max`, całkowita, jeśli `integer`.
- `select`: wartość musi być jedną z opcji.
- Kategoria nieaktywna znika z listy razem z poddrzewem; istniejące przedmioty zostają (wyświetlanie nie zależy od aktywności).

## Bezpieczeństwo i prywatność

- Definicje atrybutów są walidowane przy odczycie z bazy (Zod); uszkodzona definicja to błąd 500 i alert w Sentry, a nie formularz z niebezpieczną treścią.
- Etykiety i opcje są zwykłym tekstem (React je escapuje).

## Analityka

Brak w F-11 (zdarzenia kreatora w F-14).

## Kryteria akceptacji

- [x] Given liść drzewa (np. Moda › Sneakersy), Then jego schemat zawiera atrybuty kategorii nadrzędnych (kolor z Mody) i własne (rozmiar), a flagi są dziedziczone.
- [x] Given niepoprawne atrybuty przedmiotu (brak wymaganego, zła opcja, liczba poza zakresem, nieznany klucz), Then walidacja odrzuca je z błędem pola po polsku dla każdego atrybutu.
- [x] Given zmiana atrybutów kategorii (usunięty atrybut, usunięta opcja, nowy wymagany atrybut), Then istniejące wartości nadal się wyświetlają bez błędu.
- [x] Given migracje, Then każde środowisko ma drzewo kategorii z seeda, a każda definicja atrybutu przechodzi walidację.

## Plan testów

- **Shared, jednostkowe:** walidacja definicji, dziedziczenie, walidacja wartości (każdy typ i błąd), JSON Schema, wyświetlanie po zmianie schematu.
- **API, integracyjne:** migracja i seed (spójność drzewa: ścieżki, rodzice, liście, unikalne slugi, poprawne definicje), `GET /v1/categories`, `GET /v1/categories/{id}/schema` (dziedziczenie, flagi, 404), `validateItemAttributes` (liść, nieaktywna, błędy pól).
- **Web, jednostkowe:** `CategoryPicker` (kolejne poziomy, wybór liścia, komunikat flag, błąd API z ponowieniem), `AttributeFields` z `attributesSchema` (rodzaje pól, wymagane, błędy po polsku jak w API, wartości do wysłania).
- **Web, e2e:** brak w F-11 (komponenty nie mają jeszcze strony); ścieżkę wystawiania z kategorią i atrybutami pokryje e2e kreatora w F-14.

## Otwarte pytania

- Minimalna liczba zdjęć w kategoriach narażonych na podróbki: **domyślnie** ustali F-14 (propozycja: 4, w tym metka lub kod).
- Lista kategorii z ograniczeniami: **domyślnie** tylko Militaria (bez broni i amunicji); pozostałe wg regulaminu (F-41).
