# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Jedno konto Biddy jednocześnie kupuje i sprzedaje (jak na Vinted). W decyzjach projektowych obie strony mają **równą wagę**:

- **Kupujący** szuka przedmiotów o niepewnej wartości (kolekcje, vintage, limitowane edycje, elektronika używana) i chce zapłacić uczciwą cenę rynkową. Licytuje często na telefonie, a najwięcej dzieje się w końcówkach aukcji, w szczycie 19:00–23:00. Potrzebuje pewności, że pieniądze są bezpieczne do czasu odbioru i sprawdzenia przedmiotu.
- **Sprzedający** to osoba prywatna (w MVP bez kont firmowych), często ktoś, kto dziś robi „licytacje” w komentarzach na grupach FB czy Instagramie i ręcznie zbiera przelewy. Chce, żeby rynek wycenił przedmiot, dostać 100% wylicytowanej kwoty, gotową etykietę i wypłatę na konto.

Niszowe grupy, w które celuje marketing na start: kolekcjonerstwo (karty TCG: Pokémon, MTG, One Piece; LEGO, figurki, monety), sneakersy, streetwear i moda vintage, retro gaming i elektronika używana. Pozostałe kategorie działają od dnia 1, ale nie są promowane.

Poziomy dostępu: gość (przegląda, szuka) → zarejestrowany (obserwuje, pisze) → zweryfikowany telefon (licytuje, wystawia z limitami) → sprzedawca z KYC (wypłaca, wyższe limity). Personel w panelu admina: `support`, `moderator`, `finance`, `admin`.

## Product Purpose

Biddy to marketplace C2C z **licytacjami czasowymi**. Cenę ustala rynek, a nie sprzedający. Kupujący płaci Pakiet Ochrony Kupujących (POK), a Biddy w zamian obsługuje płatność, wstrzymuje środki u licencjonowanego operatora do czasu odbioru i weryfikacji przedmiotu (maks. 36 h od odbioru), daje opcje dostawy z etykietami i śledzeniem oraz prowadzi spory i zwroty.

Sukces mierzymy m.in. przez sell-through rate, średnią liczbę ofert na aukcję, payment completion rate (opłacone wygrane), dispute rate, czas do nadania i retencję D30 po obu stronach.

## Positioning

„Vinted, ale z licytacjami”: nowoczesne, mobilne licytacje C2C z ochroną kupującego, płatnością i wysyłką w jednym miejscu. Mechanizm, którego sąsiedzi nie skopiują wprost:

- Vinted i OLX mają stałą cenę; Allegro traktuje licytacje niszowo i jest nastawione na B2C z prowizją po stronie sprzedającego; grupy FB/IG nie dają żadnej ochrony.
- Sprzedający ma **0% prowizji**, przychód Biddy to POK płacony przez kupującego (2,99 zł + 7% do 1000 zł, 4% powyżej, progi krańcowe; konfigurowalne).
- Środki są wstrzymane do weryfikacji przedmiotu, a nie tylko do doręczenia.

## Operating Context

- Aukcja: czas trwania, cena wywoławcza (min. 1 zł), opcjonalnie cena minimalna i Kup teraz, licytacja automatyczna (proxy), anti-sniping (soft close), oferty **wiążące**. Aktualizacje na żywo przez WebSocket i powiadomienia o przebiciu (web push, e-mail, in-app).
- Po wygranej: checkout (dostawa + płatność BLIK, karta, szybki przelew, Apple/Google Pay), nadanie przez sprzedającego, śledzenie, odbiór, okno 36 h na zgłoszenie problemu, potem auto-zwolnienie środków na saldo sprzedającego i wypłata.
- Dostawa: paczkomaty i kurierzy przez agregatora (Furgonetka), docelowo bezpośrednio InPost; gabaryty i cennik Biddy.
- Komunikacja tylko na platformie: czat per aukcja/zamówienie z ostrzeżeniami przy danych kontaktowych. Oceny obustronne ujawniane po obu ocenach lub po 7 dniach.
- Konta mają limity i strike'i z odwołaniami. KYC jest wymagane do wypłaty i komunikowane przed pierwszym wystawieniem.

## Capabilities and Constraints

- **Web-first:** publiczny start to web (RWD + PWA z web push). Aplikacje iOS/Android (Expo) powstają zaraz po starcie web; panel admina to osobna aplikacja (`apps/admin`). Ten plik opisuje produkt wspólny dla wszystkich aplikacji w monorepo.
- Stack web: Next.js (App Router), Tailwind CSS 4 + shadcn/ui (Radix), tokeny wyłącznie z `packages/design-tokens`, next-intl.
- **Język:** interfejs, dokumentacja i komentarze po polsku (EN później). Teksty w UI są **neutralne płciowo**: bez form „-łeś/-łaś”, „otrzymałem” (np. „Zgłoś brak paczki” zamiast „Nie otrzymałem”).
- **Transparentność ceny (wymóg prawny i zaufania):** przy przycisku licytacji pokazujemy cenę łączną, np. „Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od 12,99 zł”. Zasady POK, terminy i wstrzymania środków są widoczne w UI, nie tylko w regulaminie.
- Przy aukcji informujemy, czy sprzedający jest przedsiębiorcą. Cookies domyślnie tylko niezbędne. DSA: zgłaszanie treści, uzasadnienia decyzji, odwołania.
- Wydajność: LCP < 2,5 s na stronie aukcji (mobile 4G), Core Web Vitals „good”.
- Poza MVP: licytacje na żywo (streaming), konta firmowe B2C, łączenie wygranych, Q&A do aukcji, asystent AI do wystawiania, płatne wyróżnienia.
- Nierozstrzygnięte: ostateczny operator płatności (rekomendacja PayU Marketplace, alternatywa Mangopay), stawki dostaw u przewoźników, część kwestii prawnych i VAT z §17 PROJECT.md.
- Pełna specyfikacja: [docs/PROJECT.md](docs/PROJECT.md), feature specy: [docs/FEATURES.md](docs/FEATURES.md).

## Brand Commitments

- Nazwa: **Biddy**, domena `biddy.pl`. Logo: [design/Biddy-logo.png](design/Biddy-logo.png).
- Pojęcia produktowe z ustaloną nazwą: Pakiet Ochrony Kupujących (POK), Moje Biddy, Kup teraz, licytacja automatyczna, druga szansa.
- Identyfikacja wizualna jest już ustalona w F-62 i F-63 ([docs/features/F-62-design-system.md](docs/features/F-62-design-system.md), [docs/features/F-63-puls-licytacji.md](docs/features/F-63-puls-licytacji.md)); źródłem jej opisu jest design system, nie ten plik.

## Evidence on Hand

- Makiety Figma z 2025 r. w [design/](design/) (logowanie, rejestracja, strona aukcji, kreator, moje aukcje, profil, zamówienia).
- Konta testowe i dane z seedu (`pnpm db:reset`) to dane deweloperskie, nie dowody.
- **Produkt jest przed betą.** Nie ma realnych użytkowników, opinii, statystyk, case studies, prasy ani logotypów partnerów. Przyszłe prace nie mogą ich zmyślać (żadnych „10 000 zadowolonych kupujących”, ocen z gwiazdkami od fikcyjnych osób, logotypów operatorów jako partnerów).

## Product Principles

1. **Uczciwość ceny przed emocją.** Emocje licytacji są wartością, ale nigdy kosztem jasności: cena łączna, wiążący charakter oferty i terminy są zawsze widoczne przed kliknięciem.
2. **Zaufanie widać w każdym kroku.** Wstrzymanie środków, okno 36 h, status przesyłki i ścieżka sporu są pokazane tam, gdzie użytkownik ich potrzebuje, a nie schowane w regulaminie.
3. **Obie strony są równe.** Rozwiązanie, które pomaga kupującemu kosztem sprzedającego (lub odwrotnie), wymaga uzasadnienia.
4. **Końcówka aukcji to moment prawdy.** Stan aukcji, czas i przebicia muszą być natychmiastowe i czytelne na telefonie, w szczycie wieczornym.
5. **Wszystko na platformie.** Komunikacja, płatność i wysyłka zostają w Biddy, bo tylko tam działa ochrona.

## Accessibility & Inclusion

- Cel: **WCAG 2.1 AA** od MVP (EAA; tańsze niż retrofit). Kolory z makiet, które nie spełniały AA, zostały w F-62 zastąpione ciemniejszymi krokami tej samej skali.
- Wymóg 18+ dla kont. Teksty neutralne płciowo.
