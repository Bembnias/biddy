# F-12 · Zdjęcia: upload i przetwarzanie

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-04 (zdjęcie profilowe: F-10)

## Kontekst i cel

Zdjęcia sprzedają przedmiot, ale są też ryzykiem: metadane EXIF zawierają współrzędne GPS (często adres domowy sprzedającego), pliki mogą nie być obrazami albo być „bombami dekompresji”, a treść może łamać regulamin ([PROJECT.md §16.1](../PROJECT.md#161-bezpieczeństwo-aplikacji)). F-12 dostarcza bezpieczny upload prosto do magazynu (Cloudflare R2, lokalnie RustFS), przetwarzanie w workerze, moderację przez adapter i sprzątanie porzuconych plików. Z tego korzystają kreator wystawiania (F-14, do 20 zdjęć) i zdjęcie profilowe (odłożone w F-10).

## Historyjki użytkownika

- Jako sprzedający chcę dodać zdjęcia z telefonu albo komputera, ustawić zdjęcie główne i kolejność.
- Jako sprzedający nie chcę, żeby ze zdjęcia dało się odczytać, gdzie mieszkam.
- Jako użytkownik chcę ustawić zdjęcie profilowe.
- Jako moderator chcę, żeby podejrzane zdjęcia nie były publiczne, dopóki ich nie sprawdzę.
- Jako platforma nie chcemy płacić za pliki, których nikt nie użył.

## Zakres

- **Trzy kubełki:** `uploads` (prywatny: oryginały i zdjęcia zatrzymane przez moderację), `media` (publiczny przez CDN: tylko przetworzone, zatwierdzone zdjęcia), `documents` (bez zmian, F-24/F-27). Oryginał z EXIF nigdy nie jest publiczny.
- **Upload:** `POST /v1/media/uploads` tworzy rekord i zwraca presigned PUT (ważny 15 minut) z podpisanym typem i rozmiarem pliku. R2 nie obsługuje presigned POST z limitem rozmiaru, więc podpisujemy dokładny rozmiar zadeklarowany przez klienta (maks. 15 MB). Typy: JPEG, PNG, WebP. HEIC z iPhone'a Safari zamienia na JPEG przy uploadzie z formularza.
- **Potwierdzenie:** `POST /v1/media/{id}/complete` sprawdza, że plik jest w magazynie, i dodaje job `media.process` (kolejka `media`).
- **Przetwarzanie w workerze (sharp):** odczyt z limitem 40 MP (ochrona przed bombami dekompresji), sprawdzenie rzeczywistego formatu (nie nagłówka od klienta), obrót według orientacji EXIF, **ponowne kodowanie do WebP bez żadnych metadanych**, warianty:
  - zdjęcie przedmiotu: `thumb` 320 px, `medium` 800 px, `large` 1600 px (dłuższy bok, bez powiększania), min. 300 px na krótszym boku;
  - zdjęcie profilowe: kwadrat `small` 96 px i `large` 256 px (wykadrowany środek), min. 96 px.
  Oryginał jest usuwany po przetworzeniu.
- **Moderacja:** adapter `ImageModerator` z atrapą (oznacza obrazy prawie w całości czerwone, do testów i ręcznego sprawdzania). Zdjęcie oznaczone ma status `FLAGGED`: warianty nie trafiają do publicznego kubełka, kopia do wglądu leży w prywatnym `uploads/quarantine/`, a event domenowy `MediaFlagged` (outbox) zasila kolejkę moderacji (F-35).
- **Statusy:** `PENDING_UPLOAD` → `PROCESSING` → `READY` | `FLAGGED` | `REJECTED` (z powodem po polsku). Adresy publiczne ma tylko `READY`.
- **Limity:** 50 uploadów na konto na godzinę (429). Liczbę zdjęć przedmiotu (20) pilnuje kreator (F-14).
- **Przypisanie:** publiczne API modułu `media` (`MediaService.attach`) oznacza zdjęcia jako użyte (przedmiot w F-14, zdjęcie profilowe tutaj). **Sprzątanie:** job co godzinę usuwa nieprzypisane zdjęcia starsze niż 24 h (rekord i pliki w obu kubełkach).
- **Zdjęcie profilowe (z F-10):** `PUT /v1/me/avatar` `{ mediaId }` ustawia zdjęcie, `DELETE /v1/me/avatar` je usuwa. Endpointy są w module `media` (on zna zdjęcia, a profil zapisuje przez publiczne API modułu `identity`), więc moduły nie importują się nawzajem. `GET /v1/me`, `GET /v1/session` i profil publiczny zwracają `avatarUrl`. Poprzednie zdjęcie przestaje być przypisane i znika z kolejnym sprzątaniem.
- **Web:** `PhotoUploader` (wiele zdjęć, postęp, zdjęcie główne, zmiana kolejności przyciskami, usuwanie, statusy; dla F-14) i zdjęcie profilowe na `/konto/profil`. `UserAvatar` pokazuje zdjęcie, jeśli jest.

## Poza zakresem

- Prawdziwy dostawca moderacji obrazów (np. Cloudflare, Sightengine, AWS Rekognition): wybór i umowa przed startem; F-12 daje adapter i atrapę.
- Panel kolejki moderacji (F-35), edycja i kadrowanie zdjęć w przeglądarce, wideo.
- Zdjęcia w sporach (F-28: prywatne przeznaczenie `DISPUTE_EVIDENCE` z wariantami w kubełku `uploads`).

## UX

**PhotoUploader:**

```
Zdjęcia (3/20)                                   [ + Dodaj zdjęcia ]
┌────────┐ ┌────────┐ ┌────────┐
│  img   │ │  img   │ │ ⏳ 64% │
│Główne  │ │        │ │        │
└────────┘ └────────┘ └────────┘
 [→] [Usuń]  [←][→][Usuń]  [Usuń]
JPEG, PNG albo WebP, do 15 MB. Pierwsze zdjęcie jest zdjęciem głównym.
```

| Stan zdjęcia | Wygląd |
|---|---|
| Wysyłanie | pasek postępu (`role="progressbar"`) |
| Przetwarzanie | „Przetwarzanie…” |
| Gotowe | miniatura, akcje |
| Do sprawdzenia (`FLAGGED`) | „Zdjęcie czeka na sprawdzenie przez moderatora” (bez podglądu) |
| Odrzucone / błąd | powód po polsku, przycisk „Usuń” |

Plik za duży albo w złym formacie: komunikat od razu, bez wysyłki. Limit 20 zdjęć: przycisk dodawania nieaktywny.

**Zdjęcie profilowe (`/konto/profil`):** podgląd (avatar), „Zmień zdjęcie”, „Usuń zdjęcie”.

## Model danych

Migracja `0007_media` (moduł `media`):

- `media`: `id`, `owner_id` (uuid bez FK, decyzja F-07), `purpose` (`ITEM_PHOTO`/`AVATAR`), `status`, `content_type`, `size_bytes`, `width`, `height`, `rejection_reason`, `moderation_labels`, `attached_at`, `processed_at`, `created_at`, `updated_at`. Indeksy: (`owner_id`, `created_at`), nieprzypisane (`created_at`) gdzie `attached_at is null`.
- `users`: `avatar_media_id` (uuid, bez FK: zdjęcie należy do modułu `media`) i `avatar_url` (adres wariantu `large`, żeby sesja i profil nie pytały modułu `media`).

Klucze w magazynie: `uploads/incoming/{ownerId}/{mediaId}`, `uploads/quarantine/{mediaId}.webp`, `media/{purpose}/{mediaId}/{wariant}.webp` (niezmienne, `cache-control: public, max-age=31536000, immutable`).

## API i zdarzenia

- `POST /v1/media/uploads` `{ purpose, contentType, sizeBytes }` → 201 `{ media: MediaDto, upload: { url, method: 'PUT', headers, expiresAt } }`; zły typ albo rozmiar: 400 `VALIDATION_FAILED`; limit: 429.
- `POST /v1/media/{id}/complete` → 202 `MediaDto` (`PROCESSING`); pliku nie ma w magazynie: 409 `MEDIA_NOT_UPLOADED`.
- `GET /v1/media/{id}` → `MediaDto` (`id`, `purpose`, `status`, `width`, `height`, `urls` albo null, `rejectionReason`, `createdAt`); tylko właściciel (inaczej 404).
- `DELETE /v1/media/{id}` → 204 (nieprzypisane zdjęcie właściciela).
- `PUT /v1/me/avatar` `{ mediaId }` → 200 `{ avatarUrl }`: zdjęcie musi być własne, `READY` i `AVATAR` (inaczej 400 `VALIDATION_FAILED`). `DELETE /v1/me/avatar` → 204.
- Event `MediaFlagged` (`mediaId`, `ownerId`, `purpose`, `labels`): konsument w F-35.
- Nowy kod błędu: `MEDIA_NOT_UPLOADED` (409).

## Reguły biznesowe i przypadki brzegowe

- `complete` jest idempotentne: ponowne wywołanie dla zdjęcia w przetwarzaniu albo przetworzonego zwraca jego stan.
- Job jest idempotentny (job ID z identyfikatorem zdjęcia; zdjęcie poza `PROCESSING` jest pomijane).
- Plik większy niż zadeklarowany odrzuca magazyn (podpisany rozmiar); plik, który nie jest obrazem, dostaje `REJECTED` w workerze.
- Usunięcie przez właściciela albo sprzątanie usuwa pliki we wszystkich miejscach (oryginał, warianty, kwarantanna).

## Bezpieczeństwo i prywatność

- Oryginały (z EXIF i GPS) tylko w prywatnym kubełku, usuwane po przetworzeniu; publiczne są wyłącznie warianty przekodowane bez metadanych (test sprawdza brak EXIF i GPS).
- Presigned URL: krótki czas życia, podpisany typ i rozmiar, klucz z identyfikatorem właściciela.
- Dekodowanie z limitem pikseli; format z zawartości pliku, nie z nagłówka.
- Kubełek `uploads` ma CORS tylko dla PUT z originów Biddy; `media` jest tylko do odczytu.

## Analityka

PostHog (po zgodzie): `photo_uploaded` (`purpose`), `photo_rejected` (`reason`), `avatar_updated`.

## Kryteria akceptacji

- [x] Given zdjęcie z EXIF (w tym GPS), Then warianty po przetworzeniu nie zawierają metadanych EXIF ani GPS (test na prawdziwym magazynie S3).
- [x] Given plik za duży albo w złym typie, Then API odrzuca żądanie uploadu; given plik, który nie jest obrazem, Then zdjęcie ma status `REJECTED` z powodem po polsku.
- [x] Given zdjęcie oznaczone przez moderację, Then nie ma go w publicznym kubełku, właściciel widzi „do sprawdzenia”, a event `MediaFlagged` jest w outboxie.
- [x] Given nieprzypisane zdjęcie starsze niż 24 h, Then sprzątanie usuwa rekord i pliki.

## Plan testów

- **API, jednostkowe:** przetwarzanie (warianty, brak EXIF, obrót, limity, nie-obraz), atrapa moderacji, konfiguracja.
- **API, integracyjne (Postgres, Redis, RustFS w Testcontainers):** pełna ścieżka przez presigned PUT i worker, brak EXIF w publicznych wariantach, zły typ i rozmiar, nie-obraz, moderacja (prywatność, event), właściciel, limit, sprzątanie, zdjęcie profilowe.
- **Web, jednostkowe:** `PhotoUploader` (walidacja plików, postęp, statusy, kolejność, usuwanie), zdjęcie profilowe.
- **Web, e2e:** zdjęcie profilowe na atrapie API i magazynu, axe-core.

## Otwarte pytania

- Dostawca moderacji obrazów: **domyślnie** atrapa do czasu wyboru (przed startem, umowa powierzenia danych).
- Reguła cyklu życia w R2 dla `uploads/incoming/` (np. 2 dni) jako zabezpieczenie: **domyślnie** ustawiona w panelu Cloudflare (docs/deployment.md).
