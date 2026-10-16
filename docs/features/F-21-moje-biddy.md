# F-21 · Moje Biddy

**Status:** Review
**Rozmiar:** S · **Właściciel:** Mateusz Bienias · **Zależności:** F-14, F-15, F-16, F-17, F-18, F-20

## Kontekst i cel

Licytujący i sprzedający potrzebują jednego miejsca, w którym widzą swoje sprawy: gdzie prowadzą, gdzie ktoś ich przebił, co wygrali i muszą opłacić, co obserwują, co wystawili i co sprzedali ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety)). Każda pozycja mówi, co zrobić dalej („Zalicytuj ponownie”, „Zapłać”, „Nadaj paczkę”, „Wystaw ponownie”).

F-21 dodaje „Moje Biddy” z zakładkami, API list licytacji i obserwowanych, zamówienie przy sprzedanych aukcjach oraz aktualizację list na żywo. Płatność (F-25) i nadanie (F-26) jeszcze nie działają: ich skróty są widoczne, ale nieaktywne z wyjaśnieniem.

## Historyjki użytkownika

- Jako licytujący widzę aukcje, w których prowadzę, i te, w których mnie przebito, z aktualną ceną i czasem do końca.
- Jako zwycięzca widzę wygrane z kwotą do zapłaty i terminem.
- Jako kupujący widzę obserwowane aukcje i mogę przestać obserwować zakończone.
- Jako sprzedający widzę szkice, aktywne i zakończone aukcje oraz sprzedane przedmioty z tym, na co czekam (płatność kupującego).

## Zakres

### API

- **`GET /v1/me/bids?status=ACTIVE|WON|LOST&page=`** (sesja) — aukcje, w których użytkownik ma ważne oferty: `ACTIVE` (aktywne, najbliższy koniec najpierw), `WON` (sprzedane z nim jako liderem, najnowsze najpierw), `LOST` (zakończone bez wygranej, także nieosiągnięta cena minimalna). Pozycja: karta aukcji (tytuł, slug, zdjęcie, status, cena, liczba ofert, koniec), moje maksimum, czy prowadzę, wynik (`NONE`/`WON`/`LOST`/`RESERVE_NOT_MET`), zamówienie zwycięzcy (numer, status, do zapłaty, termin). Po 24 na stronę.
- **`GET /v1/me/watchlist`** (sesja) — obserwowane aukcje (karta aukcji), aktywne najpierw (najbliższy koniec), potem zakończone; najwyżej 100.
- **`GET /v1/me/auctions`** (F-14): przy sprzedanej aukcji pole `order` (numer, status, termin płatności).

### Web (`/moje-biddy`)

- Nawigacja zakładek (linki, `aria-current="page"`): **Licytuję** (`/moje-biddy`; filtr „Wszystkie / Prowadzę / Przebito Cię”), **Wygrane** (`/moje-biddy/wygrane`), **Obserwowane** (`/moje-biddy/obserwowane`), **Moje aukcje** (`/moje-biddy/aukcje`: dotychczasowa strona z F-14; `/konto/aukcje` przekierowuje 308 regułą w `next.config.ts`, z parametrami adresu), **Sprzedane** (`/moje-biddy/sprzedane`).
- Pozycja listy: zdjęcie, tytuł (link do aukcji), cena, liczba ofert, koniec albo wynik i **następna akcja**:

| Sytuacja | Opis | Akcja |
|---|---|---|
| Prowadzę | „Prowadzisz · Twoje maksimum X” | „Zobacz aukcję” |
| Przebito | „Przebito Cię” | „Zalicytuj ponownie” |
| Wygrana, czeka na płatność | „Do zapłaty X do {termin}” | „Zapłać” (nieaktywne: „Płatność online uruchomimy wkrótce”, F-25) |
| Przegrana | „Nie udało się wygrać” / „Cena minimalna nieosiągnięta” | „Szukaj podobnych” |
| Obserwowana, aktywna | cena, koniec | „Licytuj” |
| Obserwowana, zakończona | wynik | „Przestań obserwować” |
| Sprzedana, czeka na płatność | „Czeka na płatność kupującego do {termin}” | brak (czekamy) |
| Sprzedana, opłacona | „Opłacone” | „Nadaj paczkę” (nieaktywne do F-26) |
| Moje aukcje | jak w F-14 | edycja, anulowanie, ponowne wystawienie, usunięcie szkicu |

- **Na żywo:** zdarzenia użytkownika (`user.outbid`, `user.won`, `notification.new`) odświeżają listy; aktywne aukcje na liście (do 50) subskrybują kanał aukcji i aktualizują cenę, liczbę ofert i koniec bez odświeżania.
- Menu użytkownika i strona konta: link „Moje Biddy”.

## Poza zakresem

- Płatność, strona zamówienia i nadanie paczki (F-25, F-26), oferty drugiej szansy, wiadomości (F-29), oceny (F-30), lista obserwowanych sprzedawców.

## UX

- Pusta zakładka: krótki tekst i link („Przeglądaj aukcje”, „Wystaw przedmiot”).
- Data końca aktywnych aukcji jako data i godzina (lista z serwera nie ma licznika).
- Na telefonie zakładki przewijane poziomo.

## Model danych

Brak zmian w bazie.

## API i zdarzenia

- `GET /v1/me/bids` → `MyBidsDto` (`items`, `total`, `page`, `totalPages`); `GET /v1/me/watchlist` → `MyWatchlistDto`; `AuctionSummaryDto.order`.

## Reguły biznesowe i przypadki brzegowe

- Licytacja liczy się tylko z ważnymi ofertami (unieważnione po replayu nie).
- Aukcja anulowana z moimi ofertami: w `LOST` z wynikiem `NONE` i statusem `CANCELLED` („Aukcja anulowana”).
- Zamówienie widzi tylko kupujący (wygrane) albo sprzedający (sprzedane).

## Bezpieczeństwo i prywatność

- Listy tylko dla zalogowanego właściciela; bez maksimów innych licytujących.

## Analityka

Brak nowych zdarzeń (otwarcie aukcji z listy liczy `auction_viewed`).

## Kryteria akceptacji

- [x] Given zakładka „Licytuję”, Then widać aukcje z ofertami użytkownika z podziałem na prowadzę/przebito i odpowiednią akcją.
- [x] Given przebicie albo nowa oferta w aukcji z listy, Then lista aktualizuje się na żywo (zdarzenia realtime).
- [x] Given wygrana, Then pozycja pokazuje kwotę, termin płatności i akcję „Zapłać” (aktywną po F-25).
- [x] Given sprzedana aukcja, Then pozycja pokazuje stan zamówienia i następny krok sprzedającego.
- [x] Given obserwowana zakończona aukcja, Then da się przestać ją obserwować.
- [x] Given `/konto/aukcje`, Then przekierowuje na `/moje-biddy/aukcje`.

## Plan testów

- **API, integracyjne:** `me/bids` (aktywne: prowadzę/przebity, wygrana z zamówieniem, przegrana, nieosiągnięta cena minimalna, unieważnione oferty pominięte, bez sesji 401), `me/watchlist` (kolejność, zakończone), `me/auctions` z zamówieniem.
- **Web, jednostkowe:** następna akcja dla każdej sytuacji, filtr prowadzę/przebito, aktualizacja na żywo, przestań obserwować.
- **Web, e2e:** zakładki i nawigacja, lista licytacji z akcjami, aktualizacja przez WebSocket, przekierowanie `/konto/aukcje`, dostępność (axe).

## Otwarte pytania

Brak.
