# F-20 · Obserwowane i powiadomienia

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-04, F-07, F-15, F-16, F-17, F-18

## Kontekst i cel

Aukcja to ważne momenty: ktoś przebił ofertę, aukcja zaraz się kończy, wygrana, sprzedaż. Użytkownik nie może ich przegapić, także gdy nie ma otwartej strony ([PROJECT.md §5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety)). Jednocześnie e-maile nie mogą zasypywać skrzynki: przy licytacji przebicia potrafią przychodzić co minutę, a każdy e-mail z powiadomieniem musi dać się wyłączyć jednym kliknięciem.

F-20 dodaje obserwowane aukcje i obserwowanych sprzedawców, moduł `notifications` z centrum powiadomień w aplikacji (z aktualizacją na żywo przez F-17), e-mailami w React Email (`packages/emails`) i preferencjami per typ i kanał. Web push to F-59, push w aplikacji mobilnej F-37.

## Historyjki użytkownika

- Jako kupujący obserwuję aukcję i dostaję powiadomienie godzinę przed końcem.
- Jako licytujący od razu wiem, że ktoś mnie przebił, a e-mail o tym dostaję najwyżej raz na 15 minut na aukcję.
- Jako zwycięzca dostaję powiadomienie i e-mail z kwotą i terminem płatności; jako sprzedający: o sprzedaży albo o tym, że aukcja zakończyła się bez sprzedaży.
- Jako kupujący obserwuję sprzedawcę i wiem o jego nowych aukcjach.
- Jako użytkownik wyłączam e-maile danego typu w ustawieniach albo jednym kliknięciem z e-maila.

## Zakres

### Obserwowanie

- **Obserwowane aukcje** (tabela `watchlist`, moduł `auctions`): `PUT`/`DELETE /v1/me/watchlist/{auctionId}` (tylko aktywna aukcja; własnej nie obserwujemy). Stan w `GET /v1/me/bids/{id}` (`watching`, F-18). Lista obserwowanych to F-21 (Moje Biddy).
- **Obserwowani sprzedawcy** (tabela `user_follows`, moduł `identity`): `PUT`/`DELETE /v1/me/followed-sellers/{userId}`, `GET /v1/me/followed-sellers/{userId}` → `{ following }`. Nie można obserwować siebie; zablokowany albo nieistniejący sprzedawca: 404.

### Powiadomienia (moduł `notifications`)

| Typ | Kto | Kiedy (źródło) | E-mail domyślnie |
|---|---|---|---|
| `OUTBID` | poprzedni lider | `UserOutbid` | tak, najwyżej raz na 15 min na aukcję |
| `ENDING_SOON` | obserwujący i licytujący (bez sprzedającego) | 1 h przed końcem (job z terminem po `AuctionPublished`) | tak |
| `WON` | zwycięzca | `OrderCreated` (czas albo Kup teraz) | zawsze (transakcyjny) |
| `SOLD` | sprzedający | `OrderCreated` | zawsze (transakcyjny) |
| `UNSOLD` | sprzedający | `AuctionEnded` z `UNSOLD` | tak |
| `AUCTION_CANCELLED` | licytujący i obserwujący (§6.6) | `AuctionCancelled` | tak |
| `FOLLOWED_SELLER_NEW_AUCTION` | obserwujący sprzedawcę | `AuctionPublished` | nie |

- **Zapis:** konsument eventu tworzy powiadomienie w transakcji obsługi eventu z kluczem deduplikacji (`{typ}:{źródło}`, unikalny z `user_id`), więc ponowne dostarczenie eventu nie tworzy duplikatu. Treść (tytuł aukcji, ceny, terminy) to migawka z chwili zdarzenia. W tej samej transakcji powstaje event `NotificationCreated`: dostarczenie rusza dopiero po zatwierdzeniu (job dodany w transakcji mógłby wykonać się przed commitem).
- **Dostarczenie:** konsument `notifications.deliver` eventu `NotificationCreated`: zdarzenie na żywo `notification.new` do pokoju `user:{id}` (F-17) z licznikiem nieprzeczytanych, potem e-mail, jeśli kanał jest włączony, konto ma potwierdzony adres i nie jest zablokowane. E-mail `OUTBID`: pominięty, gdy w ostatnich 15 min wysłaliśmy już e-mail o przebiciu w tej aukcji (`emailed_at`). E-mail przez kolejkę `emails` (ID joba z ID powiadomienia).
- **„Kończy się za 1 h”:** job `notifications.ending-soon` z terminem `endsAt − 1 h` (ID z terminem); przy wykonaniu sprawdza, czy aukcja jest aktywna i kończy się w ciągu godziny (inaczej przesuwa się na nowy termin albo kończy).
- **Centrum powiadomień (API):** `GET /v1/me/notifications?before=` (od najnowszych, po 30, z tytułem, treścią, adresem i `read`), `GET /v1/me/notifications/summary` (`unreadCount`), `POST /v1/me/notifications/read` `{ ids }` albo `{ all: true }`. Tytuł i treść po polsku buduje API (te same w web i mobile).
- **Preferencje:** `GET`/`PUT /v1/me/notification-preferences` (tabela `notification_preferences`: `user_id`, `type`, `channel`, `enabled`; brak wiersza = wartość domyślna z tabeli wyżej). W MVP konfigurowalny jest kanał `EMAIL` (in-app zawsze włączone, push w F-59/F-37); e-maile transakcyjne (`WON`, `SOLD`) nie są konfigurowalne.
- **Wypisanie z e-maili jednym kliknięciem:** każdy e-mail z powiadomieniem (poza transakcyjnymi) ma nagłówki `List-Unsubscribe` i `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) z adresem `{WEB_URL}/api/wypisz?token=…` i link w stopce do strony `/wypisz?token=…` z jednym przyciskiem. Token: podpis HMAC (klucz wyprowadzony z `BETTER_AUTH_SECRET`) użytkownika i typu, bez wygasania. API: `GET /v1/notifications/unsubscribe?token=` (co wyłączymy) i `POST /v1/notifications/unsubscribe` `{ token }` (wyłącza e-mail danego typu albo wszystkich typów). Web przyjmuje POST z formularza od klienta poczty i woła API (API zostaje przy samym JSON, F-03).

### E-maile (`packages/emails`)

- Szablony w React Email (`@react-email/components`): wspólny układ (logo tekstowe, treść, przycisk, stopka z ustawieniami powiadomień i wypisaniem), szablony powiadomień i przeniesione szablony kont (weryfikacja adresu, reset hasła, F-07). Funkcja zwraca `{ subject, html, text }` (tekst z HTML). Kolory z `@biddy/design-tokens`.

### Web

- **Strona aukcji:** przycisk „Obserwuj” / „Obserwujesz” (gość: logowanie z powrotem na aukcję).
- **Profil publiczny:** „Obserwuj sprzedawcę” / „Obserwujesz”.
- **Nagłówek:** dzwonek z liczbą nieprzeczytanych (zalogowani), aktualizowany na żywo (`notification.new`), link do `/powiadomienia`.
- **`/powiadomienia`:** lista (nieprzeczytane wyróżnione), kliknięcie oznacza jako przeczytane i prowadzi do aukcji, „Oznacz wszystkie jako przeczytane”, „Pokaż starsze”.
- **`/konto/powiadomienia`:** e-maile per typ (przełączniki), opis, które są zawsze wysyłane.
- **`/wypisz?token=`:** co wyłączymy, przycisk „Wypisz mnie”, potwierdzenie i link do ustawień (bez logowania).

## Poza zakresem

- Web push (F-59), push mobilny (F-37), SMS o wygranej wysokiej wartości (później), powiadomienia o zamówieniach i wiadomościach (F-25, F-26, F-29).
- Lista obserwowanych aukcji i sprzedawców (F-21), powiadomienie o nowym urządzeniu (v1).
- Zbiorczy e-mail (digest) o nowych aukcjach obserwowanych sprzedawców.

## UX

- Dzwonek: ikona z liczbą (do „9+”), etykieta „Powiadomienia, 3 nieprzeczytane”. Lista: tytuł, treść, czas względny („5 min temu”), kropka przy nieprzeczytanych.
- E-mail: temat = tytuł powiadomienia, krótka treść, jeden przycisk („Licytuj ponownie”, „Zobacz aukcję”, „Przejdź do aukcji”), stopka: „Nie chcesz takich e-maili? Wypisz się” i „Ustawienia powiadomień”.
- Teksty bez form zależnych od płci („Przebito Twoją ofertę”, „Wygrana: …”).

## Model danych

Migracja `0014_notifications`:

- `watchlist` (moduł `auctions`): `user_id`, `auction_id` (FK), `created_at`; klucz (`user_id`, `auction_id`), indeks `auction_id`.
- `user_follows` (moduł `identity`): `follower_id`, `seller_id` (FK `users`), `created_at`; klucz (`follower_id`, `seller_id`), indeks `seller_id`, `follower_id <> seller_id`.
- `notifications`: `id`, `user_id`, `type`, `auction_id` (do limitu e-maili), `payload` (jsonb, migawka), `dedupe_key`, `read_at`, `emailed_at`, `created_at`; unikalne (`user_id`, `dedupe_key`), indeksy (`user_id`, `created_at`), (`user_id`) dla nieprzeczytanych.
- `notification_preferences`: `user_id`, `type`, `channel`, `enabled`, `updated_at`; klucz (`user_id`, `type`, `channel`).

## API i zdarzenia

- Trasy jak wyżej; `MyBiddingDto.watching`.
- Realtime: `notification.new` `{ id, type, title, body, url, createdAt, unreadCount }` w pokoju `user:{id}` (`@biddy/realtime`).
- Kolejka `notifications` (współbieżność 10): `notifications.ending-soon`; dostarczenie przez konsumenta `notifications.deliver` (event `NotificationCreated`).
- Konsumenci `notifications.*` dla `UserOutbid`, `AuctionPublished` (obserwujący sprzedawcę i planowanie „kończy się”), `OrderCreated`, `AuctionEnded`, `AuctionCancelled`.
- Konfiguracja: worker wymaga na produkcji `BETTER_AUTH_SECRET` (podpis linków wypisania; Render już go przekazuje), adres web z `WEB_URL`.

## Reguły biznesowe i przypadki brzegowe

- Powiadomienia in-app są natychmiastowe (job po zapisie, bez czekania); e-mail `OUTBID` najwyżej raz na 15 min na (użytkownik, aukcja).
- Kto przebije sam siebie (podniesienie maksimum), nie dostaje `OUTBID` (F-15 nie emituje wtedy `UserOutbid`).
- „Kończy się za 1 h” raz na aukcję i użytkownika (deduplikacja), także po przedłużeniu w końcówce.
- Konto niepotwierdzone albo zablokowane: tylko in-app, bez e-maili.
- Wypisanie z e-maili nie wyłącza powiadomień in-app; link wypisania działa bez logowania i po latach.

## Bezpieczeństwo i prywatność

- Lista powiadomień i preferencje tylko dla zalogowanego właściciela.
- Token wypisania podpisany (HMAC), porównanie w stałym czasie; nie ujawnia adresu e-mail.
- Treść e-maili bez danych innych użytkowników poza zanonimizowanym liderem i nazwą sprzedawcy (publiczną).
- Obserwujący sprzedawcę nie są widoczni publicznie.

## Analityka

PostHog (po zgodzie): `auction_watched` (`watching`), `seller_followed` (`following`), `notification_opened` (`type`), `email_unsubscribed` (`type`).

## Kryteria akceptacji

- [x] Given przebity użytkownik, Then dostaje powiadomienie in-app od razu (także na żywo), a e-mail najwyżej raz na 15 minut na aukcję.
- [x] Given e-mail z powiadomieniem, Then ma nagłówki `List-Unsubscribe` (One-Click) i link w stopce; POST z klienta poczty albo przycisk na stronie wypisuje z e-maili danego typu.
- [x] Given wyłączony e-mail danego typu, Then e-mail nie wychodzi, a powiadomienie in-app tak.
- [x] Given ponowne dostarczenie eventu, Then nie powstaje drugie powiadomienie ani drugi e-mail.
- [x] Given obserwowana aukcja, Then obserwujący dostaje „kończy się za 1 h”; obserwujący sprzedawcę dostaje powiadomienie o jego nowej aukcji.
- [x] Given koniec aukcji, Then zwycięzca dostaje `WON`, sprzedający `SOLD` albo `UNSOLD`.

## Plan testów

- **Emails, jednostkowe:** każdy szablon renderuje HTML i tekst z danymi, stopka z linkiem wypisania (bez niego dla transakcyjnych).
- **API, jednostkowe:** teksty powiadomień, token wypisania (podpis, zmiana typu, zły podpis), domyślne preferencje.
- **API, integracyjne (worker, Mailpit/atrapa poczty):** obserwowanie i obserwowani (walidacje), przebicie → in-app + e-mail, drugie przebicie w 15 min → bez e-maila, ponowne dostarczenie eventu → bez duplikatu, preferencja wyłączona → bez e-maila, wypisanie tokenem, kończy się za 1 h (job), wygrana/sprzedaż/brak sprzedaży, anulowanie, nowa aukcja obserwowanego sprzedawcy, lista i oznaczanie jako przeczytane, `notification.new` przez Socket.IO.
- **Web, jednostkowe:** dzwonek (licznik, aktualizacja na żywo), lista, ustawienia, przyciski obserwowania.
- **Web, e2e:** obserwowanie aukcji i sprzedawcy, centrum powiadomień, ustawienia, wypisanie z e-maila (strona i POST One-Click), dostępność (axe).

## Otwarte pytania

- Domyślny e-mail o nowej aukcji obserwowanego sprzedawcy: **domyślnie** wyłączony (in-app włączone); wrócimy do tematu z digestem.
