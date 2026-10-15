# F-17 · Realtime

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-03, F-06, F-15, F-16

## Kontekst i cel

Licytacja to wyścig z czasem: licytujący musi widzieć nową cenę i przedłużenie aukcji od razu, a nie po odświeżeniu strony, i dowiedzieć się, że ktoś go przebił ([PROJECT.md §10.5](../PROJECT.md#105-kanały-realtime), [§14.2](../PROJECT.md#142-zdarzenia-websocket)). Liczniki końca liczymy od zegara serwera (§15.4), bo zegar telefonu potrafi się mylić o minuty.

F-17 dodaje serwer Socket.IO w API (z adapterem Redis, więc działa na wielu instancjach), publikację zdarzeń z silnika licytacji (F-15) i zamykania (F-16), pakiet `@biddy/realtime` (typy zdarzeń i klient z reconnectem i synchronizacją zegara) oraz integrację w web. Strona aukcji, która z tego korzysta, to F-18.

## Historyjki użytkownika

- Jako oglądający aukcję chcę widzieć cenę, liczbę ofert i czas końca na żywo.
- Jako licytujący chcę od razu wiedzieć, że ktoś mnie przebił, także gdy mam otwartą inną stronę.
- Jako zwycięzca chcę od razu dostać informację o wygranej z terminem płatności.
- Jako użytkownik na słabym zasięgu chcę, żeby po zerwaniu połączenia aplikacja sama się połączyła i pokazała aktualny stan.

## Zakres

### Serwer (API)

- **Socket.IO** na tym samym serwerze HTTP co API, ścieżka `/v1/realtime`, **tylko transport WebSocket**. Long-polling wymaga, żeby kolejne żądania trafiały do tej samej instancji (sticky sessions), a load balancer Render tego nie zapewnia; WebSocket to jedno połączenie, więc działa na wielu instancjach bez tego.
- **Adapter Redis** (`@socket.io/redis-adapter`) na instancji cache (`REDIS_CACHE_URL`, `allkeys-lru`, §11.2): zdarzenie wysłane z dowolnej instancji API albo z workera trafia do klientów połączonych z każdą instancją.
- **Uwierzytelnienie przy połączeniu:** ciasteczko sesji (web) albo token Bearer w `auth.token` (mobile), ten sam odczyt sesji co w REST (Better Auth). Bez sesji połączenie jest anonimowe. Konto zablokowane: anonimowe.
- **Origin:** połączenie z przeglądarki tylko z originów `CORS_ORIGINS` (ochrona przed cross-site WebSocket hijacking z ciasteczkiem). Klient bez nagłówka Origin (aplikacja mobilna) przechodzi i uwierzytelnia się tokenem.
- **Rooms** (§10.5):
  - `user:{id}`: serwer dołącza zalogowanego użytkownika automatycznie przy połączeniu; klient nie może sam dołączyć do żadnego room `user:*`.
  - `auction:{id}`: klient wysyła `auction:subscribe` / `auction:unsubscribe` z identyfikatorem aukcji (UUID; najwyżej 50 aukcji na połączenie). Room niczego nie ujawnia: zdarzenia publikujemy tylko dla aukcji publicznych.
- **Zegar:** `time:ping` z potwierdzeniem `{ serverTime }` (§15.4).

### Publikacja zdarzeń

- `RealtimePublisher` (API i worker) wysyła zdarzenia przez Redis (`@socket.io/redis-emitter`) **zaraz po zatwierdzeniu transakcji**: oferta, Kup teraz, unieważnienie oferty, zamknięcie, anulowanie. Droga przez outbox (odpytywanie co 250 ms + kolejka) nie zmieściłaby się w 300 ms.
- Dostarczenie jest najlepszym wysiłkiem: błąd Redisa nie psuje oferty (jest w logach), a klient po reconnect dociąga stan przez REST (§10.5). Kanał nie jest źródłem prawdy.
- Każda wiadomość niesie `serverTime`; `auction.updated` także `version` aukcji (rośnie z każdą zmianą).

| Zdarzenie | Room | Kiedy | Treść |
|---|---|---|---|
| `auction.updated` | `auction:{id}` | oferta, Kup teraz, unieważnienie, koniec, anulowanie | status, cena, liczba ofert, zanonimizowany lider (np. „k***a”), koniec, stan ceny minimalnej, minimalna kolejna oferta, dostępność Kup teraz |
| `auction.extended` | `auction:{id}` | przedłużenie (anti-sniping) | nowy koniec |
| `auction.ended` | `auction:{id}` | koniec, Kup teraz, anulowanie | wynik (`SOLD`/`UNSOLD`/`CANCELLED`), cena końcowa |
| `user.outbid` | `user:{id}` | poprzedni lider stracił prowadzenie | aukcja, cena, minimalna kolejna oferta |
| `user.won` | `user:{id}` | zwycięzca (czas albo Kup teraz) | aukcja, numer zamówienia, termin płatności |

Maksima licytujących i ich identyfikatory nie trafiają do zdarzeń publicznych. `order.updated`, `message.new` i `notification.new` dojdą z zamówieniami, czatem i powiadomieniami.

### Pakiet `@biddy/realtime`

- Typy zdarzeń serwer → klient i klient → serwer (wspólne dla API, web i mobile; API importuje tylko typy).
- `createRealtimeClient({ url, token?, … })` na `socket.io-client`, niezależny od Reacta (web i Expo):
  - reconnect z rosnącym odstępem (wbudowany w Socket.IO);
  - `subscribeAuction(id, handler)` z licznikiem odwołań i **ponowną subskrypcją po reconnect** (nowe połączenie nie ma rooms);
  - `onUserEvents(...)`, `onReconnect(...)` (dociągnięcie stanu przez REST), `onStatus(...)`;
  - po rozłączeniu przez serwer (wdrożenie, zamknięcie instancji) klient sam łączy się ponownie, z inną instancją;
  - **synchronizacja zegara**: 5 próbek `time:ping` po połączeniu i co minutę, przesunięcie = mediana `serverTime − (t0 + t1) / 2` (§15.4), odrzucenie próbek z RTT powyżej 1 s; `serverNow()`.

### Web

- `RealtimeProvider` (jeden klient na kartę, połączenie leniwe: dopiero gdy coś subskrybuje) z adresem API (`NEXT_PUBLIC_API_URL`) i ciasteczkiem sesji.
- Hooki `useAuctionChannel(auctionId, handlers)` i `useUserRealtimeEvents(handlers)` (wywołanie przy reconnect do odświeżenia danych). Zegar z WebSocket zasila istniejący `ServerClockProvider` (F-06), gdy połączenie działa.
- Strona aukcji z licznikiem i panelem to F-18; w F-17 integracja jest gotowa do użycia i przetestowana.

## Poza zakresem

- Strona aukcji i panel licytacji (F-18), powiadomienia push i e-mail (F-28), czat (F-31).
- Wylogowanie z wszystkich urządzeń nie rozłącza otwartych połączeń WebSocket od razu (rozłączy je następny reconnect); do rozważenia przy F-28.
- Limit połączeń per IP (Cloudflare przed API).

## UX

Brak nowych ekranów. Stan połączenia (np. „Łączenie…”) pokaże panel licytacji w F-18 z `useRealtimeStatus()`.

## Model danych

Brak zmian w bazie.

## API i zdarzenia

- Socket.IO pod `{API}/v1/realtime`: zdarzenia jak w tabeli; klient → serwer: `auction:subscribe` (ack `{ ok }` albo `{ ok: false, error }`), `auction:unsubscribe`, `time:ping` (ack `{ serverTime }`).
- Konfiguracja: `REDIS_CACHE_URL` (wymagana na produkcji dla API i workera).

## Reguły biznesowe i przypadki brzegowe

- Kolejność: wiadomości budujemy w transakcji, która trzyma blokadę wiersza aukcji, i wysyłamy synchronicznie zaraz po jej zatwierdzeniu, więc z jednego procesu idą w kolejności zmian. Między instancjami kolejność nie jest gwarantowana: klient porównuje `version` i ignoruje starsze stany.
- Odczyty do wiadomości (imię lidera) idą przez tę samą transakcję: drugie połączenie z puli przy trzymanej blokadzie zakleszczyłoby pulę przy wielu równoległych ofertach (test 50 ofert z F-15).
- Zamknięcie instancji: serwer rozłącza klientów przed zamknięciem HTTP, a klienci łączą się z pozostałymi instancjami.
- Reconnect: klient ponownie subskrybuje aukcje i woła `onReconnect`, żeby pobrać stan przez REST (zdarzenia z czasu rozłączenia przepadają).
- Ostateczną decyzję, czy oferta zdążyła, podejmuje serwer (`clock_timestamp()` w bazie, F-15).

## Bezpieczeństwo i prywatność

- Room `user:{id}` tylko dla właściciela sesji (dołącza serwer, nie klient).
- Sprawdzanie Origin przy połączeniu z ciasteczkiem; limit subskrypcji na połączenie; identyfikator aukcji walidowany (UUID).
- W zdarzeniach publicznych lider tylko zanonimizowany, bez maksimów.

## Analityka

Brak.

## Kryteria akceptacji

- [x] Given oferta zatwierdzona na jednej instancji API, Then `auction.updated` dociera do klienta połączonego z drugą instancją (test z dwiema instancjami i wspólnym Redisem); p95 opóźnienia < 300 ms (test lokalnie, pomiar na stagingu).
- [x] Given zamknięcie aukcji w workerze, Then oglądający dostają `auction.ended`, a zwycięzca `user.won`.
- [x] Given klient z symulowanym opóźnieniem sieci, Then przesunięcie zegara jest liczone z dokładnością < 100 ms.
- [x] Given niezalogowany klient, Then nie dostaje zdarzeń z żadnego room `user:*` i nie może do niego dołączyć; zalogowany dostaje tylko swoje.
- [x] Given zerwanie połączenia, Then klient łączy się ponownie, ponownie subskrybuje aukcje i wywołuje odświeżenie stanu.

## Plan testów

- **Realtime, jednostkowe:** estymacja zegara (mediana, odrzucenie wolnych próbek, asymetryczne opóźnienie), klient na prawdziwym serwerze Socket.IO w teście (subskrypcje z licznikiem, ponowna subskrypcja po restarcie serwera, `onReconnect`, `serverNow`).
- **API, integracyjne (Postgres, Redis, dwie instancje API na portach, worker):** anonimowy i zalogowany klient (ciasteczko, token Bearer), Origin, `auction:subscribe` z błędnym identyfikatorem i limitem, oferta na instancji A → klient na B (pomiar opóźnienia), `user.outbid`, Kup teraz (`auction.ended`, `user.won`), zamknięcie w workerze, brak maksimów w zdarzeniach, `time:ping`.
- **Web, jednostkowe:** provider i hooki (leniwe połączenie, odsubskrybowanie przy odmontowaniu, przekazanie zegara do `ServerClockProvider`).

## Otwarte pytania

- Zapasowy long-polling dla sieci blokujących WebSocket: **domyślnie** wyłączony (wymagałby sticky sessions); wrócimy do tematu, jeśli monitoring pokaże klientów bez połączenia.
