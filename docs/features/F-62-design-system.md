# F-62 · Design system i odświeżenie UI web

**Status:** W trakcie
**Rozmiar:** L · **Właściciel:** Mateusz Bienias · **Zależności:** F-06, F-07, F-10, F-14, F-18, F-19, F-20, F-21

## Kontekst i cel

Aplikacja web działa, ale wygląda jak szkielet: tymczasowa paleta (granat i pomarańcz), font Inter i domyślne komponenty shadcn/ui ([PROJECT.md §22 nr 8 i nr 39](../PROJECT.md#22-rejestr-decyzji)). Biddy potrzebuje identyfikacji, która buduje zaufanie przy pieniądzach i oddaje emocje licytacji na żywo.

Źródłem jest **design system Biddy** (artefakt: <https://claude.ai/artifact/Hg6ZTSbvwaN5j7GiQD2cPn>), zbudowany z makiet Figma z 2025 roku (`design/*.png`) i obecnych tokenów. Zawiera tokeny, typografię, 34 komponenty z podglądem, wzorce UX („Wzorce UX”) i mapowanie na kod („Wdrożenie w kodzie”). F-62 przenosi go do `packages/design-tokens` i `apps/web`.

## Historyjki użytkownika

- Jako kupujący od razu widzę, co jest najważniejsze na ekranie (jedna wyraźna akcja), ile kosztuje przedmiot i ile czasu zostało.
- Jako licytujący widzę bez czytania, czy prowadzę, czy ktoś mnie przebił i czy aukcja zaraz się kończy.
- Jako użytkownik z gorszym wzrokiem albo klawiaturą mogę przeczytać każdy tekst (kontrast AA) i widzę, gdzie jest fokus.

## Zakres

Wdrożenie w czterech krokach; każdy kończy się działającą aplikacją i zielonymi testami.

### 1. Fundament

- **Tokeny** (`packages/design-tokens`):
  - skale `ink`, `violet`, `pink`, `red`, `green`, `amber`, `sky` (50–950, OKLCH) zamiast `navy`, `orange`, `gray`;
  - role semantyczne z design systemu: nazwy shadcn/ui oraz `canvas`, `foreground-secondary`, `link`, `primary-hover`, `cta-*`, `brand`, `brand-strong`, `brand-border`, `logo-*`, `panel-*`, `border-strong`, `live`, `live-dot`, `urgent`, `urgent-soft`, `success*`, `warning*`, `info*`, `rating`; bez `highlight`;
  - typografia: Plus Jakarta Sans, skala rozmiarów (`xs`–`5xl`) i style semantyczne (`display`, `h1`–`h3`, `title`, `body-lg`, `body`, `body-sm`, `caption`, `label`, `label-lg`, `overline`, `badge`, `price-xl`, `price-lg`, `price`, `timer`) z interlinią, grubością i rozstawem;
  - promienie `xs`–`2xl`, cienie `xs`, `sm`, `md`, `lg`, `cta`, `focus-ring`, szerokości kontenerów `page`, `narrow`, `form`, `auth`;
  - pary kontrastu z notatek design systemu w testach.
- **Font** Plus Jakarta Sans przez `next/font` (latin, latin-ext) w miejsce Inter.
- **Logo** z makiety (PNG w gradiencie i biały wariant), ikona karty i `theme-color` z nowych tokenów, kolory e-maili.
- **Komponenty bazowe** (`components/ui`):
  - `Button`: warianty `cta`, `default` (granat), `outline`, `soft`, `accent`, `ghost`, `link`, `destructive`, `destructive-outline`; rozmiary 32/40/48 px;
  - `Badge`: tony i warianty plus `live`;
  - `Input`, `Textarea`, `NativeSelect`: 48 px, fokus `ring`;
  - `Checkbox`, `Label`, `Alert` (tony), `AlertDialog`, `Skeleton`;
  - nowe: `Chip`, `IconTile`, `PillTabs`, `SegmentedControl`, `Price`, `EmptyState`.
- **Nagłówek i stopka** według `SiteHeader`: logo, wyszukiwarka w pigułce, obserwowane, powiadomienia, Moje Biddy, konto i „Wystaw” jako `default` (granat).

### 2. Aukcje i przeglądanie

- **Strona aukcji:** galeria, panel licytacji ze stanami (prowadzisz, przebito Cię, wygrana, koniec), licznik z progami czasu, historia ofert, karta sprzedającego, specyfikacja, dostawa.
- **Karta aukcji, wyszukiwarka, strona kategorii i strona główna.**

### 3. Konto i Moje Biddy

- **Moje Biddy:** zakładki jako `PillTabs`, wiersze w stylu `ListingCard` (stan, przedmiot, następny krok).
- **Pozostałe strony konta:** powiadomienia, profil, adresy, ustawienia powiadomień, profil publiczny.

### 4. Logowanie i wystawianie

- **Logowanie, rejestracja, reset hasła i weryfikacje:** układ z panelem marki na desktopie.
- **Kreator aukcji:** kafelki zdjęć, karty wyboru gabarytu i przewoźników, jedno CTA.

## Poza zakresem

- Tryb ciemny (zostaje wyłączony, decyzja z F-06).
- Aplikacja mobilna (tokeny są gotowe na NativeWind, wdrożenie w F-37).
- Wektorowe logo: obecny PNG 160 × 90 px wystarcza do 45 px wysokości; SVG przyjdzie z Figmy.
- Nowe funkcje widoczne na makietach, których nie ma w produkcie (saldo w nagłówku, wiadomości, oceny): dochodzą razem z F-27, F-29 i F-30.

## UX

Według design systemu (README, „Wzorce UX”) i makiet z `design/`. Zasady, których pilnujemy w każdym kroku:

- Jedna akcja `cta` (gradient fiolet → róż) na widok, nigdy w nagłówku.
- Granat (`default`) dla akcji w kartach i wierszach.
- Fiolet dla zaznaczenia i aktywności (karta wyboru, checkbox, aktywna zakładka).
- Czerwień tylko dla LIVE, ostatniej godziny i akcji nieodwracalnych.
- Tła: `background` dla stron publicznych, `canvas` z białymi kartami dla stron konta.
- Licznik: ≥ 24 h spokojny, < 24 h fioletowy, < 1 h czerwony.
- Stany ekranów (pusty, ładowanie, błąd) bez zmian w logice; zmienia się ich wygląd (`EmptyState`, `Skeleton`, `Alert`).

## Postęp

- [x] **Krok 1, fundament:**
  - tokeny, `theme.css` (style tekstu, cienie, kontenery) i `cn()` znające nazwy z tokenów;
  - Plus Jakarta Sans, logo, ikona karty, kolory e-maili;
  - komponenty bazowe i nowe (`Chip`, `IconTile`, `PillTabs`, `SegmentedControl`, `Price`, `EmptyState`);
  - nagłówek i stopka.
- [x] **Krok 2, aukcje i przeglądanie:**
  - strona aukcji: tytuł z chipami stanu i marki obok galerii, panel licytacji (cena, licznik w trzech tonach, stany z ikonami, CTA „Licytuj”, obserwowanie), historia ofert, parametry, przewoźnicy w kafelkach, karta sprzedawcy;
  - karta aukcji z datą końca na zdjęciu;
  - wyszukiwarka i strona kategorii (panel filtrów, pusty stan, paginacja);
  - strona główna (hero z kartą kończącej się aukcji, sekcje list, kategorie, „Dlaczego Biddy”).
- [ ] Krok 3: konto i Moje Biddy.
- [ ] Krok 4: logowanie i wystawianie.

## Model danych

Bez zmian.

## API i zdarzenia

Bez zmian.

## Reguły biznesowe i przypadki brzegowe

- Teksty bez zmian znaczenia; nowe teksty przez `next-intl`, neutralne płciowo.
- Kontrakt z F-06 zostaje: kolory, typografia i promienie wyłącznie z tokenów (test `design-tokens.test.ts`).

## Bezpieczeństwo i prywatność

Bez zmian. Font hostowany przez `next/font` (bez zapytań przeglądarki do Google).

## Analityka

Bez zmian.

## Kryteria akceptacji

- [x] Given tokeny, Then każda para tekst/tło z design systemu ma ≥ 4,5:1, a `input`, `ring` i `brand` ≥ 3:1 na tłach, na których leżą (test).
- [x] Given aplikacja web, Then klasy kolorów, typografii, promieni, cieni i kontenerów pochodzą wyłącznie z tokenów, bez starych nazw (`highlight`, `navy`, `orange`, `gray`).
- [x] Given dowolna strona, Then tekst jest w Plus Jakarta Sans, a nagłówek pokazuje logo Biddy.
- [ ] Given widok z główną akcją, Then jest na nim najwyżej jeden przycisk `cta`.
- [x] Given strona aukcji, Then panel pokazuje stan użytkownika z ikoną i tekstem, a licznik zmienia ton przy 24 h i 1 h do końca.
- [ ] Given Moje Biddy, Then każda pozycja ma stan, cenę i następny krok w układzie karty z design systemu.
- [ ] Given strony z F-06–F-21, Then e2e (ścieżki, role, etykiety) i axe (WCAG 2.1 AA) przechodzą bez zmian w zachowaniu.
- [ ] Given szerokość 360–1440 px, Then żadna strona nie przewija się w poziomie.

## Plan testów

- **Jednostkowe (`packages/design-tokens`):** kontrast, gamut i kolejność jasności skal; zawartość `theme.css` (reset domyślnych wartości Tailwinda, style semantyczne z interlinią i grubością, cienie, kontenery).
- **Jednostkowe (web):**
  - kontrakt tokenów (`design-tokens.test.ts`) i brak starych nazw kolorów;
  - komponenty bazowe (warianty `Button` i `Badge`, progi licznika).
- **E2E (Playwright):** istniejące scenariusze z axe na nowych stylach; zrzuty ekranu kluczowych stron do przeglądu ręcznego (bez porównywania pikseli w CI).

## Otwarte pytania

- Eksport logo do SVG z Figmy (do panelu marki i dużych rozmiarów). Do tego czasu PNG.
