# F-30 · Oceny

**Status:** Review
**Rozmiar:** S · **Właściciel:** Mateusz Bienias · **Zależności:** F-26 (zamówienia), F-28 (spory), F-20 (powiadomienia), F-10 (profil publiczny)

## Kontekst i cel

Kupujący wybiera aukcję w ciemno: widzi imię sprzedawcy, datę dołączenia i znaczek telefonu, ale nie wie, jak przebiegły jego wcześniejsze transakcje. Sprzedający nie wie, czy kupujący płaci i odbiera paczki. Strona aukcji i profil publiczny mają na oceny tylko tekst zastępczy „Brak ocen” (decyzja nr 75), a pusty moduł `reviews` czeka na tę funkcję ([PROJECT.md §10.3](../PROJECT.md#103-moduły-backendu-bounded-contexts)).

Zakończone zamówienie to jedyny moment, w którym obie strony wiedzą, jak poszła transakcja. Oceny wystawiamy więc tylko do zamówień zakończonych sprzedażą albo sporem. Oceny nie można kupić ani wystawić bez transakcji, a o tym, jak je weryfikujemy, mówimy wprost (dyrektywa Omnibus, [§17](../PROJECT.md#17-prawo-i-compliance)).

F-30 dodaje:

- ocenę 1–5 z opcjonalnym komentarzem dla obu stron zamówienia, w ciągu 14 dni od jego zakończenia;
- ujawnienie, gdy ocenią obie strony, a najpóźniej po 7 dniach, bez możliwości odwetu;
- średnią i liczbę ocen na profilu i w karcie sprzedawcy, listę ocen i opis sposobu ich weryfikacji;
- powiadomienia: „druga strona oceniła zamówienie” i „masz nową ocenę”.

Cel: reputacja, która buduje zaufanie między stronami i której nie da się łatwo zmanipulować.

## Historyjki użytkownika

- Jako kupujący po zakończonym zamówieniu oceniam sprzedającego (gwiazdki i komentarz) ze strony zamówienia.
- Jako sprzedający oceniam kupującego tego samego zamówienia.
- Jako strona zamówienia nie widzę oceny drugiej strony, dopóki sam nie ocenię albo nie minie 7 dni. Druga strona nie może zmienić swojej oceny po przeczytaniu mojej.
- Jako strona sporu zakończonego zwrotem też mogę ocenić drugą stronę.
- Jako osoba oglądająca aukcję widzę średnią ocen sprzedawcy i ich liczbę, a na profilu listę ocen z komentarzami.
- Jako użytkownik wiem, kto może wystawić ocenę i jak Biddy ją weryfikuje.
- Jako strona zamówienia dostaję powiadomienie, gdy druga strona oceniła zamówienie (z terminem na moją ocenę) i gdy otrzymana ocena stała się widoczna.

## Zakres

### Kto i kiedy ocenia (moduł `reviews`)

- **Zamówienie do oceny:**
  - `COMPLETED` (także po sporze rozstrzygniętym na korzyść sprzedającego);
  - `REFUNDED` albo `PARTIALLY_REFUNDED` po sporze (`disputed_at` ustawione; decyzja nr 19).

  Zwroty bez sporu (nienadanie, zaginięcie, paczka nieodebrana) kończą zamówienie bez transakcji, więc bez ocen.
- **Okno:** 14 dni od zakończenia zamówienia. Start okna to `completed_at` dla `COMPLETED` i `refunded_at` dla zwrotów.
- **Raz na stronę:** unikalne `(order_id, author_id)`. Ocena się nie zmienia: bez edycji i bez usuwania przez autora.
- **Ocena:** liczba całkowita 1–5 i komentarz (opcjonalny, do 1000 znaków po przycięciu). Komentarz jest publiczny, więc nie może zawierać numeru telefonu, adresu e-mail ani numeru konta (`detectContactData` z F-29; błąd walidacji 400).
- **Wymagania konta:** potwierdzony e-mail i akceptacja regulaminu (`@RequireAcceptedTerms`), jak przy wiadomościach.

### Ujawnienie

- Ocena jest widoczna od `visible_at`:
  - pierwsza ocena zamówienia: `visible_at = min(created_at + 7 dni, koniec okna)`;
  - druga ocena: obie oceny dostają `visible_at = teraz`.
- **Bez odwetu:** gdy ocena drugiej strony stała się widoczna, nie można już ocenić. Termin strony to `min(koniec okna, visible_at oceny drugiej strony)`. Ocena drugiej strony pozostaje ukryta, dopóki ta strona ma jeszcze czas na swoją.
- Strona wie, że druga strona już oceniła (bez gwiazdek i treści), i dostaje powiadomienie z terminem. Taki sygnał zachęca do oceny i niczego nie zdradza.

### Reputacja

- **Średnia i liczba** liczone przy odczycie z widocznych ocen, w których użytkownik jest oceniany:
  - łącznie;
  - jako sprzedający (oceny od kupujących);
  - jako kupujący (oceny od sprzedających).
- **Profil publiczny** (`/u/:id`):
  - statystyka „Ocena” w karcie profilu (średnia z jednym miejscem po przecinku i liczba);
  - sekcja „Oceny” z podsumowaniem według ról i listą (najnowsze pierwsze, po 20, „Wcześniejsze oceny”).
- **Ocena na liście:**
  - gwiazdki, komentarz i data wystawienia;
  - „Od kupującego” albo „Od sprzedającego”;
  - autor zanonimizowany jak w historii ofert (`anonymizeName`, np. „k***a”);
  - tytuł przedmiotu z zamówienia (migawka).
- **Karta sprzedawcy** na stronie aukcji: średnia i liczba ocen jako sprzedający („4,8 · 12 ocen”) z linkiem do ocen na profilu, albo „Brak ocen”.
- **Informacja o weryfikacji ocen** (Omnibus) w sekcji ocen na profilu (karta sprzedawcy linkuje do tej sekcji):
  - ocenę wystawia tylko strona zamówienia zakończonego w Biddy, raz i w ciągu 14 dni;
  - oceny obu stron pokazujemy razem albo po 7 dniach, więc druga strona nie może się odwdzięczyć ani zemścić;
  - pokazujemy wszystkie oceny, także negatywne, bez zmian w treści i bez płatnych wyróżnień;
  - usuwamy tylko oceny naruszające regulamin, z uzasadnieniem (DSA, F-35).

### Powiadomienia

- **`REVIEW_REQUESTED`**: druga strona oceniła zamówienie, a ty jeszcze nie. Treść: tytuł przedmiotu i termin. Bez gwiazdek. Klucz `REVIEW_REQUESTED:{orderId}:{userId}`.
- **`REVIEW_RECEIVED`**: ocena o tobie jest już widoczna (gwiazdki w tytule). Klucz `REVIEW_RECEIVED:{reviewId}`.
- Oba linkują do strony zamówienia. E-mail domyślnie włączony, z możliwością wyłączenia. W ustawieniach grupa „Oceny”.
- `REVIEW_RECEIVED` emituje job `reviews.publish` (co minutę): oceny z `visible_at ≤ teraz` bez `published_at` dostają event `ReviewPublished`. Ujawnienie po 7 dniach i ujawnienie po drugiej ocenie idą tą samą ścieżką.

### Web

- **Strona zamówienia:** karta „Ocena” pod kartą „Co teraz”, gdy zamówienie jest do oceny:
  - formularz;
  - twoja ocena z informacją, kiedy będzie widoczna;
  - ocena drugiej strony po ujawnieniu;
  - „Czas na ocenę minął”.
- **Profil publiczny:** statystyka, sekcja „Oceny” i informacja o weryfikacji.
- **Karta sprzedawcy:** ocena jako sprzedający.
- **Powiadomienia:** ikony i nazwy nowych typów, grupa „Oceny” w ustawieniach.

## Poza zakresem

- Zgłaszanie i usuwanie ocen przez zespół Biddy: F-35 (DSA *notice & action*, uzasadnienie decyzji). Do tego czasu zgłoszenie przez kontakt z supportem.
- Odpowiedź ocenianego na ocenę: v1, jeśli beta pokaże potrzebę.
- `sellerRating` w indeksie wyszukiwarki i filtr po ocenie (§15.5): osobno, z reindeksacją aukcji sprzedawcy po ujawnieniu oceny.
- „Moje oceny” w koncie (wystawione i otrzymane): otrzymane są na profilu, wystawione na stronach zamówień.
- Przypomnienie przed końcem okna, gdy nikt nie ocenił: po becie, jeśli udział ocen będzie niski.
- Oceny w aplikacji mobilnej: F-37+.
- Wpływ ocen na limity kont (§4.1): limity liczą historię zamówień, nie oceny.

## UX

**Karta „Ocena” na stronie zamówienia** (`section`, nagłówek „Ocena transakcji”):

- **Formularz** (okno otwarte, brak mojej oceny):
  - nagłówek „Jak oceniasz {imię}?” z rolą („sprzedającego” / „kupującego”) w opisie;
  - gwiazdki jako `fieldset` z pięcioma polami radio (legend „Ocena”), etykiety dla czytników: „1 z 5: bardzo źle”, „2 z 5: słabo”, „3 z 5: w porządku”, „4 z 5: dobrze”, „5 z 5: świetnie”; nazwa wybranej oceny obok gwiazdek;
  - komentarz (`textarea`, opcjonalny) z licznikiem do 1000 i podpowiedzią „Komentarz jest publiczny. Napisz, jak przebiegła transakcja: opis przedmiotu, wysyłka, kontakt.”;
  - informacja: „Ocena pokaże się, gdy {imię} też oceni, a najpóźniej {data}. Ocenić można do {termin}.”;
  - gdy druga strona już oceniła: „Druga strona już wystawiła ocenę. Zobaczysz ją po wystawieniu swojej.”;
  - „Wystaw ocenę” (wymaga wyboru gwiazdek; bez wyboru komunikat przy polu).
- **Po wystawieniu:** „Twoja ocena” z gwiazdkami i komentarzem oraz „Widoczna od {data}” albo „Widoczna na profilu {imię}”.
- **Ocena drugiej strony** po ujawnieniu: „Ocena od {imię}” z gwiazdkami i komentarzem.
- **Okno zamknięte bez oceny:** „Czas na ocenę minął {data}.” Oceny drugiej strony, jeśli są, nadal widać.
- Błędy wysyłki: `role="alert"` nad przyciskiem; treść formularza zostaje.

**Profil publiczny:**

- w karcie profilu statystyka „Ocena”: „4,8” i „12 ocen” (gdy brak: „—” i „Brak ocen”);
- sekcja „Oceny” (`id="oceny"`):
  - podsumowanie: duża średnia z gwiazdkami, liczba ocen, wiersze „Jako sprzedający: 4,9 · 10” i „Jako kupujący: 4,5 · 2”;
  - lista ocen (`ul`): gwiazdki (z tekstem dla czytników „5 z 5”), „Od kupującego · k***a · 3 listopada 2026”, tytuł przedmiotu, komentarz;
  - „Wcześniejsze oceny” dociąga kolejne 20;
  - pusty stan: „Brak ocen. Oceny pojawiają się po zakończonych zamówieniach.”;
  - „Jak weryfikujemy oceny” (`details`) z zasadami z sekcji Reputacja.

**Karta sprzedawcy:** gwiazdka, „4,8 · 12 ocen” jako link do `/u/:id#oceny`, albo „Brak ocen”.

Teksty po polsku i neutralne płciowo (bez form „-łeś/-łaś”).

## Model danych

Migracja `0024_reviews`. Czasy `timestamptz`, ID użytkowników i zamówień bez kluczy obcych (moduły rozdzielone).

**`reviews`** (moduł `reviews`):

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | uuid v7 | PK |
| `order_id` | uuid | zamówienie (moduł orders) |
| `order_public_id` | text | numer zamówienia: link w powiadomieniu |
| `title` | text | tytuł przedmiotu (migawka z zamówienia) |
| `author_id` | uuid | wystawiający |
| `target_id` | uuid | oceniany (druga strona) |
| `role` | text | rola autora w zamówieniu: `BUYER` (ocena sprzedającego) albo `SELLER` (ocena kupującego) |
| `rating` | smallint | 1–5 |
| `comment` | text null | do 1000 znaków |
| `created_at` | timestamptz | |
| `visible_at` | timestamptz | od kiedy ocena jest publiczna |
| `published_at` | timestamptz null | job wyemitował `ReviewPublished` |

- Unikalne `(order_id, author_id)`.
- Indeks `(target_id, created_at desc, id desc)`: lista i podsumowanie ocenianego.
- Indeks częściowy `reviews_unpublished_idx` na `visible_at` `where published_at is null`: job.
- CHECK: `rating between 1 and 5`, `role in ('BUYER','SELLER')`, `author_id <> target_id`, `visible_at >= created_at`, `char_length(comment) between 1 and 1000`.

## API i zdarzenia

### REST

```
GET  /orders/:id/reviews        (strony; stan ocen zamówienia)
POST /orders/:id/review         { rating, comment? } → 201, stan ocen; @RequireAcceptedTerms
GET  /users/:id/rating          (publiczne; średnia i liczba: łącznie, jako sprzedający, jako kupujący)
GET  /users/:id/reviews?before= (publiczne; widoczne oceny, po 20, najnowsze pierwsze)
```

- `:id` zamówienia to UUID albo numer. Obce zamówienie: 404.
- **Stan ocen zamówienia** (`OrderReviewsDto`):
  - `blocker`: `NOT_FINISHED`, `WINDOW_CLOSED`, `ALREADY_REVIEWED` albo null (można ocenić);
  - `rateUntil`: termin mojej oceny (null przy `NOT_FINISHED`);
  - `mine`: moja ocena z `visibleAt`;
  - `theirs`: ocena drugiej strony, tylko po ujawnieniu;
  - `counterpartReviewed`: czy druga strona już oceniła;
  - `counterpart`: imię drugiej strony.
- **Błędy:**
  - `409 REVIEW_UNAVAILABLE` z `reason` (powody jak `blocker`);
  - `400 VALIDATION_FAILED` dla komentarza z danymi kontaktowymi albo za długiego.
- **Publiczne trasy:** konto nieznane albo zablokowane: 404, jak profil. Nagłówek `cache-control: public, max-age=60`.

### Eventy (outbox, wersja 1)

- **`ReviewSubmitted`** (`aggregateType: 'review'`): `reviewId`, `orderId`, `orderPublicId`, `title`, `authorId`, `targetId`, `authorRole`, `counterpartReviewed`, `rateUntil` (termin drugiej strony). Konsument `notifications.review-requested`: `REVIEW_REQUESTED`, gdy `counterpartReviewed = false`.
- **`ReviewPublished`**: `reviewId`, `orderId`, `orderPublicId`, `title`, `authorRole`, `targetId`, `rating`. Konsument `notifications.review-received`: `REVIEW_RECEIVED`.

### Joby

- `reviews.publish` (kolejka `reviews`, co minutę, współbieżność 1): do 500 ocen `visible_at ≤ teraz` i `published_at is null` (`for update skip locked`), event i znacznik w jednej transakcji.

## Reguły biznesowe i przypadki brzegowe

- **Równoczesne oceny obu stron:** blokada doradcza `reviews:{orderId}` w transakcji wystawienia. Druga ocena widzi pierwszą i odsłania obie.
- **Druga ocena tuż przed odsłonięciem pierwszej:** dopuszczalna, dopóki `visible_at` pierwszej jest w przyszłości (porównanie z czasem serwera w transakcji).
- **Koniec okna przed upływem 7 dni:** pierwsza ocena odsłania się z końcem okna (`min`), bo druga strona i tak nie może już ocenić.
- **Zamówienie zakończone przed wdrożeniem F-30:** okno liczymy tak samo od `completed_at` / `refunded_at`, więc zamówienia z ostatnich 14 dni da się ocenić.
- **Konto zablokowane przez Biddy:** jego oceny innych zostają (transakcja była prawdziwa). Profil i trasy ocen zablokowanego konta zwracają 404.
- **Chargeback po zakończeniu:** nie zmienia ocen.
- **Komentarz z samych białych znaków:** zapisujemy jako brak komentarza.
- **Zaokrąglenie:** API zwraca średnią z dwoma miejscami po przecinku; web pokazuje jedno (np. 4,75 → „4,8”).

## Bezpieczeństwo i prywatność

- Stan ocen zamówienia tylko dla stron (404 dla innych). Ocena drugiej strony przed ujawnieniem nie wychodzi z API (nawet sama liczba gwiazdek).
- Publiczne listy pokazują autora zanonimizowanego i tytuł przedmiotu, bez numeru zamówienia, kwot i linku do profilu autora. Kupujący nie ujawnia więc całego imienia ani historii zakupów.
- Komentarz bez danych kontaktowych (walidacja), bez HTML (render jako tekst).
- Wystawienie wymaga sesji, potwierdzonego e-maila i regulaminu. Limit liczby ocen wynika z liczby zamówień, więc bez osobnego limitu częstotliwości.

## Analityka

- `review_submitted` (web): `role`, `rating`, `hasComment`.

## Kryteria akceptacji

- [x] Ocenić można tylko zamówienie `COMPLETED` albo zwrócone po sporze, w ciągu 14 dni od zakończenia, raz na stronę (druga próba: 409 `REVIEW_UNAVAILABLE` / `ALREADY_REVIEWED`).
- [x] Zamówienie zwrócone bez sporu i zamówienie w toku nie dają się ocenić (`NOT_FINISHED`), a po 14 dniach `WINDOW_CLOSED`.
- [x] Druga strona nie widzi oceny przed ujawnieniem: ani w stanie zamówienia, ani na profilu, ani w średniej.
- [x] Ocena drugiej strony odsłania obie oceny od razu. Bez niej pierwsza odsłania się po 7 dniach (albo z końcem okna).
- [x] Po ujawnieniu oceny drugiej strony nie można już ocenić.
- [x] Profil pokazuje średnią i liczbę ocen (łącznie i według ról), listę ocen z zanonimizowanym autorem i informację o weryfikacji ocen.
- [x] Karta sprzedawcy na stronie aukcji pokazuje ocenę jako sprzedający albo „Brak ocen”.
- [x] Komentarz z numerem telefonu, e-mailem albo numerem konta jest odrzucany z komunikatem.
- [x] Powiadomienia `REVIEW_REQUESTED` (druga strona oceniła) i `REVIEW_RECEIVED` (ocena widoczna), z e-mailem do wyłączenia.

## Plan testów

**Jednostkowe:**

- `@biddy/shared`: walidacja komentarza (długość, dane kontaktowe, przycięcie), stałe.
- `review-rules`:
  - start i koniec okna dla każdego stanu;
  - zwrot bez sporu;
  - termin strony z oceną drugiej strony;
  - `visible_at` pierwszej oceny przy końcu okna;
  - powody blokady.
- Treść powiadomień: tytuł, treść, link, brak gwiazdek w `REVIEW_REQUESTED`.

**Integracyjne (Testcontainers):**

- wystawienie przez kupującego, stan obu stron (ukrycie), druga ocena odsłania obie, podsumowanie i lista publiczna;
- 409 dla drugiej oceny, zamówienia w toku, zwrotu bez sporu i po oknie; 404 dla obcego zamówienia;
- zwrot po sporze daje się ocenić;
- odsłonięcie po 7 dniach przez job, event i powiadomienie `REVIEW_RECEIVED`, a po ujawnieniu brak możliwości oceny;
- `REVIEW_REQUESTED` po pierwszej ocenie;
- walidacja komentarza z telefonem;
- 404 dla tras publicznych zablokowanego konta.

**Web (Vitest + Testing Library):**

- formularz: wybór gwiazdek klawiaturą, wymagana ocena, licznik, wysłanie i stan po wysłaniu;
- stany: druga strona oceniła, okno zamknięte, ocena drugiej strony;
- lista ocen na profilu z „Wcześniejsze oceny”.

**E2E (Playwright, mock API):** ocena ze strony zamówienia, profil z ocenami, axe i 390 px.

## Postęp i odstępstwa (2026-11-04)

Gotowe:

- migracja `0024_reviews`: tabela `reviews`;
- `@biddy/shared`: skala, okno i ujawnienie (`REVIEW_WINDOW_DAYS`, `REVIEW_REVEAL_DAYS`), walidacja komentarza (`reviewCommentIssue`), kod `REVIEW_UNAVAILABLE`, typy powiadomień `REVIEW_REQUESTED` i `REVIEW_RECEIVED`;
- moduł `reviews`:
  - reguły (`domain/review-rules.ts`);
  - `ReviewService` (stan ocen zamówienia, wystawienie pod blokadą doradczą zamówienia);
  - `ReputationService` (średnie według ról, lista z kursorem);
  - `ReviewPublisher` (job `reviews.publish`, kolejka `reviews`);
  - eventy `ReviewSubmitted` i `ReviewPublished`;
  - trasy stron zamówienia i publiczne;
- powiadomienia w grupie „Oceny” (konsumenci `notifications.review-requested` i `notifications.review-received`);
- web:
  - karta „Ocena transakcji” na stronie zamówienia;
  - statystyka „Ocena”, sekcja „Oceny” z listą i „Jak weryfikujemy oceny” na profilu;
  - ocena jako sprzedający w karcie sprzedawcy.

Decyzje: [PROJECT.md §22](../PROJECT.md#22-rejestr-decyzji), nr 142–147.

Odstępstwa:

- **Powiadomienie o zakończonym zamówieniu** (`ORDER_COMPLETED`, sprzedający) dostało zdanie „Oceń kupującego na stronie zamówienia w ciągu 14 dni.”. Kupujący kończy zamówienie sam („Wszystko OK”) albo widzi kartę oceny na stronie zamówienia.
- **Karta sprzedawcy:** gdy API ocen nie odpowiada, wiersz ocen znika (strona aukcji działa dalej). Profil pokazuje wtedy komunikat w sekcji „Oceny”.
- **Bez `reviews_viewed`:** wejście na profil mierzy już odsłona strony, a profil jest stroną publiczną z cache.
- **Karta oceny** pobiera stan ocen tylko dla zamówień `COMPLETED`, `REFUNDED` i `PARTIALLY_REFUNDED`. O zwrocie bez sporu rozstrzyga API (`NOT_FINISHED`, karta znika).
- **Szacunek ujawnienia w formularzu** („najpóźniej {data}”) liczy klient z tej samej reguły co API (7 dni, nie dłużej niż termin). Dokładną datę po wystawieniu podaje API (`visibleAt`).

## Otwarte pytania

- **Zgłaszanie ocen:** do F-35 przez support. Czy przed F-35 dodać „Zgłoś ocenę” z zapisem w `reports` (`target_type` `REVIEW`)?
- **Odpowiedź ocenianego:** krótka publiczna odpowiedź pod oceną (v1)?
- **Wpływ ocen na wyszukiwarkę:** `sellerRating` w indeksie i sortowanie po ocenie wymagają reindeksacji aukcji sprzedawcy po ujawnieniu oceny.
