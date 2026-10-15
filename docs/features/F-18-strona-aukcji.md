# F-18 · Strona aukcji

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-10, F-12, F-13, F-14, F-15, F-16, F-17

## Kontekst i cel

Strona aukcji sprzedaje przedmiot i jest miejscem licytacji ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety), [§11.3](../PROJECT.md#113-web-appsweb)). Musi się szybko ładować na telefonie i dobrze indeksować: HTML bez JavaScriptu pokazuje aktualną cenę (nie starszą niż ok. 10 s od ostatniej oferty), a strona po załadowaniu aktualizuje cenę i licznik na żywo (F-17). Przed każdą ofertą kupujący widzi cenę łączną z Pakietem Ochrony Kupujących (F-13, [§17](../PROJECT.md#17-prawo-i-compliance): Omnibus i lekcja z decyzji UOKiK wobec Vinted).

F-18 dodaje publiczny widok aukcji w API, stan licytacji zalogowanego użytkownika, stronę `/a/{slug}-{publicId}` z ISR i rewalidacją na żądanie po zdarzeniach aukcji oraz panel licytacji (oferta z maksimum, Kup teraz, stany aukcji i użytkownika).

## Historyjki użytkownika

- Jako kupujący chcę zobaczyć zdjęcia, opis, stan, atrybuty i sposób dostawy, żeby ocenić przedmiot.
- Jako kupujący chcę wiedzieć, kim jest sprzedawca i czy jest osobą prywatną (jakie prawa mi przysługują).
- Jako licytujący chcę podać swoje maksimum i przed potwierdzeniem zobaczyć, ile najwyżej zapłacę razem z POK.
- Jako licytujący chcę widzieć na żywo cenę, licznik do końca i to, czy prowadzę albo ktoś mnie przebił.
- Jako zwycięzca chcę po zakończeniu zobaczyć, że wygrałem, ile i do kiedy mam zapłacić.
- Jako osoba z wyszukiwarki albo z linku w mediach społecznościowych chcę od razu zobaczyć aktualną cenę i zdjęcie przedmiotu.

## Zakres

### API

- **`GET /v1/auctions/{id}`** (publiczne, `id` = UUID albo `publicId`): aukcje `ACTIVE`, `ENDED_SOLD`, `ENDED_UNSOLD` i `CANCELLED`. Szkic, aukcja w moderacji i aukcja zablokowanego sprzedawcy: 404. Treść (`PublicAuctionDto`):
  - przedmiot: tytuł, `slug`, opis, stan, marka, kategoria ze ścieżką (`{ id, slug, name }` od korzenia), atrybuty do wyświetlenia (etykieta i wartość według aktualnych definicji kategorii, F-11), zdjęcia gotowe (`READY`) z adresami wariantów, gabaryt i akceptowani przewoźnicy (nazwa, rodzaj);
  - sprzedawca: ID, imię wyświetlane, zdjęcie profilowe, data dołączenia, zweryfikowany telefon, rodzaj `PRIVATE` (w MVP tylko osoby prywatne, §17);
  - licytacja: status, cena wywoławcza, aktualna cena, liczba ofert, zanonimizowany lider, minimalna kolejna oferta, stan ceny minimalnej, cena Kup teraz (tylko gdy dostępne), start, koniec, `version`, okno anti-snipingu w sekundach (`extensionWindowSeconds`), `serverTime`.
  - Bez maksimów, ceny minimalnej i identyfikatorów licytujących.
- **`GET /v1/me/bids/{auctionId}`** (sesja): stan zalogowanego użytkownika w aukcji: czy to jego aukcja, czy licytował, czy prowadzi, jego maksimum, wynik po zakończeniu (`WON`/`LOST`) i zamówienie zwycięzcy (numer, kwota łączna, termin płatności).
- **Rewalidacja strony:** po `AuctionPublished`, `AuctionUpdated`, `BidPlaced`, `BidCancelled`, `AuctionEnded` i `AuctionCancelled` worker planuje job `auction.revalidate-page` w nowej kolejce `web`, w oknie 5 s na aukcję: ID joba zawiera koniec okna (`revalidate-page-{auctionId}-{koniecOkna}`), więc zdarzenia z jednego okna dają jeden job, wykonany na końcu okna (maks. raz na 5 s, opóźnienie do 5 s). Job woła `POST {WEB_URL}/api/revalidate` z sekretem `WEB_REVALIDATE_SECRET` i tagiem `auction:{publicId}`. `AuctionExtended` nie ma osobnego konsumenta: przedłużenie zawsze idzie z `BidPlaced` w tej samej transakcji.

### Wspólne (`@biddy/shared`)

- `auctionSlug(title)`: małe litery, polskie znaki bez ogonków, myślniki, do 60 znaków (cięcie na granicy słowa); `auctionPath(slug, publicId)` → `/a/{slug}-{publicId}`; `parseAuctionPath(param)` → `publicId` albo null; `auctionCacheTag(publicId)` → `auction:{publicId}`. Te same adresy w web, mobile, e-mailach i sitemapie.

### Web

- **Strona `/a/[slug]`** (Server Component, bez ciasteczek): ISR z `revalidate` 60 s i tagiem `auction:{publicId}` przy pobraniu aukcji. Adres z nieaktualnym slugiem (zmiana tytułu przed pierwszą ofertą) przekierowuje na kanoniczny (308). Nieznana aukcja: 404.
- **Route Handler `POST /api/revalidate`:** `Authorization: Bearer {WEB_REVALIDATE_SECRET}`, treść `{ tags: string[] }` (do 20 tagów, tylko `auction:{publicId}`), `revalidateTag(tag, { expire: 0 })`: następne żądanie renderuje stronę od nowa zamiast podawać starą wersję. Bez skonfigurowanego sekretu: 503.
- **Układ:** okruszki kategorii, tytuł, galeria (zdjęcie główne z wariantami 800/1600 px, `fetchpriority="high"`, miniatury, poprzednie/następne), panel licytacji (na desktopie obok galerii, przyklejony), opis, atrybuty i stan, dostawa (gabaryt, przewoźnicy), sprzedawca (zdjęcie, imię z linkiem do profilu, data dołączenia, zweryfikowany telefon, oceny: „Brak ocen” do F-30, informacja o osobie prywatnej), historia ofert.
- **Panel licytacji** (komponent kliencki, startuje ze stanem z HTML):
  - cena (aktualna albo wywoławcza „Cena wywoławcza”), liczba ofert, lider, stan ceny minimalnej, licznik do końca z zegara serwera (`useServerClock`, F-06/F-17) i data końca;
  - pole „Twoje maksimum” (zł) z podpowiedzią minimalnej oferty i ceną łączną pod polem (`TotalPrice`, rodzaj `maxBid`), przycisk „Licytuj” → okno potwierdzenia z ceną łączną → `POST /bids` z `Idempotency-Key` (ten sam klucz przy ponowieniu tej samej próby);
  - Kup teraz: przycisk z ceną, cena łączna (`buyNow`), okno potwierdzenia → `POST /buy-now`;
  - na żywo: `useAuctionChannel` aktualizuje stan (starsze `version` ignorowane), `user.outbid` i `user.won` odświeżają stan użytkownika, po reconnect stan pobierany przez REST;
  - komunikaty o zmianach (prowadzisz, przebito Cię, przedłużono, koniec) w regionie `aria-live="polite"`; sam licznik nie jest ogłaszany co sekundę.
- **Stany panelu:**

| Stan | Kiedy | Panel |
|---|---|---|
| Przed startem | `startsAt` w przyszłości (planowany start w v1) | „Start {data}”, bez formularza |
| Aktywna | `ACTIVE`, przed końcem | formularz oferty, Kup teraz (jeśli dostępne) |
| Końcówka | ostatnie `extensionWindowSeconds` (domyślnie 2 min) | wyróżniony licznik i „Oferta teraz przedłuży aukcję o 2 min” |
| Kończenie | `ACTIVE`, czas minął, zamknięcie w toku (F-16) | „Aukcja się kończy…”, bez formularza |
| Zakończona | `ENDED_SOLD` / `ENDED_UNSOLD` / `CANCELLED` | „Sprzedano za X” / „Zakończona bez sprzedaży” / „Aukcja anulowana” |
| Wygrana | `WON` | kwota łączna i termin płatności z zamówienia (link do płatności w F-25) |
| Przegrana | `LOST` / `RESERVE_NOT_MET` | „Nie udało się wygrać tej aukcji” (przy nieosiągniętej cenie minimalnej: z tym powodem) |
| Prowadzisz / Przebito Cię | licytował, aukcja aktywna | twoje maksimum albo zachęta do wyższej oferty |
| Twoja aukcja | sprzedający | „To Twoja aukcja” i link do Moich aukcji, bez formularza |
| Gość | brak sesji | „Zaloguj się, aby licytować” (powrót na stronę aukcji) |
| Bez telefonu | brak zweryfikowanego telefonu | zachęta do weryfikacji telefonu zamiast przycisku licytacji |
| Bez regulaminu | brak akceptacji aktualnego regulaminu | link do akceptacji regulaminu |

- **Historia ofert:** zanonimizowani licytujący, kwota, czas, oferta automatyczna albo Kup teraz; 50 najnowszych i „Pokaż starsze”; odświeżana po zmianie liczby ofert. Pobierana w przeglądarce (nie wydłuża renderowania strony).
- **SEO:** tytuł i opis strony z przedmiotu, adres kanoniczny, schema.org `Product` z `Offer` (cena aktualna albo wywoławcza, waluta, dostępność: `InStock` dla aktywnej, `SoldOut` po sprzedaży, `OutOfStock` w pozostałych przypadkach; stan przedmiotu; `priceValidUntil` = koniec aukcji; sprzedawca jako `Person`). Obrazek OG: zdjęcie główne (wariant 1600 px). Aukcja anulowana: `noindex`.

## Poza zakresem

- Cennik dostaw i „dostawa od” (F-24): strona pokazuje akceptowanych przewoźników, a cena łączna jest bez dostawy.
- Oceny sprzedawcy (F-30), obserwowanie aukcji (F-20), pytania do aukcji (v1), zgłaszanie aukcji (F-35).
- Płatność i strona zamówienia (F-25, F-26); w F-18 tylko informacja o zamówieniu zwycięzcy.
- Sitemap aukcji i strony kategorii (F-19).
- Pomiar LCP na stagingu (kryterium poniżej) zrobimy po wdrożeniu; lokalnie bez Lighthouse.

## UX

- Mobile: galeria na całą szerokość, pod nią cena i licznik; przycisk „Licytuj” w panelu pod galerią (bez przyklejonego paska w MVP). Desktop: dwie kolumny (galeria i opis po lewej, panel po prawej, przyklejony).
- Licznik: „2 dni 4 h”, „3 h 12 min”, w ostatniej godzinie „12:04” (min:s). Przed hydracją (HTML) tylko data i godzina końca, bez licznika (unikamy niezgodności SSR i zegara przeglądarki).
- Potwierdzenie oferty: „Licytujesz do 500 zł. Zapłacisz najwyżej 537,99 zł (z Pakietem Ochrony Kupujących) + dostawa.” i przyciski „Potwierdź ofertę” / „Anuluj”. Oferta jest wiążąca (regulamin).
- Odpowiedź API: prowadzisz → „Prowadzisz. Twoje maksimum: 500 zł”; nie prowadzisz (inne maksimum wyższe) → „Ktoś ma wyższe maksimum. Najniższa oferta to X.” i pole gotowe do nowej oferty. Błędy z API (F-15) przy polu kwoty.
- Dostępność: WCAG 2.1 AA, galeria z przyciskami i etykietami („Zdjęcie 2 z 5”), licznik `role="timer"`, okna potwierdzenia z fokusem (Radix AlertDialog).

## Model danych

Brak zmian w bazie.

## API i zdarzenia

- `GET /v1/auctions/{id}` → `PublicAuctionDto` (`cache-control: no-store`; stronę cache'uje ISR w web).
- `GET /v1/me/bids/{auctionId}` → `MyBiddingDto` (sesja; 404 dla aukcji niepublicznej).
- Kolejka `web` (współbieżność 5, domyślne ponowienia): job `auction.revalidate-page` `{ auctionId }`.
- Konsumenci eventów `auctions.page-*` (po jednym na event z listy wyżej).
- Konfiguracja: `WEB_REVALIDATE_SECRET` w workerze (wymagana na produkcji) i w web (Vercel). Adres web: istniejące `WEB_URL`.

## Reguły biznesowe i przypadki brzegowe

- HTML z ceną: ISR (60 s) i rewalidacja w ciągu ok. 5 s od zdarzenia (okno + outbox), więc cena w HTML jest nie starsza niż ok. 10 s.
- Stan panelu po hydracji: z HTML (może mieć do 60 s), potem `auction.updated` i odświeżenie przez REST przy subskrypcji, więc licytujący widzi aktualny stan.
- Licznik dochodzi do zera, ale aukcję kończy serwer (F-16); do `auction.ended` panel pokazuje „Aukcja się kończy…”. Oferta złożona w ostatniej sekundzie może zostać odrzucona (`AUCTION_ENDED`), bo decyduje czas bazy.
- Kup teraz znika po pierwszej ofercie (`buyNowAvailable`).
- Sprzedający widzi swoją aukcję bez formularza; API i tak odrzuca ofertę (`OWN_AUCTION`).
- Zmiana tytułu przed pierwszą ofertą zmienia slug; stary adres przekierowuje na nowy.
- Zablokowany sprzedawca: aukcja niedostępna (404) do czasu decyzji moderacji (F-61).

## Bezpieczeństwo i prywatność

- Widok publiczny bez maksimów, ceny minimalnej i identyfikatorów licytujących; lider i historia zanonimizowane (F-15).
- Rewalidacja tylko z sekretem (porównanie w stałym czasie) i tylko dla tagów aukcji; tagi z treści żądania walidowane.
- Strona ISR nie czyta ciasteczek: dane użytkownika (maksimum, wygrana) pobiera przeglądarka z sesją, więc nie trafiają do cache.
- JSON-LD z treści użytkownika z escapowaniem `<` (bez wstrzyknięcia `</script>`).

## Analityka

PostHog (po zgodzie): `auction_viewed` (`auctionId`, `status`), `bid_placed` (`leading`, `firstBid`), `bid_failed` (`code`), `buy_now_completed`.

## Kryteria akceptacji

- [x] Given oferta zatwierdzona w API, Then worker w ciągu ok. 5 s wywołuje rewalidację strony aukcji, a seria ofert w jednym oknie daje jedno wywołanie (test integracyjny z atrapą web).
- [x] Given rewalidacja tagu aukcji, Then HTML strony (bez JavaScriptu) pokazuje nową cenę przy następnym żądaniu (e2e na `next start`).
- [x] Given `auction.updated` przez WebSocket, Then cena, liczba ofert i licznik zmieniają się bez odświeżania strony (e2e z atrapą WebSocket i testy komponentu).
- [x] Given wpisane maksimum, Then przed złożeniem oferty użytkownik widzi cenę łączną z POK (pod polem i w oknie potwierdzenia).
- [x] Given użytkownik bez zweryfikowanego telefonu, Then zamiast przycisku licytacji widzi zachętę do weryfikacji (z powrotem na aukcję).
- [x] Given aukcja zakończona, Then zwycięzca widzi wygraną z kwotą i terminem płatności, inny licytujący przegraną, a gość wynik aukcji.
- [x] Given szkic albo aukcja w moderacji, Then `GET /v1/auctions/{id}` i strona zwracają 404; stary slug przekierowuje na kanoniczny adres.
- [x] Given strona aukcji, Then HTML zawiera schema.org `Product` z `Offer` i obrazek OG ze zdjęciem głównym.
- [ ] LCP < 2,5 s na mobile 4G (pomiar na stagingu po wdrożeniu; zdjęcie główne z `fetchpriority="high"` i wariantem dobranym przez `srcset`).

## Plan testów

- **Shared, jednostkowe:** slug (polskie znaki, długość, puste), ścieżka i jej parsowanie, tag.
- **API, integracyjne:** widok publiczny (pola, brak maksimów i ceny minimalnej, publicId i UUID, 404 dla szkicu, moderacji i zablokowanego sprzedawcy, atrybuty i kategoria), `me/bids` (prowadzenie, przebicie, sprzedający, wygrana z zamówieniem, przegrana, bez sesji 401), rewalidacja (atrapa web: wywołanie po ofercie, nagłówek i tag, jedno wywołanie na okno, brak wywołania bez sekretu).
- **Web, jednostkowe:** panel (stany z tabeli, cena łączna, potwierdzenie i oferta z `Idempotency-Key`, błędy API, zdarzenia na żywo i `version`), licznik, galeria, historia, JSON-LD, Route Handler rewalidacji.
- **Web, e2e (`next start`, atrapa API i WebSocket):** strona z HTML bez JS, przekierowanie sluga, 404, oferta gościa/bez telefonu/zalogowanego z potwierdzeniem, aktualizacja na żywo, rewalidacja HTML, dostępność (axe).

## Otwarte pytania

- Przyklejony pasek „Licytuj” na mobile: **domyślnie** nie w MVP; wrócimy po danych o konwersji z bety.
