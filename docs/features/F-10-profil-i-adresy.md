# F-10 · Profil i adresy

**Status:** Review
**Rozmiar:** S · **Właściciel:** Mateusz Bienias · **Zależności:** F-07, F-08 (avatar: F-12)

## Kontekst i cel

Użytkownik zarządza swoim profilem i adresami ([PROJECT.md §4](../PROJECT.md#4-role-użytkowników), §13.3, §14.1). Profil publiczny buduje zaufanie między kupującym a sprzedającym: kto to jest, od kiedy jest na Biddy, czy ma zweryfikowany telefon, a później jego aukcje (F-14) i oceny (F-30). Adresy są potrzebne przy zakupie (adres dostawy, F-22) i nadaniu paczki (adres nadawcy, F-24).

## Historyjki użytkownika

- Jako użytkownik chcę zmienić imię wyświetlane, żeby inni widzieli mnie tak, jak chcę.
- Jako kupujący chcę zapisać adres dostawy i oznaczyć go jako domyślny, żeby nie wpisywać go przy każdym zakupie.
- Jako sprzedający chcę mieć domyślny adres nadania, żeby szybko nadawać paczki.
- Jako kupujący chcę zobaczyć profil sprzedającego (od kiedy jest na Biddy, czy jest zweryfikowany), zanim zalicytuję.
- Jako użytkownik nie chcę, żeby ktokolwiek zobaczył mój e-mail, telefon ani adres na moim profilu.

## Zakres

- **Profil:** `PATCH /v1/me` zmienia imię wyświetlane. Reguły imienia są wspólne dla web i API (`@biddy/shared`) i obowiązują także przy rejestracji: 2–60 znaków po przycięciu i scaleniu spacji; litery, cyfry, spacja, kropka, myślnik, podkreślnik i apostrof. Imię nie może zawierać danych kontaktowych: adresu WWW ani co najmniej 6 cyfr (np. numeru telefonu). Obchodzenie płatności przez kontakt poza platformą jest główną drogą oszustw (PROJECT.md §16.2).
- **Better Auth:** zmiana profilu tylko przez `PATCH /v1/me`. Trasa `/v1/auth/update-user` jest zablokowana (pozwalała ustawić dowolne imię i adres obrazka z pominięciem reguł), a rejestracja odrzuca pole `image` i stosuje reguły imienia.
- **Avatar:** do F-12 inicjały imienia na kolorowym tle (kolor z identyfikatora). Upload, przycinanie i moderacja zdjęcia to F-12; obrazek z Google/Apple (`users.image`) nie jest pokazywany publicznie.
- **Profil publiczny:** `GET /v1/users/{id}` i strona `/u/{id}`: imię, inicjały, „Na Biddy od” (miesiąc i rok), znaczek „Zweryfikowany telefon”, sekcja aktywnych aukcji (pusta do F-14/F-18) i miejsce na oceny (F-30). Bez e-maila, telefonu, adresów i statusu konta. Konto zablokowane ma 404.
- **Adresy:** `GET/POST /v1/me/addresses`, `PATCH/DELETE /v1/me/addresses/{id}`. Pola: odbiorca (imię i nazwisko albo firma), ulica z numerem, kod pocztowy, miasto, telefon (polski komórkowy, potrzebny przewoźnikom), kraj (`PL`). Maks. 10 adresów na konto.
  - Adres domyślny dostawy i domyślny adres nadania: najwyżej po jednym na konto (indeksy unikalne częściowe w bazie). Ustawienie nowego domyślnego zdejmuje flagę z poprzedniego w tej samej transakcji.
  - Pierwszy adres staje się domyślny dla dostawy i nadania. Usunięcie domyślnego adresu nie wybiera nowego (bez zaskoczeń przy zakupie: checkout poprosi o wybór).
  - Kod pocztowy w formacie `NN-NNN`; pole przyjmuje też `NNNNN` i zapisuje z myślnikiem.
- **Web:** `/konto/profil` (imię), `/konto/adresy` (lista, dodawanie, edycja, domyślne, usuwanie z potwierdzeniem), `/u/{id}` (profil publiczny, renderowany na serwerze); na `/konto` linki do tych stron.

## Poza zakresem

- Zdjęcie profilowe (F-12), opis profilu, zmiana e-maila (później, z ponowną weryfikacją).
- Lista aukcji na profilu (F-14 dostarczy dane, F-18 listy), oceny (F-30), obserwowanie sprzedawców (F-31).
- Adresy zagraniczne i firmowe dane do faktur (DAC7, F-38).
- Sprawdzanie zgodności kodu pocztowego z miastem (słownik TERYT/Poczty Polskiej): po starcie, jeśli przewoźnicy będą odrzucać adresy.

## UX

**Profil publiczny (`/u/{id}`):**

```
┌───────────────────────────────────────────┐
│ (KK)  Kasia Kupująca                      │
│       Na Biddy od października 2026       │
│       ✓ Zweryfikowany telefon             │
├───────────────────────────────────────────┤
│ Aktywne aukcje                            │
│ Brak aktywnych aukcji.                    │
├───────────────────────────────────────────┤
│ Oceny                                     │
│ Oceny pojawią się po pierwszych           │
│ transakcjach.                             │
└───────────────────────────────────────────┘
```

**Adresy (`/konto/adresy`):** karty adresów z oznaczeniami „Domyślny adres dostawy” i „Domyślny adres nadania” oraz akcjami „Edytuj”, „Ustaw jako domyślny do dostawy”, „Ustaw jako domyślny do nadania” i „Usuń” (okno potwierdzenia). Przycisk „Dodaj adres” prowadzi do `/konto/adresy/nowy`; edycja to `/konto/adresy/{id}`. Pusty stan: „Nie masz jeszcze adresów” z przyciskiem „Dodaj adres”. Telefon w formularzu jest podpowiadany numerem zweryfikowanym w F-08.

**Stany:**

| Ekran | Ładowanie | Błąd | Sukces |
|---|---|---|---|
| Profil (edycja) | „Zapisywanie…” | błąd pola (`aria-describedby`) z regułami imienia | komunikat „Zapisano” (`role="status"`) |
| Adresy (lista) | SSR | brak sesji → `/logowanie?next=/konto/adresy` | lista albo pusty stan |
| Adres (formularz) | „Zapisywanie…” | błędy pól; limit 10 adresów; adres nie istnieje → 404 | powrót do listy |
| Usuwanie adresu | przycisk wyłączony | komunikat `role="alert"` | adres znika z listy |
| Profil publiczny | SSR | nieznany albo zablokowany użytkownik → 404 | dane profilu |

## Model danych

Migracja `0004_addresses` (moduł `identity`):

- `addresses`: `id`, `user_id` → `users` (FK, kaskada), `recipient_name`, `street`, `postal_code`, `city`, `country` (`PL`), `phone` (E.164), `is_default`, `is_sender_default`, `created_at`, `updated_at`. Indeksy unikalne częściowe: (`user_id`) gdzie `is_default`, (`user_id`) gdzie `is_sender_default`; indeks (`user_id`, `created_at`).
- `users`: bez zmian (`name` to imię wyświetlane; `avatar_key` doda F-12).

## API i zdarzenia

- `PATCH /v1/me` `{ name }` → 200 `MeDto`.
- `GET /v1/users/{id}` → 200 `PublicProfileDto` `{ id, name, memberSince, phoneVerified }`; 404 dla nieznanego i zablokowanego konta. Publiczny (bez sesji), `cache-control: public, max-age=60`.
- `GET /v1/me/addresses` → `AddressDto[]` (najpierw domyślny adres dostawy, potem od najnowszego).
- `POST /v1/me/addresses` → 201 `AddressDto`; 409 `ADDRESS_LIMIT_REACHED` po 10 adresach.
- `PATCH /v1/me/addresses/{id}` (pola częściowe, w tym `isDefault: true`, `isSenderDefault: true`) → 200 `AddressDto`; cudzy albo nieistniejący adres → 404.
- `DELETE /v1/me/addresses/{id}` → 204.
- `/v1/auth/update-user` → 403 `FORBIDDEN` (zmiana profilu przez `PATCH /v1/me`).
- Nowy kod błędu: `ADDRESS_LIMIT_REACHED` (409). Złe imię, kod pocztowy albo telefon: 400 `VALIDATION_FAILED` z błędem pola.
- Moduł `identity` udostępnia `AddressService` innym modułom (np. domyślny adres nadania dla `shipping`, F-24).
- Eventy domenowe: brak (pierwszy konsument adresów to checkout, który kopiuje adres do zamówienia).

## Reguły biznesowe i przypadki brzegowe

- Flagi domyślności można tylko ustawić (`true`); zdjęcie flagi następuje przez ustawienie innego adresu albo usunięcie adresu.
- Edycja adresu nie zmienia zamówień i przesyłek, które już go użyły (F-22 i F-24 zapisują kopię adresu).
- Imię jest normalizowane (przycięcie, pojedyncze spacje) przed zapisem; zmiana imienia nie zmienia historii ofert (oferty pokazują zanonimizowanych licytujących, §6).
- Identyfikator w adresie profilu to UUID konta; nie zdradza niczego poza przybliżoną datą założenia, którą profil i tak pokazuje.

## Bezpieczeństwo i prywatność

- Profil publiczny zwraca tylko pola z listy wyżej (DTO z `@ZodResponse`, pola spoza kontraktu nie wychodzą); test sprawdza, że odpowiedź nie zawiera e-maila, telefonu ani adresów.
- Adresy widzi tylko właściciel; zapytania zawsze filtrują po `user_id` z sesji (cudzy identyfikator to 404, nie 403, żeby nie zdradzać istnienia).
- Zmiany profilu i adresów (POST, PATCH, DELETE) chroni CSRF z F-07.
- Adresy i telefon to dane osobowe: usuwane z kontem (kaskada; anonimizacja w F-41), nie trafiają do logów.

## Analityka

PostHog (po zgodzie): `profile_updated`, `address_saved` (`is_new`), `address_deleted`.

## Kryteria akceptacji

- [x] Given profil publiczny dowolnego konta, Then odpowiedź i strona nie zawierają e-maila, telefonu ani adresu.
- [x] Given kilka adresów, When użytkownik ustawia inny adres jako domyślny (dostawy albo nadania), Then dokładnie jeden adres ma tę flagę (także przy równoległych żądaniach).
- [x] Given kod pocztowy `00950`, Then adres zapisuje się z `00-950`; `1234` jest odrzucany z komunikatem po polsku.
- [x] Given imię z numerem telefonu albo adresem WWW, Then `PATCH /v1/me` i rejestracja odrzucają je z komunikatem; `/v1/auth/update-user` jest zablokowane.
- [x] Given cudzy identyfikator adresu, Then edycja i usunięcie zwracają 404.

## Plan testów

- **Shared, jednostkowe:** reguły imienia wyświetlanego, normalizacja kodu pocztowego.
- **API, integracyjne:** zmiana imienia (i odrzucenie danych kontaktowych), blokada `/update-user` i pola `image` przy rejestracji, profil publiczny (pola, 404 dla zablokowanego), CRUD adresów, domyślne flagi (także równolegle), limit 10, cudzy adres 404, CSRF.
- **Web, jednostkowe:** formularz imienia i adresu (walidacja, błędy z API), lista adresów (akcje, potwierdzenie usunięcia).
- **Web, e2e:** edycja profilu, dodanie, ustawienie domyślnego i usunięcie adresu (atrapa SSR ze stanem per test), profil publiczny z SSR (bez danych kontaktowych, adres kanoniczny), 404 dla przeglądarki i robota, axe-core.
- **Uwaga techniczna:** szkielet ładowania z F-06 przeniesiony do `app/konto/loading.tsx`. Globalna granica Suspense wysyłała status 200, zanim profil wywołał `notFound()`, więc nieznany profil nie dawał 404 (PROJECT.md §22 nr 51).

## Otwarte pytania

- Ograniczenie częstotliwości zmiany imienia (np. raz na 30 dni) przeciw podszywaniu się: **domyślnie** bez limitu; wrócimy do tego przy ocenach (F-30), kiedy imię zacznie nieść reputację.
