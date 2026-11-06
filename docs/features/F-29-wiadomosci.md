# F-29 · Wiadomości

**Status:** Review
**Rozmiar:** M · **Właściciel:** Mateusz Bienias · **Zależności:** F-12 (zdjęcia), F-17 (realtime), F-20 (powiadomienia), F-26 (zamówienia), F-28 (spory: wgląd personelu)

## Kontekst i cel

Kupujący i sprzedający nie mają dziś jak się porozumieć. Pytanie o przedmiot przed końcem aukcji, ustalenie szczegółów wysyłki i wyjaśnienie drobnego problemu bez otwierania sporu wymagają kanału w Biddy. Bez niego strony wymieniają telefony i e-maile, a rozmowa przenosi się poza platformę. Tam łatwo o płatność „na konto” bez Pakietu Ochrony Kupujących ([PROJECT.md §16.2](../PROJECT.md#162-antyfraud): transakcje poza platformą).

Gotowe są już klocki:

- room `user:{id}` i publikacja zdarzeń po zatwierdzeniu transakcji (F-17), z zarezerwowanym zdarzeniem `message.new` ([§10.5](../PROJECT.md#105-kanały-realtime));
- prywatne zdjęcia wydawane przez API (`MediaService.privateVariant`, F-28);
- centrum powiadomień z e-mailem według preferencji (F-20);
- pusty moduł `messaging` („czat kupujący ↔ sprzedający, wykrywanie kontaktu poza platformą, blokowanie użytkowników”, [§10.3](../PROJECT.md#103-moduły-backendu-bounded-contexts)).

F-29 dodaje:

- rozmowy o aukcji albo zamówieniu, na żywo, ze zdjęciami i licznikiem nieprzeczytanych;
- wykrywanie numerów telefonów, adresów e-mail i numerów kont (IBAN) z ostrzeżeniem dla obu stron i flagą na wiadomości;
- blokowanie użytkownika (tabela `user_blocks`), zgłaszanie rozmowy i limity wiadomości.

Cel: strony załatwiają w Biddy wszystko, czego potrzebuje transakcja. Próba wyjścia poza platformę jest widoczna dla obu stron i zostawia ślad do reguł antyfraudowych (F-36).

## Historyjki użytkownika

- Jako osoba oglądająca aktywną aukcję pytam sprzedającego o przedmiot i dostaję odpowiedź w tej samej rozmowie.
- Jako sprzedający widzę pytania o moje aukcje i odpowiadam na nie, także ze zdjęciem.
- Jako strona zamówienia piszę do drugiej strony ze strony zamówienia. Jeśli pytanie padło przed końcem aukcji, rozmowa jest ta sama.
- Jako użytkownik widzę w nagłówku, ile rozmów ma nieprzeczytane wiadomości, a nowe wiadomości pojawiają się bez odświeżania.
- Jako odbiorca wiadomości z numerem telefonu, e-mailem albo numerem konta widzę ostrzeżenie, że poza Biddy nie mam ochrony.
- Jako użytkownik blokuję osobę, która mnie nęka, i od tej chwili żadna strona nie może pisać w naszych rozmowach. Mogę ją później odblokować.
- Jako użytkownik zgłaszam rozmowę albo wiadomość (oszustwo, płatność poza Biddy, obraźliwe treści, spam).
- Jako osoba z zespołu Biddy rozpatrująca spór czytam rozmowę stron tego zamówienia.

## Zakres

### Rozmowa (moduł `messaging`)

- **Rozmowa to para (aukcja, druga strona).** Każda rozmowa łączy sprzedającego aukcji z jedną osobą: pytającą przed końcem aukcji albo kupującą. Unikalne `(auction_id, buyer_id)`.
- **Kontekst zamówienia** liczymy przy odczycie: najnowsze zamówienie tej aukcji dla tej osoby (`OrderService.latestForPairs`). Pytanie zadane przed końcem aukcji i rozmowa po wygranej to jedna rozmowa. Działa to także przy drugiej szansie (F-26), bo osoba z drugiej szansy ma własną parę.
- **Rozpoczęcie** (`POST /v1/conversations` z pierwszą wiadomością):
  - o aukcji (`auctionId`): aukcja `ACTIVE`, piszący nie jest sprzedającym;
  - o zamówieniu (`orderId`: UUID albo numer): piszący jest kupującym albo sprzedającym zamówienia, w dowolnym stanie. Sprzedający może zacząć rozmowę tylko w ten sposób;
  - inaczej 409 `CONVERSATION_UNAVAILABLE` (aukcja zakończona bez zamówienia, własna aukcja);
  - gdy rozmowa pary już istnieje, wiadomość trafia do niej (201 z istniejącą rozmową).
- **Pisanie w istniejącej rozmowie** jest możliwe bez względu na stan aukcji. Ograniczają je blokady i limity.
- **Rozmowy bez wiadomości nie powstają.** Strona „Nowa wiadomość” najpierw sprawdza parę (`GET /v1/conversations/start`) i przekierowuje do istniejącej rozmowy.

### Wiadomości

- **Treść:** 0–2000 znaków po przycięciu, do 5 zdjęć. Pusta treść tylko ze zdjęciem.
- **Zdjęcia:** nowe przeznaczenie `MESSAGE_PHOTO`, prywatne jak dowody w sporze. Warianty `thumb` 320 px i `large` 1600 px, minimalny bok 200 px. Plik wydaje API stronom rozmowy (`GET /v1/conversations/:id/photos/:mediaId/:variant`), a personelowi tylko przy spornym zamówieniu.
- **Odczyt:** wiadomość ma odbiorcę (`recipient_id`) i `read_at`. `POST /v1/conversations/:id/read` oznacza wiadomości do mnie jako przeczytane. Nadawca widzi „Przeczytano” przy swojej ostatniej przeczytanej wiadomości.
- **Licznik nieprzeczytanych:** liczba rozmów z nieprzeczytanymi wiadomościami (`GET /v1/conversations/summary`). Pokazuje go ikona w nagłówku.
- **Na żywo** (room `user:{id}`, zaraz po zatwierdzeniu transakcji):
  - `message.new` do obu stron (nadawca ma też inne urządzenia);
  - `conversation.read` do obu stron po odczycie (potwierdzenie dla nadawcy i licznik dla czytającego).
  Każde zdarzenie niesie licznik nieprzeczytanych rozmów dla odbiorcy zdarzenia. Po ponownym połączeniu klient dociąga stan przez REST.
- **Paginacja kursorowa:** lista rozmów po 30 (ostatnia aktywność), wiadomości po 50 (najnowsze pierwsze, kursor `before` = ID, UUIDv7).

### Wykrywanie danych kontaktowych (`@biddy/shared`)

Czysta funkcja `detectContactData(text)` zwraca flagi `PHONE`, `EMAIL` i `IBAN`. Wspólna dla API (flaga na wiadomości) i web (podpowiedź przed wysłaniem).

- **`PHONE`:**
  - ciąg cyfr z odstępami, kreskami, kropkami albo nawiasami, w którym kolejne grupy dają 9 cyfr (pierwsza nie jest zerem);
  - 11 cyfr z prefiksem 48 albo 13 z 0048;
  - zapis z `+` i 10–15 cyframi.
  Ceny („1 500 000”), daty i numery przesyłek (24 cyfry w grupach po 4) nie pasują.
- **`EMAIL`:** adres z `@` albo zapis zastępczy („małpa”, „(at)”, „[at]”, „ at ”) i domeną z kropką albo „kropka”/„dot”.
- **`IBAN`:**
  - 26 cyfr (polski NRB, także w grupach);
  - IBAN z kodem kraju i poprawną sumą kontrolną mod 97.
- **Skutek:**
  - wiadomość zostaje wysłana i ma `contact_flags`;
  - obie strony widzą pod nią ostrzeżenie;
  - piszący przed wysłaniem widzi podpowiedź w polu wiadomości.
  Nie maskujemy treści i nie blokujemy wysyłki (decyzja nr 136). Flagi są podstawą reguł F-36 (np. powtarzające się próby), a liczba oflagowanych wiadomości użytkownika jest dostępna przez `MessagingService.flaggedCount`.

### Blokowanie (`user_blocks`)

- **`PUT /v1/me/blocks/:userId`** blokuje (idempotentnie), **`DELETE`** odblokowuje, **`GET /v1/me/blocks`** zwraca listę z imionami. Siebie nie można zablokować (400), nieznane konto: 404.
- **Skutek:** gdy jedna strona zablokowała drugą, żadna nie może pisać w ich rozmowach ani zaczynać nowych (403 `CONVERSATION_BLOCKED`). Blokujący widzi „Zablokowano tę osobę” z przyciskiem „Odblokuj”. Zablokowany widzi neutralne „Nie możesz pisać w tej rozmowie”. Dotychczasowe wiadomości zostają.
- **Bez wpływu** na zamówienia, spory i licytowanie (decyzja nr 137). Sprawy zamówienia strony załatwiają na stronie zamówienia i w sporze. Okno potwierdzenia blokady zawsze to mówi.
- Powiadomienia o nieprzeczytanych wiadomościach od zablokowanej osoby nie wychodzą.

### Zgłoszenia (moduł `trust-safety`)

- **`POST /v1/conversations/:id/report`:**
  - pola: `reason` (`OFF_PLATFORM`, `SCAM`, `ABUSE`, `SPAM`, `OTHER`), opcjonalne `messageId`, `details` (do 1000 znaków, przy `OTHER` co najmniej 10) i `block`;
  - z `messageId` (wiadomość drugiej strony) zgłaszamy wiadomość (`MESSAGE`), bez niego użytkownika (`USER`) w kontekście rozmowy;
  - z `block: true` zgłaszający od razu blokuje drugą stronę.
- **Tabela `reports`** z [§13.3](../PROJECT.md#133-tabele-kluczowe-kolumny), na razie z celami `MESSAGE` i `USER`:
  - zgłoszenie zapisuje migawkę: zgłoszoną wiadomość i do 10 poprzednich, a przy zgłoszeniu użytkownika ostatnie 20 wiadomości rozmowy. Treść widzi więc personel rozpatrujący zgłoszenie, a nie cała rozmowa na żywo;
  - jedno zgłoszenie tego samego celu na zgłaszającego: ponowienie zwraca istniejące;
  - event `ReportCreated`.
- Kolejkę zgłoszeń, decyzje z uzasadnieniem, zgłoszenia aukcji i odwołania buduje F-35 (decyzja nr 139).

### Limity

Liczone w Postgresie (jak zdjęcia i SMS), 429 `RATE_LIMITED` z `Retry-After` (decyzja nr 140):

- 10 wiadomości na minutę i 200 na dobę na nadawcę;
- 20 nowych rozmów na dobę na osobę.

### Wgląd personelu w rozmowę (spór)

- **`GET /v1/admin/orders/:id/messages`** (support, moderator, admin): rozmowa stron zamówienia ze zdjęciami. Tylko gdy zamówienie ma spór (`orders.disputed_at`), inaczej 404. Bez oznaczania wiadomości jako przeczytane.
- Wiadomości poza sporem i zgłoszeniem widzą tylko strony rozmowy.

### Powiadomienia

- **Nowy typ `NEW_MESSAGE`** w nowej grupie „Wiadomości”. E-mail domyślnie włączony i można go wyłączyć.
- **Job `messaging.notify-unread`** (kolejka `messaging`, co 60 s):
  - zbiera wiadomości nieprzeczytane przez 5 minut, jeszcze bez powiadomienia, i zapisuje im `notified_at`;
  - dla każdej pary (rozmowa, odbiorca) emituje event `MessagesUnread`;
  - moduł `notifications` tworzy z niego jedno powiadomienie „Nowa wiadomość od {imię}” z tytułem aukcji i linkiem do rozmowy.
  Kto czyta na bieżąco, nie dostaje powiadomień. Seria wiadomości daje jedno powiadomienie (decyzja nr 138).
- **E-mail bez treści wiadomości:** nie wysyłamy telefonów i adresów poza Biddy, a odpowiedź i tak wymaga logowania.

### Web

- **Ikona „Wiadomości”** w nagłówku (także na telefonie) z liczbą nieprzeczytanych rozmów, aktualizowaną na żywo. Tylko dla zalogowanych.
- **`/wiadomosci`:** lista rozmów. Od 1024 px lista z lewej, a z prawej rozmowa albo pusty stan.
- **`/wiadomosci/[id]`:** rozmowa (opis w „UX”). Od 1024 px z listą obok, na telefonie sama rozmowa z linkiem „Wiadomości”.
- **`/wiadomosci/nowa?aukcja={id}` i `?zamowienie={numer}`:** przedmiot rozmowy, wskazówki bezpieczeństwa i pole pierwszej wiadomości. Istniejąca rozmowa: przekierowanie. Brak możliwości: komunikat z powodem.
- **Strona aukcji:** „Zapytaj sprzedającego” w karcie sprzedawcy (bez sprzedającego i bez zakończonej aukcji). Gość trafia do logowania z powrotem na stronę nowej wiadomości.
- **Strona zamówienia i sporu:** w podsumowaniu „Napisz do sprzedającego” / „Napisz do kupującego”.
- **`/konto/zablokowani`:** lista zablokowanych z „Odblokuj”, skrót na stronie konta.
- **Ustawienia powiadomień:** grupa „Wiadomości”.

## Poza zakresem

- **Kolejka zgłoszeń, decyzje i odwołania** (F-35), reguły antyfraudowe na flagach (F-36), panel admina z audit logiem dostępu do rozmów (F-34).
- **Publiczne pytania do aukcji (Q&A)** (v1, [§5](../PROJECT.md#5-zakres-funkcjonalny-i-priorytety)).
- **Czarna lista kupujących u sprzedającego** (blokada licytowania). Blokada dotyczy tylko wiadomości.
- **Wskaźnik „pisze…”, edycja i usuwanie wiadomości, załączniki inne niż zdjęcia.**
- **Push web i mobilny** (F-59, F-37). Powiadomienie `NEW_MESSAGE` dostanie te kanały razem z pozostałymi.
- **Czat w aplikacji mobilnej** (F-40). API jest gotowe.
- **Wykrywanie numerów zapisanych słowami** („sześćset…”) i linków do komunikatorów.

## UX

Układ: tło `canvas`, kontener `max-w-page`. Od 1024 px dwie kolumny w karcie: lista (360 px) i rozmowa. Wysokość rozmowy dopasowana do okna, przewija się tylko lista wiadomości.

**Lista rozmów** (`ul`; każdy element to link):

- awatar i imię drugiej strony;
- tytuł aukcji z miniaturą;
- pigułka zamówienia, gdy jest, np. „Zamówienie · Wysłane”;
- początek ostatniej wiadomości („Ty: …” dla własnej; „Zdjęcie”, gdy bez treści);
- czas;
- kropka i liczba nieprzeczytanych, pogrubienie.
Pusty stan: „Nie masz jeszcze wiadomości. Zapytaj sprzedającego na stronie aukcji albo napisz ze strony zamówienia.”

**Rozmowa:**

- **Nagłówek:**
  - awatar, imię (link do profilu) i przedmiot rozmowy (miniatura i tytuł z linkiem do aukcji);
  - przy zamówieniu „Zamówienie nr … · {stan}” z linkiem;
  - menu „Więcej”: „Zgłoś”, „Zablokuj” / „Odblokuj”.
- **Wiadomości** (`ol`, `aria-live="polite"` dla nowych):
  - dymki: własne z prawej (fiolet), drugiej strony z lewej (biała karta);
  - godzina, separatory dni;
  - zdjęcia jako miniatury (link do dużego w nowej karcie);
  - „Przeczytano” pod ostatnią przeczytaną własną wiadomością;
  - „Wcześniejsze wiadomości” na górze.
- **Ostrzeżenie pod oflagowaną wiadomością** (`role="note"`, ton ostrzegawczy): „Ta wiadomość zawiera numer telefonu. Umawiaj się i płać tylko w Biddy: poza Biddy nie masz Pakietu Ochrony Kupujących.” Rodzaj danych według flag (numer telefonu, adres e-mail, numer konta).
- **Pole wiadomości:**
  - textarea z licznikiem, „Dodaj zdjęcia” (uploader prywatny, do 5) i „Wyślij”;
  - Enter wysyła, Shift+Enter dodaje nową linię;
  - podpowiedź przy wykrytych danych kontaktowych: „Wygląda na numer telefonu. Rozmawiaj w Biddy, żeby zachować ochronę kupującego.”;
  - przy blokadzie zamiast pola komunikat i (dla blokującego) „Odblokuj”.
- **Zgłoszenie** (okno dialogowe):
  - powody jako radio:
    - Namawia do płatności lub kontaktu poza Biddy;
    - Próba oszustwa;
    - Obraźliwe treści lub nękanie;
    - Spam;
    - Inny powód;
  - opis i pole wyboru „Zablokuj też tę osobę”;
  - po wysłaniu toast „Dziękujemy. Zespół Biddy sprawdzi zgłoszenie.”.
  „Zgłoś” jest też przy każdej wiadomości drugiej strony (menu wiadomości).
- **Blokada** (okno potwierdzenia): „Zablokować {imię}? Żadne z was nie będzie mogło pisać w waszych rozmowach. Zamówienia i spory działają dalej.”

**Nowa wiadomość:**

- karta przedmiotu (miniatura, tytuł, cena albo numer zamówienia);
- wskazówki: „Pytaj o stan, wymiary i wysyłkę. Nie podawaj telefonu ani numeru konta: płatność poza Biddy nie jest chroniona.”;
- pole wiadomości jak w rozmowie.

Teksty po polsku i neutralne płciowo. Błędy wysyłki pokazuje `role="alert"` nad polem, a treść zostaje w polu.

## Model danych

Migracja `0023_messaging`. Czasy `timestamptz`, ID użytkowników bez kluczy obcych (decyzja F-07).

**`conversations`** (moduł `messaging`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `auction_id` | aukcja (uuid) |
| `seller_id` | sprzedający aukcji |
| `buyer_id` | druga strona: pytający albo kupujący |
| `last_message_at` | czas ostatniej wiadomości (sortowanie listy) |
| `created_at` | |

Unikalne `(auction_id, buyer_id)`, CHECK `seller_id <> buyer_id`, indeksy `(seller_id, last_message_at)` i `(buyer_id, last_message_at)`.

**`messages`:**

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 (kursor) |
| `conversation_id` | FK `conversations` |
| `sender_id`, `recipient_id` | strony |
| `body` | 0–2000 znaków |
| `media_ids` | `uuid[]`, do 5 zdjęć `MESSAGE_PHOTO` |
| `contact_flags` | `text[]` z `PHONE`, `EMAIL`, `IBAN` |
| `read_at` | odczyt przez odbiorcę |
| `notified_at` | powiadomienie o nieprzeczytanej (job) |
| `created_at` | |

CHECK: treść albo zdjęcie, długość treści, liczba zdjęć, dozwolone flagi.

Indeksy:

- `(conversation_id, id)`;
- `(sender_id, created_at)` dla limitów;
- częściowy `(recipient_id, conversation_id) WHERE read_at IS NULL` dla liczników;
- częściowy `(created_at) WHERE read_at IS NULL AND notified_at IS NULL` dla joba;
- częściowy `(sender_id) WHERE contact_flags <> '{}'` dla F-36.

**`user_blocks`:** `blocker_id`, `blocked_id`, `created_at`. PK `(blocker_id, blocked_id)`, CHECK różnych kont, indeks `(blocked_id)`.

**`reports`** (moduł `trust-safety`):

| Kolumna | Opis |
|---|---|
| `id` | UUIDv7 |
| `reporter_id` | zgłaszający |
| `target_type` | `MESSAGE` albo `USER` (F-35 doda `AUCTION`) |
| `target_id` | ID wiadomości albo użytkownika |
| `reason` | `OFF_PLATFORM`, `SCAM`, `ABUSE`, `SPAM`, `OTHER` |
| `details` | opis zgłaszającego |
| `context` | jsonb: źródło (`conversationId`) i migawka wiadomości |
| `status` | `OPEN` (decyzje w F-35) |
| `created_at` | |

Unikalne `(reporter_id, target_type, target_id)`.

**`media.purpose`:** dochodzi `MESSAGE_PHOTO` (prywatne).

## API i zdarzenia

### REST

| Metoda i ścieżka | Opis |
|---|---|
| `GET /v1/conversations?before=` | lista rozmów (30) |
| `GET /v1/conversations/summary` | liczba rozmów z nieprzeczytanymi |
| `GET /v1/conversations/start?auctionId=` albo `?orderId=` | przedmiot nowej rozmowy, istniejąca rozmowa i czy można pisać |
| `POST /v1/conversations` | pierwsza wiadomość: `auctionId` albo `orderId`, `body`, `mediaIds` (201) |
| `GET /v1/conversations/:id` | nagłówek rozmowy: druga strona, przedmiot, zamówienie, `canSend`, `blockedByMe` |
| `GET /v1/conversations/:id/messages?before=` | wiadomości (50, najnowsze pierwsze) |
| `POST /v1/conversations/:id/messages` | wiadomość (201) |
| `POST /v1/conversations/:id/read` | odczyt; zwraca licznik |
| `POST /v1/conversations/:id/report` | zgłoszenie (201) |
| `GET /v1/conversations/:id/photos/:mediaId/:variant` | zdjęcie (strony; personel przy sporze) |
| `GET /v1/me/blocks`, `PUT`/`DELETE /v1/me/blocks/:userId` | blokady |
| `GET /v1/admin/orders/:id/messages` | rozmowa spornego zamówienia (personel) |

Pisanie (`POST` rozmów i wiadomości, zgłoszenia, blokady) wymaga potwierdzonego e-maila i akceptacji regulaminu z oświadczeniem 18+ (§4: zarejestrowany może pisać wiadomości). Nowy dekorator `@RequireAcceptedTerms()`. Obca rozmowa: 404.

Nowe kody: `CONVERSATION_UNAVAILABLE` (409), `CONVERSATION_BLOCKED` (403).

### Realtime (`@biddy/realtime`)

```ts
interface MessageNewEvent {
  conversationId: string; messageId: string; senderId: string;
  createdAt: string; unreadCount: number; serverTime: string;
}
interface ConversationReadEvent {
  conversationId: string; readerId: string; readAt: string;
  unreadCount: number; serverTime: string;
}
```

Treść wiadomości nie idzie przez WebSocket: klient pobiera ją przez REST (jedna ścieżka autoryzacji, zdjęcia i flagi).

### Eventy (outbox, wersja 1)

- `MessagesUnread` (`messaging`): rozmowa, odbiorca, nadawca z imieniem, tytuł aukcji, pierwsza nieprzeczytana wiadomość i liczba. Konsument: `notifications.new-message`.
- `ReportCreated` (`trust-safety`): zgłoszenie, typ celu, powód. Konsumenci dojdą w F-35.

### Joby

- `messaging.notify-unread` (kolejka `messaging`, co 60 s): wiadomości nieprzeczytane od 5 minut, najwyżej 500 na przebieg.

## Reguły biznesowe i przypadki brzegowe

- **Sprzedający pyta o własną aukcję:** 409 `CONVERSATION_UNAVAILABLE`.
- **Aukcja zakończona albo anulowana** bez zamówienia pary: nowej rozmowy nie ma (409), istniejąca działa dalej.
- **Druga szansa:** zwycięzca, który nie zapłacił, i osoba z drugiej szansy mają osobne rozmowy, każda ze swoim zamówieniem.
- **Konto zablokowane przez Biddy (`BANNED`):** nie zaloguje się. Rozmowa z nim jest tylko do odczytu, a druga strona widzi „Konto jest niedostępne”.
- **Wyścig odczytu i joba:** job pomija wiadomości przeczytane przed zapisem `notified_at`, a powiadomienie ma klucz deduplikacji z ID pierwszej nieprzeczytanej wiadomości.
- **Ponowienie wysyłki** (np. utracona odpowiedź) może dać duplikat wiadomości. Klient blokuje przycisk na czas wysyłki. Klucz idempotencji dojdzie, jeśli duplikaty się pojawią.
- **Zdjęcie** musi należeć do nadawcy, mieć przeznaczenie `MESSAGE_PHOTO` i stan `READY`, inaczej 400 (`MediaService.attach`).
- **Zgłoszenie własnej wiadomości:** 400. Wiadomość spoza rozmowy: 404.

## Bezpieczeństwo i prywatność

- Rozmowę, wiadomości i zdjęcia widzą tylko strony (404 dla innych). Personel tylko przy spornym zamówieniu (wgląd zapisany w logu z ID osoby z personelu, audit log w F-34) i przez migawkę w zgłoszeniu.
- Zdjęcia bez publicznych adresów i bez EXIF (F-12), w prywatnym kubełku.
- E-maile i powiadomienia bez treści wiadomości.
- Treść wiadomości nie trafia do logów ani analityki.
- Retencja wiadomości (RODO) dojdzie z modułem `compliance` (F-42).

## Analityka

PostHog (za zgodą, F-06), bez treści:

- `conversation_started` (przedmiot: aukcja lub zamówienie, rola);
- `message_sent` (ze zdjęciem, flagi kontaktowe tak/nie);
- `contact_warning_shown` (miejsce: pole wiadomości);
- `user_blocked`, `user_unblocked`;
- `conversation_reported` (powód, z blokadą).

## Kryteria akceptacji

- [x] Given aktywna aukcja, When zalogowana osoba (nie sprzedający) wysyła pytanie, Then powstaje rozmowa z wiadomością, a sprzedający widzi ją na liście z licznikiem nieprzeczytanych i dostaje `message.new`. Zakończona aukcja bez zamówienia zwraca 409.
- [x] Given rozmowa o aukcji i zamówienie tej pary, When strona pisze ze strony zamówienia, Then wiadomość trafia do tej samej rozmowy, która pokazuje zamówienie.
- [x] Given wiadomość z numerem telefonu, e-mailem albo numerem konta, Then wiadomość ma flagę, a obie strony widzą pod nią ostrzeżenie.
- [x] Given blokada w dowolną stronę, When któraś strona pisze, Then API zwraca 403 `CONVERSATION_BLOCKED`. Po odblokowaniu pisanie działa.
- [x] Given osoba spoza rozmowy, Then rozmowa, wiadomości i zdjęcia zwracają 404. Personel czyta rozmowę tylko dla zamówienia ze sporem.
- [x] Given nadawca powyżej limitu, Then API zwraca 429 z `Retry-After`.
- [x] Given wiadomość nieprzeczytana przez 5 minut, Then odbiorca dostaje jedno powiadomienie `NEW_MESSAGE` na serię, bez treści w e-mailu. Przeczytana wcześniej nie daje powiadomienia.
- [x] Given zgłoszenie wiadomości, Then powstaje `reports` z migawką i eventem `ReportCreated`, a z `block` także blokada.
- [x] Given web na atrapie API, Then:
  - pytanie ze strony aukcji;
  - rozmowa z ostrzeżeniem przy numerze telefonu;
  - blokada z wyłączonym polem wiadomości;
  - axe bez naruszeń WCAG 2.1 AA, bez poziomego przewijania przy 390 px.

## Plan testów

- **Jednostkowe (shared):**
  - `detectContactData`: telefony w różnych zapisach, e-maile z zapisem zastępczym, NRB i IBAN z sumą kontrolną;
  - przypadki, które nie mogą pasować: ceny, daty, kody pocztowe, numery przesyłek.
- **Jednostkowe (api):** reguły rozpoczęcia rozmowy, migawka zgłoszenia.
- **Integracyjne (Postgres, Redis):**
  - rozpoczęcie (aukcja, zamówienie, 409, ta sama rozmowa po wygranej);
  - wysyłka, odczyt i liczniki;
  - flagi;
  - blokady w obie strony;
  - 404 dla obcych i wgląd personelu przy sporze;
  - limity 429;
  - zdjęcia prywatne;
  - job powiadomień (raz na serię, przeczytane bez powiadomienia, blokada);
  - zgłoszenie z migawką i blokadą.
- **Web (Vitest, Testing Library):**
  - lista i rozmowa (dymki, ostrzeżenie, „Przeczytano”);
  - podpowiedź w polu wiadomości;
  - blokada i zgłoszenie;
  - ikona w nagłówku z licznikiem.
- **E2E (Playwright, atrapa API):** pytanie ze strony aukcji, rozmowa z ostrzeżeniem, blokada; axe, 390 px.

## Postęp i odstępstwa (2026-11-04)

Gotowe:

- migracja `0023_messaging`: `conversations`, `messages`, `user_blocks`, `reports` i przeznaczenie mediów `MESSAGE_PHOTO`;
- `@biddy/shared`: `detectContactData`, limity wiadomości, powody zgłoszeń, kody `CONVERSATION_UNAVAILABLE` i `CONVERSATION_BLOCKED`, typ powiadomienia `NEW_MESSAGE`;
- `@biddy/realtime`: zdarzenia `message.new` i `conversation.read` z obsługą w kliencie;
- moduł `messaging`:
  - `MessagingService` (rozpoczęcie, wysyłka, odczyt, zgłoszenie, limity);
  - `ConversationReader` (lista, nagłówek, nowa wiadomość, wgląd personelu, dostęp do zdjęć);
  - `BlockService`;
  - `UnreadNotifier` (job `messaging.notify-unread`, event `MessagesUnread`);
  - trasy stron, blokad i personelu;
- `ReportService` i event `ReportCreated` w `trust-safety`;
- dekorator `@RequireAcceptedTerms` w `identity`;
- `OrderService.latestForPairs` i `byReference`, `AuctionDirectory.subjects`, `ProfileService.chatProfiles`;
- powiadomienie `NEW_MESSAGE` w grupie „Wiadomości”;
- web:
  - `/wiadomosci`, `/wiadomosci/[id]`, `/wiadomosci/nowa` i `/konto/zablokowani`;
  - ikona wiadomości w nagłówku;
  - „Zapytaj sprzedającego” w karcie sprzedawcy, „Napisz do…” w podsumowaniu zamówienia (także na stronie sporu);
  - skróty „Wiadomości” i „Zablokowani” na stronie konta.

Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 135–141.

Odstępstwa:

- **Menu „Więcej” w nagłówku rozmowy** to dwa przyciski: „Zgłoś” i „Zablokuj” / „Odblokuj” (na telefonie same ikony z etykietą dla czytników). Projekt nie ma jeszcze komponentu menu.
- **„Zgłoś” przy wiadomości** to ikona flagi obok godziny każdej wiadomości drugiej strony.
- **Potwierdzenie zgłoszenia** to toast. Powiadomienie z potwierdzeniem i decyzją dojdzie w F-35.
- **Seria wiadomości** trwa do odczytu: gdy odbiorca ma już powiadomioną, nieprzeczytaną wiadomość w rozmowie, kolejne dostają tylko znacznik `notified_at`. Następne powiadomienie przychodzi po odczycie i nowej wiadomości.
- **Limit nowych rozmów** liczy rozmowy, w których osoba jest drugą stroną (pytający albo kupujący). Sprzedający zaczyna rozmowy tylko ze strony zamówienia, więc ich nie spamuje.
- **`message.new` i `conversation.read`** publikuje API zaraz po zatwierdzeniu transakcji (jak zdarzenia aukcji), a nie konsument outboxa: liczy się opóźnienie czatu, a po ponownym połączeniu klient i tak dociąga stan przez REST.
- **Zgłoszenie i blokada** też wymagają regulaminu (`@RequireAcceptedTerms`); odblokowanie i odczyty wystarczą z sesją.
- **Wgląd personelu** w rozmowę trafia do logu aplikacji (ID personelu, zamówienia i rozmowy). Audit log dojdzie w F-34.
- **Pole wiadomości** nie dostaje fokusu automatycznie na stronie nowej wiadomości (dostępność).

## Otwarte pytania

- **Rozmowy po zakończonej aukcji bez zamówienia:** zostawiamy je otwarte. Jeśli przegrani licytujący będą umawiać sprzedaż poza Biddy, zamkniemy je do odczytu po 14 dniach.
- **Retencja wiadomości:** jak długo trzymamy rozmowy po zakończeniu zamówienia (dowody w chargebackach, §7.9, a RODO)? Do ustalenia z prawnikiem (§17.1).
- **Treść e-maila:** fragment wiadomości poprawiłby odpowiedzialność, ale wynosi treść poza Biddy. Na razie bez treści.
