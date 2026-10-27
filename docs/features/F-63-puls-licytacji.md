# F-63 · Puls licytacji: nowy UI/UX web

**Status:** Review (etapy 1–4 gotowe; decyzje D1–D5 przyjęte 2026-10-26, w rejestrze PROJECT.md §22 nr 101–105)
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-62 (design system), F-17 (realtime), F-18 (strona aukcji), F-19 (wyszukiwarka), F-21 (Moje Biddy), F-24 (nadanie paczki)

## Kontekst i cel

F-62 przeniósł design system Biddy do kodu: tokeny, komponenty bazowe i nowy wygląd wszystkich tras. Aplikacja wygląda spójnie, ale licytacja nadal jest „cicha”. Przebicie oferty to jedna linijka tekstu w panelu i tylko na stronie aukcji, cena zmienia się bez sygnału, a koniec aukcji nie różni się od każdej innej chwili. Licytacje budzą emocje i interfejs ma je oddawać, nie tracąc przy tym zaufania, którego wymagają pieniądze.

Źródłem jest **projekt widoków „Puls licytacji”** (płótno: <https://claude.ai/artifact/FrxraaqD7Jncbjw4oN1Ra7>): 31 ekranów na design systemie Biddy, w tym klikalny prototyp strony aukcji. F-63 wdraża go w `apps/web` na fundamencie z F-62. Nie zmienia marki, tokenów ani logiki biznesowej. Dokłada warstwę sygnałów na żywo i przebudowuje układ widoków tam, gdzie płótno tego wymaga.

## Historyjki użytkownika

- Jako licytujący od razu wiem, że ktoś mnie przebił, nawet jeśli jestem na innej stronie, i mogę przebić ofertę jednym ruchem.
- Jako licytujący czuję, że aukcja żyje: widzę, jak rośnie cena, kiedy przybywa ofert i ile zostało czasu w ostatniej godzinie.
- Jako osoba, która wygrała, mam chwilę satysfakcji i od razu widzę, co dalej.
- Jako kupujący na stronie głównej i w wyszukiwarce najpierw widzę aukcje, które zaraz się kończą.
- Jako sprzedawca widzę, które z moich aukcji są gorące i co mam zrobić z każdą sprzedaną rzeczą.
- Jako osoba wrażliwa na ruch albo korzystająca z czytnika ekranu dostaję te same informacje bez animacji i bez podwójnych komunikatów.

## Zakres

Wdrożenie w czterech etapach; każdy kończy się działającą aplikacją, zielonymi testami i osobnym commitem. Etap 1 buduje komponenty, z których korzystają kolejne. Etapy 2–4 nie zależą od siebie. Stany ładowania, puste i błędy każdego widoku robimy w etapie, w którym jest ten widok (płótno: „Ładowanie, puste stany i błędy”). Wersja na telefon (360–759 px) jest częścią każdego etapu, nie osobną pracą.

### Etap 1 · Licytacja na żywo

**Płótno:** Strona aukcji (prototyp), Komponenty: puls licytacji, Panel licytacji: stany, Potwierdzenie oferty i alerty na żywo, Moment wygranej, Telefon: aukcja, Telefon: przebito Cię. **Trasa:** `/a/[slug]` i globalny system powiadomień na ekranie.

- **Komponenty pulsu** (`components/auction` albo `components/ui`, według zasięgu użycia):
  - `Countdown`: tony z F-62 (≥ 24 h spokojny, < 24 h fioletowy, < 1 h czerwony) plus wariant segmentowy (gg:mm:ss w kafelkach) w ostatniej godzinie;
  - `PriceTicker`: cena z plakietką przyrostu („+10 zł”) i krótkim podświetleniem po zmianie z realtime;
  - `LiveBadge`: pulsująca kropka i „LIVE” dla aukcji w ostatniej godzinie;
  - `BidStateBar`: paski stanu użytkownika (prowadzisz, przebito Cię, wygrana, koniec bez wygranej) z ikoną i tekstem;
  - `QuickBidAmounts`: trzy szybkie kwoty (reguła niżej);
  - `PriceSparkline`: mały wykres ceny z pierwszej strony historii ofert (bez zmian w API).
- **Panel licytacji** w sześciu stanach z płótna: pierwsza oferta, prowadzisz, przebito Cię, ostatnie minuty / przedłużona, wygrana, gość. Pole kwoty z szybkimi kwotami, dialog potwierdzenia z obecnym `TotalPrice` (ochrona kupujących), komunikat o przedłużeniu aukcji.
- **Toasty na żywo:** komponent `Toast` na `radix-ui` (już w zależnościach) i jeden `Toaster` w `AppProviders`:
  - na stronie aukcji: przebito Cię (z „Zalicytuj ponownie”, które przenosi fokus do pola kwoty z wpisaną minimalną ofertą), prowadzisz, przedłużono, kończy się (5 minut do końca, tylko gdy użytkownik licytuje albo obserwuje);
  - na pozostałych stronach (zalogowani): przebito Cię, wygrana i koniec obserwowanej aukcji z linkiem do aukcji, z powiadomień na żywo (`notification.new` typu `OUTBID`, `WON`, `ENDING_SOON` w room `user:{id}`).
- **Historia ofert:** nowy wpis wjeżdża na górę listy i jest krótko podświetlony.
- **Wygrana:** panel na stronie aukcji, a nie osobny ekran (D2); na telefonie na pełną szerokość. Fiolet 600 → 800, „Wygrana!”, cena końcowa, trzy kroki „Co dalej”. Do czasu F-25 akcja prowadzi do zamówienia w Moje Biddy, a nie do płatności.
- **Telefon:** pasek licytacji przyklejony do dołu ekranu i dolny arkusz „Przebito Cię” z szybkimi kwotami.
- **Licznik oglądających** (D1, ostatni punkt etapu): „X osób ogląda” na zdjęciu aukcji, obok LIVE i „Gorąca aukcja”.

### Etap 2 · Przeglądanie

**Płótno:** Strona główna, Wyszukiwarka i kategoria, Profil sprzedawcy, Telefon: strona główna. **Trasy:** `/`, `/szukaj`, `/kategoria/[...path]`, `/u/[id]`, nagłówek i stopka.

- **Karta aukcji** (`AuctionCard`) według płótna: licznik w tonie z etapu 1, `LiveBadge`, liczba ofert, plakietka „Kup teraz”, oznaczenie gorącej aukcji. Jedna karta we wszystkich listach.
- **Strona główna:** hero z kartą aukcji kończącej się najwcześniej (z ceną i licznikiem na żywo), ciemny pas „Kończą się wkrótce” (D3), kafelki nisz, „Nowe aukcje”, „Jak działa licytacja”, kategorie, „Dlaczego Biddy”.
- **Wyszukiwarka i kategoria:** pigułki sortowania nad wynikami, pasek „N aukcji kończy się w ciągu godziny” (link do sortowania po końcu), chipy aktywnych filtrów z usuwaniem, panel filtrów i paginacja w nowym układzie.
- **Profil sprzedawcy:** okładka, karta profilu, statystyki z danych, które już mamy (członek od, weryfikacja telefonu, liczba aktywnych aukcji), siatka aukcji. Sekcja ocen zostaje w obecnej formie do F-30.
- **Telefon:** dolny pasek nawigacji poniżej 760 px (Start, Szukaj, Wystaw, Moje Biddy, Konto) zamiast menu z design systemu; menu konta zostaje w nagłówku (D4).

### Etap 3 · Moje Biddy, konto i powiadomienia

**Płótno:** Moje Biddy: licytuję, Moje Biddy: moje aukcje i sprzedane, Powiadomienia, Moje konto, Profil i adresy, Ustawienia powiadomień, Telefon: Moje Biddy. **Trasy:** `/moje-biddy`, `/moje-biddy/{aukcje,obserwowane,sprzedane,wygrane}`, `/powiadomienia`, `/konto`, `/konto/profil`, `/konto/adresy/*`, `/konto/powiadomienia`.

- **Licytuję:** kafelki podsumowania (licytujesz, prowadzisz, przebito Cię, kończą się w ciągu doby) z dokładnymi liczbami z API (lista ma strony po 24), filtr jako `SegmentedControl`, wiersze z paskiem stanu w tonie `BidStateBar` (przebito Cię: czerwona ramka i nagłówek) i licznikiem w tonie z etapu 1, ceny „Aktualna cena” i „Twoje maksimum”, akcja przebicia w wierszu „przebito Cię”, zwarta sekcja „Nie udało się wygrać” na dole.
- **Moje aukcje i sprzedane:** ciemna karta „Twoja aukcja jest gorąca” nad listą (najgorętsza aktywna aukcja sprzedawcy według `isHotAuction`: najwięcej ofert, przy remisie najbliższy koniec; cena na żywo z kanału aukcji), filtry z liczbą pozycji, nagłówek karty zależny od stanu: trwa licytacja (LIVE i licznik), aktywna bez ofert (edycja, anulowanie), szkic, w moderacji, bez sprzedaży (wystaw ponownie), anulowana. Sprzedane zostają osobną zakładką (jak dziś) i dostają zwarte wiersze z następnym krokiem w tonie (nadaj paczkę, czeka na płatność, w drodze i pozostałe stany zamówienia po polsku).
- **Powiadomienia:** grupy „Dzisiaj” i „Wcześniej” (dzień w strefie Europe/Warsaw), liczba nowych przy tytule, wyraźny stan nieprzeczytanego (kropka, tło i pogrubiony tytuł), ikona w tonie typu powiadomienia. Wiersz zostaje jednym linkiem do aukcji (bez przycisków w środku).
- **Konto, profil i adresy:** układ z płótna na `canvas` z białymi kartami (szerokość jak Moje Biddy), karta konta z e-mailem i telefonem w kafelkach, skróty z opisami, karta „Bezpieczeństwo” z wylogowaniem; profil z awatarem obok formularza; karty adresów w siatce z domyślnym w obramowaniu marki i kafelkiem „Dodaj adres”, błędy pól jak w F-62.
- **Ustawienia powiadomień:** grupy (licytacje, sprzedaż, obserwowani sprzedawcy) w kartach, przełączniki (`role="switch"`, Radix) zamiast pól wyboru, kanały, których nie da się wyłączyć, oznaczone „Zawsze wysyłamy” z kłódką (bez kontrolki), jeden komunikat „Zapisano” pod listą.
- **Telefon:** jak płótno „Telefon: Moje Biddy”: zakładki przewijane w poziomie, filtr na całą szerokość, karty z akcją na całą szerokość, bez przycisku „Wystaw przedmiot” w nagłówku (jest w dolnym pasku).

### Etap 4 · Logowanie, wystawianie i wysyłka

**Płótno:** Logowanie, Rejestracja, Weryfikacja telefonu, Hasło, e-mail, regulamin, wypisanie, Wystaw: start i szkice, Kreator 1–6, Nadaj paczkę, Ładowanie, puste stany i błędy. **Trasy:** `/logowanie`, `/rejestracja`, `/weryfikacja-telefonu`, `/reset-hasla`, `/nowe-haslo`, `/weryfikacja-email`, `/akceptacja-regulaminu`, `/wypisz`, `/wystaw`, `/wystaw/[id]`, `/zamowienia/[publicId]/nadaj`, `not-found`, `error`.

- **Logowanie i rejestracja:** dopracowanie układu z F-62 według płótna. Nagłówek i stopka strony zostają.
  - Panel marki od 1024 px: gradient, hasło, przykładowa karta aukcji z LIVE (dekoracja, ukryta przed czytnikiem), przy logowaniu trzy korzyści, przy rejestracji ścieżka „Załóż konto → potwierdź e-mail → zweryfikuj telefon → licytuj”.
  - Kolejność: logowanie przez Google i Apple na górze (tylko dostawcy włączeni w API; na rejestracji zwarte kafelki), separator „albo e-mailem”, pola, CTA, link do drugiej strony.
  - „Nie pamiętasz hasła?” przy etykiecie hasła, przycisk pokazania hasła (`aria-pressed`), przy nowym haśle reguła długości sprawdzana na bieżąco (ikona i tekst, nie sam kolor).
- **Pozostałe strony kont** (`/reset-hasla`, `/nowe-haslo`, `/weryfikacja-email`, `/akceptacja-regulaminu`, `/wypisz`, `/weryfikacja-telefonu`): karta na środku tła `canvas` z kafelkiem ikony nad tytułem; wynik akcji (wysłano link, zmieniono hasło, potwierdzono e-mail, zły link) w tej samej karcie.
- **Weryfikacja telefonu:** postęp „E-mail, Telefon, Licytujesz” nad kartą, numer telefonu w treści, odliczanie do ponownej wysyłki z ikoną zegara i „Zmień numer” w stopce karty.
- **Kod SMS:** wygląda jak sześć kafelków, ale w kodzie zostaje jedno pole `inputMode="numeric"` z `autoComplete="one-time-code"` (przezroczyste, nad kafelkami), żeby działało autouzupełnianie kodu i wklejanie. Kafelki są dekoracją (`aria-hidden`), czytnik ekranu widzi zwykłe pole z etykietą.
- **Wystaw:** hero z CTA „Nowa aukcja” i limitami konta, cztery korzyści, szkice z paskiem postępu („Krok 4 z 6: Dostawa”) i datą ostatniej zmiany; „Kontynuuj” otwiera krok do uzupełnienia.
- **Kreator:**
  - nad formularzem „Krok N z 6”, tytuł, stan autozapisu i „Zamknij kreator”; pasek kroków (zrobione z ✓, bieżący, kolejne; nazwy kroków od 1024 px, węziej same numery);
  - od 1024 px dwie kolumny z podglądem karty aukcji „Tak zobaczą Twoją aukcję” i listą kroków z ✓ obok formularza (D5), poniżej jedna kolumna;
  - pola według płótna: stan jako karty wyboru z opisem, gabaryt jako kafelki, przewoźnicy jako karty, ceny z sufiksem „zł”, przy czasie trwania data końca („jeśli opublikujesz teraz”);
  - na dole „Wstecz” i „Dalej”, na pierwszym kroku szkicu „Zapisz i wyjdź”;
  - krok 6 to podsumowanie: miniatury zdjęć, wiersze z linkami „Zmień” do kroków, braki z linkami albo „Wszystko gotowe do publikacji”, informacja o weryfikacji tożsamości i CTA „Opublikuj aukcję” obok „Wstecz”.
- **Nadaj paczkę:** układ z płótna na ekranie z F-24: powrót do Sprzedanych, numer zamówienia, od 1024 px formularz (dane nadawcy, sposób nadania jako karty wyboru) obok karty zamówienia (dostawa, dokąd, odbiorca, gabaryt). Po nadaniu ciemna karta „Przesyłka gotowa do nadania” z kodem nadania, „Kopiuj kod” i etykietą PDF, pod nią numer i historia przesyłki.
- **Strony 404 i błędu** (`not-found.tsx`, `error.tsx`) według płótna: duże „404” albo kafelek błędu, jedno zdanie, dwie akcje (404) albo „Spróbuj ponownie” i kod błędu (`digest`).

## Poza zakresem

- Płatność po wygranej („Zapłać”) i oceny na profilu sprzedawcy: projekty są na płótnie, wejdą z F-25 i F-30.
- Liczba unikalnych licytujących: wymaga nowego pola w API, a płótno pokazuje ją tylko pomocniczo. Pokazujemy liczbę ofert.
- Tryb ciemny i aplikacja mobilna (bez zmian względem F-62).
- Dźwięki i wibracje.
- Zmiany tokenów: wszystko, czego potrzebuje płótno, jest już w `packages/design-tokens`. Jeśli wdrożenie wykaże brak (np. czas animacji), dodajemy token, a nie wartość w klasie.

## UX

Według płótna i zasad z F-62. Dodatkowo:

- **Ruch tylko wtedy, gdy coś się zmieniło.** Podświetlenie ceny, nowy wpis w historii i pulsująca kropka LIVE. Nic nie mruga w kółko poza kropką LIVE (≤ 1 cykl na sekundę).
- **`prefers-reduced-motion`:** bez animacji wjazdu, pulsu i konfetti. Zmiana jest widoczna od razu (kolor i plakietka „+10 zł” zostają).
- **Czerwień** tylko dla LIVE, ostatniej godziny, „Przebito Cię” i akcji nieodwracalnych. Wygrana jest fioletowa, nie zielona i nie gradientowa.
- **Jedno CTA na widok.** „Zalicytuj ponownie” w toaście to akcja `default`, nie `cta`; CTA zostaje w panelu.
- **Jeden komunikat dla czytnika ekranu.** Toast na stronie aukcji zastępuje obecną linijkę `role="status"` w panelu, żeby to samo zdarzenie nie było czytane dwa razy.
- **Toasty:** najwyżej trzy naraz, najnowszy na górze; znikają po 8 s (przebito Cię: 12 s), czas staje przy najechaniu i fokusie; zamknięcie przyciskiem i klawiszem Escape. Na telefonie u góry ekranu, żeby nie zasłaniały paska licytacji.
- **Telefon:** pasek licytacji i dolny pasek nawigacji nie występują razem: na stronie aukcji pasek nawigacji się chowa.

## Postęp

- [x] **Etap 1, licytacja na żywo:**
  - `packages/shared`: `quickBidAmounts`, `timerTone`, `isLiveAuction`, `isHotAuction` (progi jako stałe);
  - komponenty `Countdown`, `PriceTicker`, `LiveBadge`, `BidStateBar`, `QuickBidAmounts`, `PriceSparkline`, `Toast` (Radix) i `Sheet` (Radix Dialog);
  - panel licytacji w sześciu stanach, formularz w osobnym `BidForm` (szybkie kwoty, „Spróbuj ponownie” po błędzie sieci z tym samym kluczem), potwierdzenie z kwotą łączną i czasem do końca;
  - toasty: `ToastProvider` w `AppProviders` (najwyżej trzy, zastępowanie po `id`), `LiveAlerts` dla innych stron; linijka `role="status"` w panelu zniknęła;
  - panel wygranej z konfetti, „Co dalej” i podsumowaniem zamówienia (D2);
  - historia ofert jako lista z inicjałami, czasem względnym, wyróżnieniem nowych ofert i wykresem ceny;
  - telefon: pasek licytacji w miejscu `MobileBidBarSlot` na końcu strony (sticky, nie zasłania stopki) i dolny arkusz z formularzem;
  - licznik oglądających (D1): `auction:view`/`auction:unview`, obecność w Redisie, `auction.viewers` z throttlingiem;
  - animacje w `globals.css` (`enter`, `toast-in`, `sheet-in`, `confetti`, `flash`) i globalna reguła `prefers-reduced-motion`;
  - poprawka po F-24: atrapa aukcji w e2e dostała ceny dostaw (`carriers[].price`, `shippingFrom`), bez których strona aukcji nie renderowała się w e2e.
- [x] **Etap 2, przeglądanie:**
  - API: `endsBefore` w `GET /v1/auctions` (`endsAtTs < …` w filtrze Meilisearch), klient API wygenerowany ponownie;
  - `AuctionCard` jedna dla wszystkich list: licznik w tonie (spokojny, fioletowy, czerwony z LIVE w ostatniej godzinie), „Gorąca”, stan przedmiotu, liczba ofert, Kup teraz; wariant ciemny z licznikiem pod ceną i paskiem ostatniej godziny. Sygnały liczy przeglądarka (jeden wspólny zegar sekundowy dla wszystkich liczników na stronie), HTML z cache pokazuje datę końca;
  - strona główna: hero z aukcją kończącą się najwcześniej (`HomeShowcase`: cena i licznik na żywo z realtime, trzy ostatnie oferty, „podbija do”, „Gorąca aukcja”; od 1024 px), ciemny pas „Kończą się wkrótce” (D3; na telefonie przewijany rząd kart), kafelki kolekcji, „Nowe aukcje”, „Jak działa licytacja”, kategorie z ikonami, „Dlaczego Biddy”;
  - wyszukiwarka i kategoria: pigułki sortowania jako linki (bez JavaScriptu), pasek „N aukcji kończy się w ciągu godziny” (link do sortowania po końcu; liczba z `total` przy `pageSize=1`, koniec okna zaokrąglony w dół do minuty, cache 60 s), chipy wybranych filtrów z linkiem usunięcia, panel filtrów (na telefonie przycisk „Filtry”, od 1024 px karta obok wyników), paginacja i opis kolejności w nowym układzie, pusty stan z płótna;
  - profil sprzedawcy: okładka, karta profilu z awatarem 112 px, chipy (weryfikacja telefonu, członek od), liczba aktywnych aukcji, siatka aukcji; oceny bez zmian do F-30;
  - nagłówek półprzezroczysty, granatowa stopka; dolny pasek nawigacji (D4) poniżej 768 px (punkt `md`; płótno: 760 px) z Moje Biddy i „Wystaw”, które znikają wtedy z nagłówka; ukryty na stronie aukcji (pasek licytacji);
  - odstępstwa od płótna: piąta pozycja paska to „Konto” (D4), a nie „Obserwowane”; bez kropki przy Moje Biddy i bez serduszka „Obserwuj” na karcie (wymagałyby nowych danych na listach); bez szkieletów ładowania: wyszukiwarka renderuje się na serwerze z cache, a `loading.tsx` przy streamingu psuje wyszukiwanie bez JavaScriptu i status 404 strony kategorii i profilu.
- [x] **Etap 3, Moje Biddy, konto i powiadomienia:**
  - API: `summary` w `GET /v1/me/bids?status=ACTIVE` (`leading`, `outbid`, `endingSoon` w ciągu doby; jedno zapytanie z `total`), test integracyjny, klient API wygenerowany ponownie;
  - wspólne klocki: `ListingCard` w układzie płótna (pasek stanu z licznikiem, ton `urgent`, kwoty w `dl`, akcje na całą szerokość na telefonie), `CompactRow` (przegrane, sprzedane), `RowTimer` (licznik w tonie z etapu 1), tony `urgent` i `won` w `IconTile`, `Switch` (Radix);
  - Licytuję: cztery kafelki podsumowania, filtr jako `SegmentedControl`, karty z „Twoje maksimum”, przebite w czerwonej ramce z „Zalicytuj ponownie”, zwarta sekcja „Nie udało się wygrać” (cena końcowa albo powód i maksimum);
  - Moje aukcje: ciemna karta gorącej aukcji (najwięcej ofert, przy remisie najbliższy koniec; LIVE, cena z przyrostem od startu, licznik; cena i oferty na żywo przez `useLiveCard`, który obsługuje teraz też `AuctionSummaryDto`), filtry z liczbą pozycji, nagłówki kart według stanu, link do aukcji i „Pokaż licytację”; Sprzedane: zwarte wiersze, stany zamówienia po polsku w tonie;
  - powiadomienia: liczba nowych przy tytule, grupy „Dzisiaj” i „Wcześniej” (`warsawDay`), nieprzeczytane z tłem, kropką i pogrubionym tytułem, ikona w tonie typu; ustawienia w trzech grupach z przełącznikami, kłódką „Zawsze wysyłamy” i jednym regionem „Zapisano”;
  - konto: karta z awatarem, e-mailem i telefonem, skróty z opisami, karta „Bezpieczeństwo”; profil z awatarem obok formularza; adresy w siatce z domyślnym w obramowaniu marki i kafelkiem „Dodaj adres”, formularz w dwóch kolumnach; podstrony konta szerokości Moje Biddy (`/wystaw` zostaje węższy do etapu 4);
  - odstępstwa od płótna: bez liczników przy zakładkach Moje Biddy, kafelka „Do zapłaty” i liczby transakcji na koncie (wymagałyby dodatkowych zapytań na każdej stronie); na karcie gorącej aukcji bez liczby licytujących i oglądających (lista sprzedawcy nie zgłasza oglądania, D1); czwarty kafelek to „Kończą się w ciągu doby” zamiast „Do zapłaty” z płótna, a w miejsce „kończą się dziś” z pierwszej wersji specu, bo to ten sam próg co fioletowy licznik i bez niejednoznaczności końca dnia; wiersz powiadomienia zostaje jednym linkiem, bez przycisków w środku (zagnieżdżone elementy interaktywne); Moje aukcje i Sprzedane zostają osobnymi zakładkami.
- [x] **Etap 4, logowanie, wystawianie i wysyłka:**
  - API: `completedSteps` w `GET /v1/me/auctions` dla szkiców (`validateListing` z kategorią, przewoźnikami i limitami sprzedawcy, bez gotowości zdjęć i filtra słów z publikacji); `LISTING_STEP_FIELDS`, `listingStepOfPath` i `completedListingSteps` w `@biddy/shared`, z których korzysta też kreator; test integracyjny, klient API wygenerowany ponownie;
  - logowanie i rejestracja: `AuthSplitPage` z panelem marki od 1024 px (przy logowaniu przykładowa aukcja LIVE i trzy korzyści, przy rejestracji droga do pierwszej oferty), Google i Apple nad formularzem (na rejestracji kafelki z literą i pełną nazwą dla czytnika), „Nie pamiętasz hasła?” przy etykiecie, `PasswordField` z przyciskiem pokazania hasła (`aria-pressed`) i regułą długości sprawdzaną na bieżąco;
  - pozostałe strony kont: `AuthCard` (karta na środku z kafelkiem ikony), wynik akcji w osobnej karcie (wysłano link, hasło zmienione, zły link, e-mail potwierdzony z przejściem do weryfikacji telefonu); `/wypisz` w tym samym układzie;
  - weryfikacja telefonu: postęp „E-mail, Telefon, Licytujesz” przy pierwszej weryfikacji, numer pogrubiony w treści, kod SMS jako sześć kafelków nad jednym przezroczystym polem `one-time-code`, odliczanie z ikoną zegara i „Zmień numer” w stopce karty, przypis pod kartą;
  - Wystaw: hero z „Nowa aukcja” i limitami, dekoracyjna karta aukcji LIVE (ukryta przed czytnikiem, od 640 px), cztery korzyści, szkice z paskiem postępu, krokiem do uzupełnienia, datą zmiany i „Kontynuuj” do tego kroku;
  - kreator: nagłówek z „Krok N z 6”, stanem autozapisu i „Zamknij kreator”; pasek kroków (✓ dla kroków bez braków, nazwy od 1024 px, od 640 px tylko bieżąca); od 1024 px `ListingPreview` (karta jak na listach i lista kroków z ✓); karty wyboru stanu i gabarytu, karty przewoźników z literą w tonie rodzaju usługi, ceny z sufiksem „zł”, data końca przy czasie trwania; krok 6 z miniaturami, wierszami „Zmień” i informacją o KYC; „Wstecz”, „Dalej”, „Zapisz i wyjdź” i CTA publikacji w pasku pod formularzem;
  - nadanie paczki: powrót do Sprzedanych, numer zamówienia, od 1024 px formularz w dwóch kartach obok karty zamówienia (dostawa z ceną, dokąd, odbiorca, gabaryt), po nadaniu ciemna karta z kodem nadania, „Kopiuj kod” (komunikat dla czytnika) i etykietą PDF, pod nią numer i historia przesyłki; nowy e2e strony nadania (desktop i 390 px, axe);
  - strony 404 i błędu według płótna (duże „404” w fiolecie 500, kod błędu `digest` w plakietce);
  - poprawki kontrastu: plakietka zdjęcia głównego i wybrany czas trwania na `brand-strong`, błąd potwierdzenia KYC na niebieskim tle w czerwieni 700;
  - odstępstwa od płótna: nagłówek i stopka strony zostają na stronach kont i w kreatorze (płótno ma tam własny, uproszczony nagłówek); bez Facebooka (w API są tylko Google i Apple) i bez paska siły hasła (sprawdzamy tylko regułę długości); kategoria zostaje wyborem poziom po poziomie z F-11 zamiast kolumn; waga paczki tylko przy XL, jak dziś; bez cen przy przewoźnikach w kreatorze (cennik zależy od gabarytu i nie ma go w `GET /v1/shipping/carriers`) i bez paska „Twoje progi cenowe”; bez terminu „Nadaj do” i miniatury przedmiotu na stronie nadania (nie ma ich w odpowiedzi zamówienia) oraz bez przykładowej karty z kodem przed nadaniem (pokazywałaby nieprawdziwy kod).

## Model danych

Bez zmian w bazie. Licznik oglądających (D1) trzyma stan w Redis.

## API i zdarzenia

- **Etap 1, licznik oglądających (D1):**
  - Osobne zgłoszenie oglądania, a nie subskrypcja: listy w Moje Biddy subskrybują aukcje, ale ich nie oglądają. Klient → serwer `auction:view` (ack `{ ok, viewers }` albo `{ ok: false, error: 'INVALID_AUCTION_ID' | 'TOO_MANY_VIEWS' }`, najwyżej 5 aukcji na połączenie) i `auction:unview`; rozłączenie usuwa wszystkie zgłoszenia.
  - API trzyma identyfikatory gniazd w zbiorze posortowanym w Redisie cache (`realtime:viewers:{auctionId}`, wynik to czas potwierdzenia). Każda instancja potwierdza swoje połączenia co 30 s, a wpisy bez potwierdzenia przez 90 s (instancja padła) wypadają. Działa przy wielu instancjach API.
  - Nowe zdarzenie `auction.viewers` w room `auction:{id}`: `{ auctionId, count, serverTime }`, najwyżej raz na 5 s na aukcję i instancję, tylko po zmianie liczby.
  - `@biddy/realtime`: `viewAuction(auctionId, onViewers)` (zgłasza oglądanie ponownie po reconnect), w web hook `useAuctionViewers`.
- **Etap 2, pasek „kończy się w ciągu godziny”:** opcjonalny parametr `endsBefore` (data ISO) w `GET /v1/auctions`. Filtr dokłada `endsAtTs < …` do zapytania Meilisearch; liczbę bierzemy z `total` przy `pageSize=1`. Wynik cache'owany 60 s jak listy na stronie głównej.
- **Etap 3, podsumowanie licytacji:** pole `summary` w `GET /v1/me/bids` dla `status=ACTIVE`: `{ leading, outbid, endingSoon }` (liczba aukcji, w których prowadzę, w których przebito mnie, i tych, które kończą się w ciągu doby: próg `SOON_WINDOW_MS`, ten sam co fioletowy licznik). Liczone w tym samym zapytaniu co `total`, więc nie zależą od strony. Dla `WON` i `LOST` `null`.
- **Etap 4, postęp szkicu:** pole `completedSteps` (0–5) w `AuctionSummaryDto` dla szkiców: liczba kolejnych kroków kreatora od pierwszego, w których nie ma braków. Krok do uzupełnienia to `completedSteps + 1` (6 = podgląd i publikacja). Braki liczy `validateListing` z kategorią, przewoźnikami i limitami sprzedawcy, tak jak przy „Dalej” w kreatorze; przypisanie braków do kroków (`LISTING_STEP_FIELDS`, `completedListingSteps`) jest w `@biddy/shared` i korzysta z niego też kreator. Dla pozostałych statusów `null`.
- Pozostałe dane już są: `bidCount`, `currentPrice`, `minimumNextBid`, `endsAt`, historia ofert, zdarzenia `auction.updated`, `auction.extended`, `auction.ended`, `user.outbid`, `user.won` (F-17).
- Klient API (`packages/api-client`) generowany ponownie po każdej zmianie.

## Reguły biznesowe i przypadki brzegowe

- **Szybkie kwoty:** pierwsza to minimalna kolejna oferta; druga to najmniejsza wielokrotność 5 kroków licytacji (`bidIncrement` przy kwocie minimalnej) większa od pierwszej; trzecia to najmniejsza wielokrotność 10 kroków większa od drugiej. Przykład: cena 320 zł, krok 5 zł, minimalna 325 zł → 325, 350, 400 zł. Funkcja `quickBidAmounts` w `packages/shared/src/pricing`, z testami na granicach przedziałów kroków.
- **Gorąca aukcja:** aktywna, co najmniej 5 ofert i mniej niż 24 h do końca. Jedna funkcja (`isHotAuction`) dla karty, strony aukcji i Moje Biddy; progi jako stałe.
- **LIVE:** aktywna aukcja z mniej niż 1 h do końca (ten sam próg co czerwony licznik).
- **Licznik oglądających:** pokazujemy od 3 osób; poniżej nic. Liczymy połączenia, nie osoby; własne połączenie się wlicza. Strona zgłasza oglądanie tylko aktywnej aukcji. Błąd Redisa daje liczbę 0 (nic nie widać), a nie błąd strony.
- **Toast „kończy się”:** raz na aukcję i sesję przeglądarki, 5 minut przed końcem; po przedłużeniu nie wraca.
- **Przebicie podczas wpisywania:** jeśli minimalna oferta wzrośnie ponad wpisaną kwotę, pole pokazuje błąd z nową minimalną, a szybkie kwoty przeliczają się od razu. Dialog potwierdzenia otwarty w tym momencie mówi o nowej minimalnej i zamiast „Potwierdź ofertę” proponuje „Licytuj {minimalna}”; stara kwota nie wychodzi do API.
- **Błąd sieci przy ofercie:** komunikat z płótna z przyciskiem „Spróbuj ponownie”; kwota zostaje w polu. Po ponownym połączeniu realtime strona odświeża dane jak dziś (F-17).
- **Wygrana na innej stronie:** toast z linkiem; panel wygranej pokazuje się, gdy użytkownik otworzy aukcję.
- Teksty przez `next-intl`, neutralne płciowo, bez zmiany znaczenia istniejących komunikatów. Kwoty i daty przez obecne formatery (twarda spacja przed „zł”).

## Bezpieczeństwo i prywatność

- Licznik oglądających to tylko liczba: bez listy osób i bez rozróżnienia zalogowanych. Zbiór w Redis trzyma identyfikatory gniazd, nie użytkowników, i wygasa sam.
- Toasty spoza strony aukcji pochodzą tylko z room `user:{id}`, do którego klient nie może dołączyć sam (F-17).
- `endsBefore` przechodzi walidację jak pozostałe parametry wyszukiwarki (data ISO, nie tekst w filtrze).

## Analityka

- `bid_placed` dostaje właściwość `source`: `manual`, `quick` albo `rebid` (z toastu lub paska „Przebito Cię”).
- Nowe zdarzenie `rebid_opened` z `from: 'toast'` („Zalicytuj ponownie” w toaście).
- Nowe zdarzenie `win_viewed` przy pierwszym pokazaniu panelu wygranej.

## Decyzje

Propozycje z płótna, które wykraczają poza obecny produkt albo design system. Przyjęte 2026-10-26; po wdrożeniu wpisane do rejestru decyzji w PROJECT.md (§22, nr 101–105).

| # | Propozycja | Etap | Decyzja |
| --- | --- | --- | --- |
| D1 | Licznik „X osób ogląda” (backend w realtime) | 1 | Tak, jako ostatni punkt etapu 1 |
| D2 | Wygrana jako panel na stronie aukcji zamiast osobnego ekranu | 1 | Panel na stronie aukcji, na telefonie na pełną szerokość |
| D3 | Ciemny pas „Kończą się wkrótce” na stronie głównej | 2 | Tak |
| D4 | Dolny pasek nawigacji na telefonie (Start, Szukaj, Wystaw, Moje Biddy, Konto) zamiast menu z design systemu | 2 | Tak, poniżej 760 px; menu konta zostaje w nagłówku |
| D5 | Kreator w dwóch kolumnach z podglądem karty | 4 | Tak, od 1024 px |

## Kryteria akceptacji

- [x] Given aukcja z mniej niż 1 h do końca, Then karta i strona aukcji pokazują LIVE, a licznik jest czerwony i w segmentach (na karcie zwarty czerwony licznik mm:ss).
- [x] Given osoba licytująca na stronie aukcji, When ktoś przebije jej ofertę, Then w ciągu 1 s widzi pasek „Przebito Cię” i toast z „Zalicytuj ponownie”, a czytnik ekranu dostaje jeden komunikat (nie dwa).
- [x] Given osoba zalogowana na innej stronie, When ktoś przebije jej ofertę albo wygra ona aukcję, Then widzi toast z linkiem do aukcji.
- [x] Given „Zalicytuj ponownie”, When zostanie użyte, Then fokus trafia do pola kwoty z wpisaną minimalną ofertą.
- [x] Given minimalna oferta 325 zł (cena 320 zł, krok 5 zł), Then szybkie kwoty to 325, 350 i 400 zł.
- [x] Given wygrana, Then strona aukcji pokazuje panel wygranej z ceną końcową i następnym krokiem, bez przycisku płatności przed F-25.
- [x] Given `prefers-reduced-motion: reduce`, Then żaden element nie animuje się ani nie pulsuje, a zmiany ceny i stanu są nadal widoczne.
- [x] Given wyszukiwarka, Then pasek pokazuje liczbę aukcji kończących się w ciągu godziny i prowadzi do sortowania po końcu.
- [x] Given Moje Biddy: licytuję, Then aukcje z przebitą ofertą są wyróżnione i mają akcję przebicia.
- [x] Given lista szkiców, Then każdy szkic pokazuje postęp w krokach kreatora.
- [x] Given kod SMS, Then autouzupełnianie `one-time-code` i wklejenie całego kodu działają jak przed zmianą.
- [x] Given każdy widok, Then ma najwyżej jedno CTA, a kolory, typografia, promienie i cienie pochodzą z tokenów (test `design-tokens.test.ts`).
- [x] Given strony z e2e, Then scenariusze i axe (WCAG 2.1 AA) przechodzą, a przy 360–1440 px żadna strona nie przewija się w poziomie.

## Plan testów

- **Jednostkowe (`packages/shared`):** szybkie kwoty (granice przedziałów kroków), `isHotAuction` i próg LIVE, `completedListingSteps` (pusty szkic, brak w środku, komplet).
- **Jednostkowe (web, Vitest i Testing Library):**
  - `CountdownTimer` (tony i wariant segmentowy na progach), `PriceTicker` (plakietka przyrostu), `PriceSparkline` (dane z historii);
  - panel licytacji w sześciu stanach, toast po `user.outbid` i `auction.extended`, „Zalicytuj ponownie” i fokus;
  - brak animacji przy `prefers-reduced-motion` (klasy, nie piksele);
  - Moje Biddy (wyróżnienie przebitych, karta gorącej aukcji), przełączniki w ustawieniach (`role="switch"`), postęp szkicu.
- **API, integracyjne:** licznik oglądających przy dwóch instancjach API (subskrypcja, rozłączenie, wygaśnięcie, throttling), `endsBefore` w `GET /v1/auctions`, `summary` w `GET /v1/me/bids`, `completedSteps` w `GET /v1/me/auctions`.
- **E2E (Playwright):** istniejące scenariusze z axe; przebicie na atrapie realtime (`user.outbid` → toast, axe z otwartym toastem, „Zalicytuj ponownie” wpisuje minimalną ofertę i ustawia fokus); telefon 390 px (pasek licytacji w widoku, dolny arkusz z szybkimi kwotami, axe, brak przewijania w poziomie); zrzuty ekranu kluczowych stron na 390 i 1440 px do przeglądu ręcznego.

## Otwarte pytania

- Zdjęcia produktów w design systemie mają niską rozdzielczość (175–440 px). Do przeglądu wizualnego warto mieć lepsze zdjęcia w danych testowych (`seed`).
- Czy toast „kończy się” ma dotyczyć też aukcji tylko obserwowanych, czy wyłącznie tych, w których użytkownik licytuje (spec zakłada oba przypadki)?
