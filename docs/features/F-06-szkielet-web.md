# F-06 · Szkielet aplikacji web

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-01, F-05

## Kontekst i cel

Baza aplikacji `apps/web` (Next.js), na której powstaną wszystkie ekrany web: strona aukcji (F-18), wyszukiwarka (F-19), kreator (F-14), checkout (F-25). Feature ustala design system (tokeny, komponenty), wspólny layout, teksty przez i18n, obsługę błędów, monitoring, analitykę za zgodą i bazowe SEO ([PROJECT.md §11.3](../PROJECT.md#113-web-appsweb), §17, §19). Strona aukcji musi być indeksowana i szybka (LCP < 2,5 s na 4G, Lighthouse ≥ 90), więc wydajność i dostępność sprawdzamy od pierwszego ekranu, a nie na końcu.

## Historyjki użytkownika

- Jako odwiedzający chcę szybko zobaczyć, czym jest Biddy, i z każdej strony dojść do wyszukiwania, wystawiania i logowania.
- Jako użytkownik klawiatury lub czytnika ekranu chcę przejść od razu do treści i obsłużyć nagłówek bez myszy.
- Jako użytkownik telefonu (od 360 px) chcę korzystać z layoutu bez przewijania w poziomie.
- Jako odwiedzający, który trafił na nieistniejący adres albo błąd, chcę wiedzieć, co się stało, i wrócić do serwisu.
- Jako zespół chcemy widzieć błędy frontu w Sentry, a analitykę zbierać dopiero po zgodzie użytkownika.

## Zakres

- **`apps/web`**: Next.js 16 (App Router, React 19, Server Components), TypeScript, Turbopack. Port 3000 (`pnpm dev`).
- **`packages/design-tokens`**: jedno źródło kolorów i typografii w TypeScript. Build generuje `theme.css` dla Tailwind CSS 4 (`@theme`, z wyzerowaniem domyślnych kolorów i fontów Tailwinda) i eksportuje te same wartości w JS (później NativeWind w mobile, F-37). Test sprawdza kontrast WCAG AA par kolorów semantycznych.
- **UI:** Tailwind CSS 4 + shadcn/ui (komponenty w `apps/web/src/components/ui`, kolory semantyczne z tokenów). Na start: `Button`, `Input`, `Skeleton`.
- **Layout:** link „Przejdź do treści”, nagłówek (logo, wyszukiwarka, „Wystaw przedmiot”, „Zaloguj się”), `<main>`, stopka (linki informacyjne i prawne, rok, nazwa).
- **Strona główna:** hero z propozycją wartości (licytacje, Pakiet Ochrony Kupujących, 0% prowizji dla sprzedających) i promowane nisze (§2.4). Treść statyczna (renderowana przy buildzie).
- **Stany:** 404 (`not-found`), błąd segmentu (`error`, z ponowieniem), błąd layoutu głównego (`global-error`), ładowanie (`loading` ze szkieletem; od F-10 tylko w segmentach konta, `app/konto/loading.tsx`, bo granica Suspense nad stronami publicznymi zamieniała 404 na 200).
- **i18n:** `next-intl` bez prefiksu języka w adresie (tylko PL na start), komunikaty w `apps/web/messages/pl.json` z typowanymi kluczami. Formatowanie dat i kwot (PLN) przez next-intl.
- **Klient API (F-05):** `QueryClientProvider` i `configureApiClient({ baseUrl })` w layoucie; synchronizacja zegara z serwerem (§15.4) przez wygenerowane `getServerTime` z kluczem z `getGetServerTimeQueryKey`. Pomocnik dla Server Components przekazujący ciasteczko sesji do wygenerowanych funkcji.
- **Konfiguracja:** zmienne `NEXT_PUBLIC_*` walidowane Zodem w `next.config.ts` przy buildzie i starcie (`src/env.ts`), opis w `.env.example` (sekcja „Web”). Kod dostaje gotowy, znormalizowany obiekt (`src/config.ts`), więc Zod nie trafia do paczki przeglądarki. Środowisko wskazuje `NEXT_PUBLIC_ENVIRONMENT` (`local`, `preview`, `staging`, `production`).
- **Monitoring:** `@sentry/nextjs` (klient, serwer, edge), włączony tylko z `NEXT_PUBLIC_SENTRY_DSN`, bez danych osobowych i bez Session Replay. W przeglądarce SDK ładuje się osobnym fragmentem JS po starcie strony (nie zwiększa głównej paczki), a błędy z pierwszych chwil są buforowane i przekazywane po inicjalizacji.
- **Analityka:** PostHog (EU) ładowany dynamicznie i inicjalizowany **wyłącznie** po zgodzie na analitykę (ciasteczko zgody, baner powstanie w F-41). Bez zgody nie ma żadnego żądania do PostHog.
- **SEO:** `metadata` (szablon tytułu, opis, Open Graph, `metadataBase`), `lang="pl"`, `robots.txt` i meta `robots` (indeksowanie tylko przy `NEXT_PUBLIC_ENVIRONMENT=production`), ikona generowana z tokenów.
- **Jakość:** ESLint (typed linting, reguły Next.js i hooków React, dostępność JSX), Vitest + Testing Library, Playwright (e2e, axe-core, szerokości 360–1440 px) w jobie `web` w CI, skrypt Lighthouse z progami (uruchamiany ręcznie, patrz kryteria akceptacji).

## Poza zakresem

- Tryb ciemny (tokeny mają strukturę, która go umożliwi), PWA, manifest i web push (F-59).
- Baner zgód i strony prawne (F-41); F-06 dostarcza mechanizm, który bez zgody nie uruchamia analityki.
- Logowanie i sesja (F-07), wyszukiwarka i nawigacja po kategoriach (F-11, F-19), kreator (F-14). Linki w nagłówku prowadzą do przyszłych adresów (`/szukaj`, `/wystaw`, `/logowanie`), które do tego czasu zwracają 404.
- Docelowa identyfikacja wizualna: projektuje ją freelancer (§22 nr 8). Tokeny i logo tekstowe są tymczasowe, a ich podmiana nie wymaga zmian w komponentach.
- `sitemap.xml` (powstanie z aukcjami i kategoriami, F-18/F-19), wdrożenie na Vercel (F-09).

## UX

Szkice (siatka 4 px, odstępy z tokenów Tailwinda). Kolory i typografia wyłącznie z design tokens.

**Nagłówek, ≥ 768 px:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Przejdź do treści]  (widoczny tylko po fokusie klawiaturą)              │
│ Biddy   [ 🔍 Szukaj przedmiotów, np. Pokémon, Air Max…        ] [Wystaw przedmiot] [Zaloguj się] │
└──────────────────────────────────────────────────────────────────────────┘
```

**Nagłówek, 360–767 px:** w pierwszym wierszu logo i przyciski ikon z etykietami dostępności („Wystaw przedmiot”, „Zaloguj się”), w drugim pełna szerokość wyszukiwarki.

```
┌──────────────────────────────┐
│ Biddy              [＋] [👤] │
│ [ 🔍 Szukaj przedmiotów…   ] │
└──────────────────────────────┘
```

**Strona główna:** hero (nagłówek h1, akapit, przyciski „Przeglądaj aukcje” → `/szukaj` i „Wystaw przedmiot” → `/wystaw`), trzy karty wartości (licytacje z uczciwą ceną, Pakiet Ochrony Kupujących, 0% prowizji), sekcja nisz (kolekcjonerstwo, sneakersy i vintage, retro gaming) z linkami do wyszukiwania.

**Stopka:** grupy linków „Biddy” (O nas, Kontakt), „Pomoc” (Jak działa licytacja, Pakiet Ochrony Kupujących, Centrum pomocy), „Zasady” (Regulamin, Polityka prywatności, Zakazane przedmioty), wiersz z © rokiem.

**Stany:**

| Stan | Co widzi użytkownik |
|---|---|
| Ładowanie (`loading`) | Szkielet treści (bloki `Skeleton`) z tekstem dla czytników „Ładowanie…” (`aria-busy`, `role="status"`). |
| Pusty | Nie dotyczy (strona główna ma treść statyczną). Wzorzec pustych stanów powstanie z listami (F-19, F-21). |
| 404 | „Nie znaleźliśmy tej strony”, wyjaśnienie, przyciski „Strona główna” i „Szukaj przedmiotów”. Status HTTP 404, `noindex`. |
| Błąd segmentu | „Coś poszło nie tak”, przycisk „Spróbuj ponownie” (reset segmentu), link do strony głównej, identyfikator błędu (digest) do zgłoszenia. Błąd trafia do Sentry. |
| Błąd layoutu | Minimalna strona HTML z tym samym komunikatem (bez fontów i layoutu), zgłoszenie do Sentry. |

## Model danych

Brak zmian w bazie. Nowe pakiety: `packages/design-tokens`. Ciasteczko zgody `biddy_consent` (wartości po przecinku, np. `analytics`), zapisywane przez baner z F-41.

## API i zdarzenia

Bez nowych endpointów. Web korzysta z `GET /v1/time` (F-05) do synchronizacji zegara: offset `serverTime − (t0 + t1) / 2`, odświeżany co 5 minut, bez ponowień przy błędzie (offset 0, gdy API nie odpowiada).

## Reguły biznesowe i przypadki brzegowe

- Poza środowiskiem `local` brak `NEXT_PUBLIC_API_URL` albo `NEXT_PUBLIC_SITE_URL` przerywa build (lokalnie domyślnie `http://localhost:3001` i `http://localhost:3000`).
- `robots.txt` i meta `robots` blokują indeksowanie wszędzie poza produkcją (`NEXT_PUBLIC_ENVIRONMENT=production`), żeby staging i preview nie trafiły do Google.
- Linki w stopce prowadzą do stron informacyjnych, więc nie są pobierane z wyprzedzeniem (`prefetch={false}`): bez tego każde wejście na stronę pobierało dane wszystkich podstron.
- Zapytania TanStack Query nie ponawiają błędów 4xx (`ApiError` ze statusem 400–499), ponawiają maks. 2 razy błędy sieci i 5xx.
- Brak zgody, zgoda bez analityki albo brak klucza PostHog: PostHog nie jest ładowany.

## Bezpieczeństwo i prywatność

- Sentry bez danych osobowych (`dataCollection`: bez danych użytkownika, ciasteczek i treści żądań, jak w API), bez Session Replay; DSN klienta jest publiczny z założenia.
- PostHog w EU (`eu.i.posthog.com`), tylko po zgodzie (RODO, ePrivacy; §17 „Cookies: domyślnie tylko niezbędne”).
- Nagłówki bezpieczeństwa (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) w `next.config.ts`. Pełne CSP z nonce wymaga dynamicznego renderowania wszystkich stron (koszt dla ISR stron aukcji, §11.3), więc odkładamy je do F-42 razem z przeglądem bezpieczeństwa.
- Brak sekretów w zmiennych `NEXT_PUBLIC_*` (trafiają do przeglądarki).

## Analityka

Brak eventów w F-06 (pierwsze eventy dodają feature'y z akcjami: F-07, F-14, F-15). Mechanizm: `posthog.capture` dostępny przez wspólny moduł analityki dopiero po zgodzie.

## Kryteria akceptacji

- [ ] Given zbudowana aplikacja (`next build && next start`), When Lighthouse (profil mobilny) bada stronę główną, Then wynik wydajności i dostępności jest ≥ 90. **Do weryfikacji w F-42:** skrypt `pnpm --filter @biddy/web lighthouse` (mediana z 3 pomiarów) jest gotowy, ale nie blokuje CI. Ostatnie pomiary lokalne: dostępność 100, wydajność 87–97 (mediana 90–92); obniża ją symulowany LCP ok. 3 s przy FCP 0,8 s, przyczyna do zbadania przed startem (F-42, §19).
- [x] Given szerokość okna 360, 768, 1024 i 1440 px, When otwieram stronę główną i stronę 404, Then strona nie przewija się w poziomie, a nagłówek, wyszukiwarka i stopka są widoczne (Playwright).
- [x] Given dowolny plik `apps/web/src`, When używa koloru albo fontu, Then pochodzi on z design tokens: Tailwind nie ma domyślnej palety ani fontów, a test odrzuca wartości dowolne (`bg-[#…]`, `text-[13px]`, `font-[…]`) i literały kolorów poza pakietem tokenów.
- [x] Given strona główna i 404, When uruchamiam axe-core (WCAG 2.1 A i AA), Then nie ma naruszeń; link „Przejdź do treści” przenosi fokus do `<main>`.
- [x] Given brak zgody na analitykę, When odwiedzam stronę, Then nie ma żadnego żądania do PostHog; Given zgoda `analytics` i klucz PostHog, Then PostHog się inicjalizuje (test jednostkowy; e2e sprawdza przypadek bez zgody).
- [x] Given nieistniejący adres, When go otwieram, Then dostaję status 404 i stronę 404 po polsku z `noindex`.
- [x] Given layout aplikacji, When komponent kliencki używa klienta API, Then żądanie idzie pod `NEXT_PUBLIC_API_URL` z typami z `@biddy/api-client` (synchronizacja zegara przez wygenerowane `getServerTime`, `GET /v1/time`).

## Plan testów

- **Jednostkowe (Vitest, `pnpm --filter @biddy/web test`):** konfiguracja (`src/env.ts`, zgodność z `.env.example`), offset zegara, polityka ponowień zapytań, zgody i start PostHog, test „tylko tokeny” (skan źródeł). W `packages/design-tokens`: kontrast AA, gamut sRGB, motyw `theme.css`.
- **Komponenty (Testing Library):** nagłówek (logo, nawigacja, wyszukiwarka z etykietą), link „Przejdź do treści”, stopka.
- **E2E (Playwright, `pnpm --filter @biddy/web test:e2e` po `pnpm build`):** szerokości 360–1440 px na stronie głównej i 404, axe-core, klawiatura, tytuł i `lang`, wyszukiwanie przez formularz, 404 (status, `noindex`), `robots.txt`, nagłówki bezpieczeństwa, wywołanie `GET /v1/time` pod adresem API, brak żądań do PostHog bez zgody. API jest podmieniane (`page.route`).
- **Lighthouse (ręcznie):** `pnpm --filter @biddy/web lighthouse`, profil mobilny, progi 0,9 dla wydajności i dostępności, raport w `apps/web/.lighthouse/`.

## Otwarte pytania

- Docelowa paleta, typografia i logo (freelancer, §22 nr 8). **Domyślnie:** tymczasowe tokeny (granat i pomarańcz, font Inter) i logo tekstowe; podmiana przez `packages/design-tokens`.
- Tryb ciemny: **domyślnie** poza MVP; struktura tokenów (kolory semantyczne) pozwala go dodać bez zmian w komponentach.
- Hosting web (Vercel, §11.6) i zmienne środowisk: ustala F-09.
