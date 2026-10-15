# F-14 · Kreator aukcji (web)

**Status:** Review
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-08, F-11, F-12, F-13

## Kontekst i cel

Sprzedający wystawia przedmiot na licytację w kilka minut ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety), [§6.2](../PROJECT.md#62-parametry-aukcji)). Kreator łączy zdjęcia (F-12), kategorię z atrybutami (F-11), opis przedmiotu, gabaryt i przewoźników ([§8.2](../PROJECT.md#82-gabaryty)) oraz parametry aukcji. Przy publikacji pilnujemy reguł, które chronią kupujących i platformę: limitów nowych sprzedawców ([§4.1](../PROJECT.md#41-limity-kont-i-strikei)), zakazanych przedmiotów ([§17](../PROJECT.md#17-prawo-i-compliance)), informacji o weryfikacji tożsamości przed pierwszym wystawieniem (lekcja z decyzji UOKiK wobec Vinted) i niezmienności oferty po pierwszej ofercie kupującego ([§6.6](../PROJECT.md#66-wiążący-charakter-ofert)).

F-14 tworzy model przedmiotu i aukcji, na którym pracują silnik licytacji (F-15), zamykanie aukcji (F-16), strona aukcji (F-18) i wyszukiwarka (F-19).

## Historyjki użytkownika

- Jako sprzedający chcę wystawić przedmiot w kilku prostych krokach, także z telefonu, i wrócić do niedokończonego szkicu.
- Jako sprzedający chcę wiedzieć przed publikacją, czego brakuje i dlaczego.
- Jako sprzedający chcę poprawić aukcję, dopóki nikt nie złożył oferty, anulować ją i wystawić ponownie zakończoną.
- Jako sprzedający chcę wiedzieć z góry, że wypłata wymaga weryfikacji tożsamości.
- Jako kupujący chcę, żeby opis i cena aukcji, na którą licytuję, się nie zmieniały.
- Jako platforma nie chcemy zakazanych przedmiotów ani drogich aukcji od nowych, niesprawdzonych kont.

## Zakres

### Model (backend)

Odpowiedzialność modułów ([§10.3](../PROJECT.md#103-moduły-backendu-bounded-contexts)):

- **`catalog`: przedmiot** (`items`, `item_media`): kategoria, atrybuty, tytuł, opis, stan, marka, gabaryt (wymiary i waga dla XL), akceptowani przewoźnicy i zdjęcia w kolejności (pierwsze = główne).
- **`auctions`: aukcja** (`auctions`): statusy, ceny (wywoławcza, minimalna, Kup teraz), czas trwania, czasy startu i końca, pola licytacji wypełniane w F-15 (aktualna cena, lider, liczba ofert). Moduł `auctions` prowadzi cały proces (szkic, publikacja, edycja, anulowanie, ponowne wystawienie) i woła publiczne API pozostałych modułów **w jednej transakcji** (przekazuje `Transaction`, jak `Outbox.add`), żeby edycja nie mogła się przeplatać z pierwszą ofertą.
- **`shipping`: przewoźnicy** (`shipping_carriers`): konfiguracja w bazie, nie w kodzie (§8.2): usługa (np. InPost Paczkomat 24/7), rodzaj (paczkomat, punkt, kurier) i obsługiwane gabaryty. Startowa lista z §8.1 to migracja danych; ceny i limity per przewoźnik dojdą w F-24.
- **`identity`: stan sprzedawcy**: blokada wystawiania (`listing_blocked_until`, ustawiana od F-61), potwierdzenie informacji o weryfikacji tożsamości (`seller_kyc_notice_accepted_at`), poziom sprzedawcy i status KYC (na razie zawsze „nowy” i „bez KYC”; liczenie poziomu z historii to F-61, KYC to F-32).
- **`trust-safety`: filtr słów**: tytuł, opis i marka sprawdzane przy publikacji i edycji aktywnej aukcji. Werdykt `BLOCK` (przedmiot zakazany, np. amunicja, narkotyki, e-papierosy, „mystery box”) odrzuca publikację z błędem pola. Werdykt `REVIEW` (słowa niejednoznaczne, np. „replika”, „pistolet”) kieruje aukcję do moderacji. Tekst normalizujemy (małe litery, bez polskich znaków, cyfry zamiast liter typu `0→o`, separatory), dopasowanie po całych słowach.
- **Wspólne reguły** w `@biddy/shared` (`listing`): stany przedmiotu, gabaryty, czasy trwania, długości pól, reguły cen, wartość aukcji i `validateListing(…)`, które sprawdza kompletność z błędami pól po polsku. Ta sama funkcja działa w kreatorze (podpowiedzi przed publikacją) i w API (autorytatywnie).

### Statusy aukcji

```
DRAFT ──publikacja──► ACTIVE ──(F-16)──► ENDED_SOLD | ENDED_UNSOLD
  │                     │
  │                     └─anulowanie──► CANCELLED
  └──publikacja (kategoria z ograniczeniami albo filtr słów: REVIEW)──► PENDING_REVIEW ──(F-35: akceptacja)──► ACTIVE
                                                                             └─anulowanie──► CANCELLED
```

- `PENDING_REVIEW`: aukcja czeka na moderatora (F-35). Czas trwania liczy się od akceptacji. Event `AuctionSubmittedForReview` z powodami (`RESTRICTED_CATEGORY`, `WORD_FILTER`).
- `SCHEDULED` (planowany start) to v1, poza zakresem.

### Reguły publikacji

Wszystkie błędy naraz, jako błędy pól (400 `VALIDATION_FAILED`), żeby kreator pokazał je przy właściwych krokach:

- **Zdjęcia:** 1–20, wszystkie gotowe (`READY`) i należące do sprzedającego. Kategoria narażona na podróbki (`is_brand_sensitive`): co najmniej 4 zdjęcia (w tym metki lub kody, podpowiedź w kreatorze) i obowiązkowa marka.
- **Kategoria:** aktywny liść drzewa, atrybuty poprawne (`CategoryService.validateItemAttributes`, F-11).
- **Tytuł** 10–80 znaków, **opis** 30–5000 znaków (po przycięciu), **stan** z listy (nowy, jak nowy, bardzo dobry, dobry, zadowalający, uszkodzony lub na części), **marka** do 60 znaków.
- **Gabaryt** S, M, L albo XL; XL wymaga wymiarów (cm) i wagi (do 100 kg). **Przewoźnicy:** co najmniej jeden aktywny, obsługujący wybrany gabaryt.
- **Ceny:** wywoławcza ≥ 1 zł; minimalna (opcjonalna) ≥ wywoławczej; Kup teraz (opcjonalne) ≥ 130% wywoławczej i ≥ minimalnej (§6.2). **Czas trwania:** 1, 3, 5, 7 albo 10 dni.
- **Limity sprzedawcy** (§4.1): wartość aukcji (najwyższa z: wywoławcza, minimalna, Kup teraz) do limitu poziomu (nowy: 500 zł) i powyżej 1000 zł tylko z pozytywnym KYC (błąd pola przy cenie). Liczba aktywnych aukcji (`ACTIVE` i `PENDING_REVIEW`) poniżej limitu poziomu (nowy: 5): inaczej 409 `LISTING_LIMIT_REACHED`.
- **Blokada wystawiania** (F-61): 403 `LISTING_BLOCKED` z datą końca. **Telefon:** publikacja wymaga zweryfikowanego telefonu (`@RequireVerifiedPhone`, F-08).
- **Informacja o weryfikacji tożsamości:** przed pierwszą publikacją sprzedający potwierdza, że przeczytał informację („wypłata środków wymaga weryfikacji tożsamości i konta bankowego u operatora płatności”). Potwierdzenie (`kycNoticeAccepted: true`) zapisujemy z datą jako dowód poinformowania.
- **Filtr słów:** `BLOCK` → błąd pola; `REVIEW` albo kategoria z ograniczeniami → `PENDING_REVIEW`.

Po publikacji: `starts_at = teraz`, `ends_at = starts_at + czas trwania`, event `AuctionPublished`. Rejestracja sprzedawcy u operatora przy pierwszym wystawieniu to F-32; planowanie zamknięcia aukcji to F-16.

### Edycja, anulowanie, ponowne wystawienie

- **Szkic:** autozapis częściowych danych (każde podane pole ma poprawny format, kompletność dopiero przy publikacji). Zdjęcia dodane do szkicu są od razu przypisane (`MediaService.attach`), więc sprzątanie nieużytych zdjęć (24 h) ich nie usunie; usunięte ze szkicu wracają do sprzątania. Szkic można usunąć. Limit 50 szkiców na konto.
- **Aukcja aktywna lub w moderacji bez ofert:** edycja wszystkich pól poza czasem trwania, z pełną walidacją jak przy publikacji (filtr słów z werdyktem `REVIEW` odrzuca zmianę: „anuluj i wystaw ponownie”). Event `AuctionUpdated`.
- **Po pierwszej ofercie:** edycja zablokowana w całości (409 `AUCTION_HAS_BIDS`). Kryterium wymaga blokady ceny, opisu i zdjęć; blokujemy też tytuł, stan, kategorię, atrybuty i dostawę, bo zmieniają przedmiot, na który złożono ofertę.
- **Anulowanie** (§6.6): bez ofert zawsze; z ofertami nie później niż 12 h przed końcem (409 `AUCTION_CANCEL_TOO_LATE`). Event `AuctionCancelled` z liczbą ofert: przy ofertach F-61 nadaje strike, a powiadomienia licytujących dojdą z modułem powiadomień.
- **Ponowne wystawienie** zakończonej albo anulowanej aukcji: kopia przedmiotu i parametrów jako nowy szkic (te same zdjęcia), bez publikacji.

### API

Szczegóły w „API i zdarzenia”. Odczyt dla sprzedającego pod `/v1/me/auctions` (z ceną minimalną), zmiany pod `/v1/auctions/{id}` (§14.1). Publiczny widok aukcji to F-18.

### Web

- **`/wystaw`**: zachęta do weryfikacji telefonu (bez niej da się przygotować szkic, ale nie opublikować), informacja o blokadzie wystawiania i limicie aktywnych aukcji, lista szkiców („Kontynuuj”, „Usuń”) i „Nowa aukcja”.
- **`/wystaw/{id}`**: kreator w 6 krokach z paskiem postępu (krok w adresie `?krok=`, więc działa przycisk Wstecz):
  1. Zdjęcia (`PhotoUploader` z F-12, ze zdjęciami szkicu),
  2. Kategoria i atrybuty (`CategoryPicker`, `AttributeFields` z F-11), marka,
  3. Tytuł, opis, stan,
  4. Gabaryt (z wymiarami dla XL) i przewoźnicy obsługujący gabaryt,
  5. Parametry: cena wywoławcza, czas trwania, cena minimalna, Kup teraz, z ceną łączną dla kupującego (`TotalPrice`, F-13) i limitem wartości konta,
  6. Podgląd z listą braków (linki do kroków), informacja o weryfikacji tożsamości z potwierdzeniem przed pierwszą publikacją i „Opublikuj”.
  - Autozapis 1 s po ostatniej zmianie i przy zmianie kroku, ze stanem „Zapisywanie…”, „Zapisano”, „Nie udało się zapisać” (`role="status"`).
  - „Dalej” sprawdza bieżący krok tymi samymi regułami co API (`validateListing`), ale nie blokuje przejścia wstecz.
- **`/konto/aukcje`** (Moje aukcje): lista z filtrem (szkice, aktywne, w moderacji, zakończone, anulowane), akcje „Edytuj” (szkic albo bez ofert), „Anuluj” (potwierdzenie; przy ofertach ostrzeżenie o strike'u), „Wystaw ponownie”.
- Po publikacji: komunikat na `/konto/aukcje` („Aukcja jest aktywna do …” albo „Aukcja czeka na sprawdzenie przez moderatora”). Strona aukcji to F-18.

## Poza zakresem

- Planowany start (`SCHEDULED`) i automatyczne ponowne wystawienie (v1), asystent AI (v2).
- Rejestracja sprzedawcy u operatora i KYC (F-32), poziomy sprzedawców z historii, nadpisania limitów i strike'i (F-61), kolejka moderacji z akceptacją i odrzuceniem (F-35).
- Zamykanie aukcji i jej job (F-16), strona aukcji (F-18), indeks wyszukiwarki (F-19), ceny dostaw („dostawa od”, F-24), powiadomienia licytujących o anulowaniu.
- Lokalizacja przedmiotu (miasto): F-18 weźmie ją z adresu nadania sprzedającego.
- Sprzątanie porzuconych szkiców (zdjęcia szkicu są przypisane, więc zostają): później, z danymi o skali.

## UX

```
Wystaw przedmiot                                    Zapisano ✓
[1 Zdjęcia]──[2 Kategoria]──[3 Opis]──[4 Dostawa]──[5 Cena]──[6 Podgląd]

 Krok 5 z 6: Cena i czas trwania
 Cena wywoławcza    [   1,00 ] zł     Licytacja od 1 zł
 Czas trwania       ( ) 1 ( ) 3 (•) 7 ( ) 10 dni
 Cena minimalna     [        ] zł     opcjonalna, ukryta przed kupującymi
 Kup teraz          [        ] zł     co najmniej 130% ceny wywoławczej
 ⓘ Jako nowy sprzedawca wystawiasz przedmioty o wartości do 500 zł.
 Kupujący przy cenie wywoławczej: zapłaci 4,07 zł + dostawa

                                        [ Wstecz ]  [ Dalej ]
```

| Stan | Zachowanie |
|---|---|
| Ładowanie szkicu | Szkielet kreatora |
| Szkic nie istnieje albo cudzy | 404 |
| Aukcja z ofertami / zakończona | Komunikat „Tej aukcji nie można już edytować” i link do Moich aukcji |
| Błąd autozapisu | „Nie udało się zapisać” i ponowienie przy kolejnej zmianie |
| Braki przy publikacji | Lista braków z linkami do kroków, błędy przy polach |
| Brak zweryfikowanego telefonu | Podgląd z przyciskiem „Zweryfikuj telefon” zamiast „Opublikuj” |

Dostępność: każdy krok ma nagłówek (fokus przenosi się na niego przy zmianie kroku), pasek postępu to lista z `aria-current="step"`, błędy pól przez `aria-describedby`, układ od 360 px.

## Model danych

Migracje `0010_listing` (tabele i kolumny), `0011_initial_carriers` (dane):

- `items` (moduł `catalog`): `id`, `seller_id`, `category_id` (FK w module, null w szkicu), `title`, `description`, `condition`, `brand`, `attributes` (JSONB), `package_size`, `weight_grams`, `length_cm`, `width_cm`, `height_cm`, `allowed_carriers` (`text[]`), `created_at`, `updated_at`. Pola opcjonalne w szkicu.
- `item_media` (moduł `catalog`): `item_id` (FK), `media_id` (bez FK, moduł `media`), `position`. Klucz (`item_id`, `position`), unikalne (`item_id`, `media_id`).
- `auctions` (moduł `auctions`): `id`, `public_id` (8 znaków, do adresu `/a/{slug}-{publicId}` w F-18), `item_id`, `seller_id`, `type` (`TIMED`), `status`, `currency`, `start_price`, `reserve_price`, `buy_now_price`, `duration_days`, `current_price`, `leader_id`, `leader_max_amount`, `bid_count`, `review_reasons` (`text[]`), `starts_at`, `ends_at`, `original_ends_at`, `published_at`, `cancelled_at`, `version`, `created_at`, `updated_at`. Kwoty w groszach (`bigint`). Indeksy: (`seller_id`, `status`), aktywne po `ends_at` (dla F-16).
- `shipping_carriers` (moduł `shipping`): `id` (np. `inpost-paczkomat`), `name`, `kind` (`LOCKER`/`PICKUP_POINT`/`COURIER`), `package_sizes` (`text[]`), `position`, `is_active`. Start: InPost Paczkomat 24/7 (S, M, L), InPost Kurier (S–XL), Orlen Paczka (S, M, L), DPD Pickup (S, M, L), DPD Kurier (S–XL).
- `users`: `listing_blocked_until`, `seller_kyc_notice_accepted_at`.

## API i zdarzenia

- `POST /v1/auctions` → 201 `ListingDto` (pusty szkic). Limit szkiców: 409 `CONFLICT`.
- `GET /v1/me/auctions?status=` → `AuctionSummaryDto[]` (najnowsze najpierw, maks. 100).
- `GET /v1/me/auctions/{id}` → `ListingDto` (przedmiot, zdjęcia z adresami, ceny z minimalną, statusy, `editable`, `bidCount`). Cudza albo nieistniejąca: 404.
- `PATCH /v1/auctions/{id}` → `ListingDto`. Ciało częściowe (`null` czyści pole). Szkic: tylko format pól. Aktywna bez ofert: pełna walidacja. Z ofertami: 409 `AUCTION_HAS_BIDS`; zakończona albo anulowana: 409 `CONFLICT`.
- `DELETE /v1/auctions/{id}` → 204 (tylko szkic).
- `POST /v1/auctions/{id}/publish` `{ kycNoticeAccepted? }` → `ListingDto` (`ACTIVE` albo `PENDING_REVIEW`). Wymaga zweryfikowanego telefonu. Błędy: 400 `VALIDATION_FAILED` (pola), 403 `LISTING_BLOCKED`, 409 `LISTING_LIMIT_REACHED`, 409 `CONFLICT` (nie szkic).
- `POST /v1/auctions/{id}/cancel` → `ListingDto` (`CANCELLED`). Błędy: 409 `AUCTION_CANCEL_TOO_LATE`, 409 `CONFLICT`.
- `POST /v1/auctions/{id}/relist` → 201 `ListingDto` (nowy szkic).
- `GET /v1/me/selling-limits` → poziom, limit i liczba aktywnych aukcji, maks. wartość aukcji, próg KYC, status KYC, blokada wystawiania, czy potwierdzono informację o KYC.
- `GET /v1/shipping/carriers` → przewoźnicy z gabarytami (publiczne, cache 5 min).
- Nowe kody błędów: `LISTING_BLOCKED` (403), `LISTING_LIMIT_REACHED` (409), `AUCTION_HAS_BIDS` (409), `AUCTION_CANCEL_TOO_LATE` (409).
- Eventy (outbox): `AuctionPublished`, `AuctionSubmittedForReview`, `AuctionUpdated`, `AuctionCancelled` (konsumenci: wyszukiwarka F-19, powiadomienia, strike'i F-61, moderacja F-35).

## Reguły biznesowe i przypadki brzegowe

- Publikacja, edycja i anulowanie blokują wiersz aukcji (`FOR UPDATE`) na czas całej operacji, a sprawdzenie liczby ofert jest w tej samej transakcji. F-15 blokuje ten sam wiersz przy ofercie, więc edycja nie przeplecie się z pierwszą ofertą.
- Podwójne kliknięcie „Opublikuj”: druga próba widzi status `ACTIVE` i dostaje 409.
- Limit aktywnych aukcji liczony w transakcji publikacji (blokada doradcza na sprzedającego), więc dwie równoległe publikacje nie przekroczą limitu.
- Wartość aukcji: najwyższa z ceny wywoławczej, minimalnej i Kup teraz; cena końcowa może przekroczyć limit w toku licytacji (§4.1).
- Czas: `ends_at` liczony w bazie (`now()`), jak cały czas aukcji (§6.5).
- Ponowne wystawienie kopiuje przedmiot (nowy wiersz), więc zmiany w kopii nie dotykają historii zakończonej aukcji (zamówienie i tak ma snapshot, F-16).

## Bezpieczeństwo i prywatność

- Szkic, cena minimalna i lista „Moje aukcje” tylko dla sprzedającego (cudze: 404, bez ujawniania istnienia).
- Zdjęcia: tylko własne i gotowe (`MediaService.attach` sprawdza właściciela i status).
- Treści użytkownika (tytuł, opis) jako zwykły tekst; React je escapuje. Filtr słów nie zastępuje moderacji i zgłoszeń (F-35).
- Limity i blokady chronią przed oszustami-sprzedawcami (§16.2).

## Analityka

PostHog (po zgodzie): `listing_started`, `listing_step_completed` (`step`), `listing_published` (`categoryId`, `durationDays`, `hasBuyNow`, `hasReserve`, `status`), `listing_publish_failed` (`codes`), `auction_cancelled` (`withBids`), `auction_relisted`.

## Kryteria akceptacji

- [x] Given szkic bez wymaganych pól, When publikacja, Then API odrzuca ją z błędem każdego brakującego pola, a kreator pokazuje braki przy krokach.
- [x] Given Kup teraz poniżej 130% ceny wywoławczej albo poniżej ceny minimalnej, Then publikacja (i walidacja w kreatorze) jest odrzucana.
- [x] Given nowe konto z 5 aktywnymi aukcjami albo aukcja o wartości powyżej 500 zł, Then publikacja jest odrzucana (`LISTING_LIMIT_REACHED`, błąd pola ceny).
- [x] Given aukcja o wartości powyżej 1000 zł i sprzedawca bez pozytywnego KYC, Then publikacja jest odrzucana (blokada aktywna od F-32).
- [x] Given aukcja z co najmniej jedną ofertą, Then zmiana ceny, opisu, zdjęć (i pozostałych pól) jest odrzucana z `AUCTION_HAS_BIDS`.
- [x] Given pierwsza publikacja, Then sprzedający widzi informację o weryfikacji tożsamości i bez jej potwierdzenia nie opublikuje aukcji; potwierdzenie jest zapisane z datą.
- [x] Given aktywna blokada wystawiania, Then publikacja zwraca `LISTING_BLOCKED` z datą końca.
- [x] Given zakazane słowo w tytule albo opisie, Then publikacja jest odrzucana; słowo niejednoznaczne albo kategoria z ograniczeniami kieruje aukcję do moderacji (`PENDING_REVIEW`).
- [x] Given zakończona albo anulowana aukcja, When „Wystaw ponownie”, Then powstaje szkic z kopią przedmiotu i parametrów.
- [x] Given aukcja z ofertami w ostatnich 12 h, Then anulowanie jest odrzucane; wcześniej anulowanie emituje `AuctionCancelled` z liczbą ofert.

## Plan testów

- **Shared, jednostkowe:** `validateListing` (każde pole, gabaryt i przewoźnicy, brand-sensitive, reguły cen na granicach: 130%, cena minimalna, 1 zł), wartość aukcji.
- **API, jednostkowe:** filtr słów (normalizacja, polskie znaki, zamiany cyfr, całe słowa, brak fałszywych trafień typu „pistolet do kleju” → `REVIEW`, nie `BLOCK`).
- **API, integracyjne (Postgres, Redis, RustFS):** szkic (tworzenie, autozapis, zdjęcia przypisane i zwolnione, usuwanie, limit), publikacja (komplet błędów pól, telefon, KYC notice, limity wartości i liczby, blokada, filtr słów, kategoria z ograniczeniami, eventy, `ends_at`), edycja aktywnej (bez ofert, z ofertami), anulowanie (bez ofert, z ofertami, 12 h), ponowne wystawienie, cudza aukcja (404), przewoźnicy z migracji, równoległa publikacja przy limicie.
- **Web, jednostkowe:** kroki kreatora (walidacja kroku, autozapis z debounce i stanami, przewoźnicy według gabarytu, wymiary dla XL, parsowanie cen, błędy z API przypisane do kroków, potwierdzenie KYC przy pierwszej publikacji).
- **Web, e2e (atrapa API):** pełna ścieżka od nowego szkicu do publikacji, błędy z API przy publikacji, Moje aukcje (anulowanie, ponowne wystawienie), axe-core i szerokość 360 px.

## Otwarte pytania

- Lista słów filtra: **domyślnie** startowa lista z §17 (zakazane przedmioty), strojona z moderatorami w F-35.
- Minimalna liczba zdjęć w kategoriach narażonych na podróbki: **domyślnie** 4 (propozycja z F-11).
- Godzina końca aukcji (np. wybór pory wieczornej): **domyślnie** czas publikacji + czas trwania; wybór godziny razem z planowanym startem w v1.
