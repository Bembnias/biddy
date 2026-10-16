// Katalog kolejek BullMQ (PROJECT.md §10.4, §11.2): jedno miejsce z listą kolejek, ich
// współbieżnością i polityką ponowień. Moduły odwołują się do kolejki po nazwie (QueueName),
// a worker uruchamia przetwarzanie tylko tych kolejek, dla których jakiś moduł ma handler.
//
// Nowa kolejka: wpis w QUEUE_DEFINITIONS. Osobna
// kolejka ma sens, gdy joby potrzebują własnej współbieżności albo nie mogą czekać za innymi
// (zamknięcie aukcji nie może stać w kolejce za tysiącem maili).
import type { DefaultJobOptions } from 'bullmq';

/**
 * Domyślna polityka jobów: 10 prób z wykładniczym odstępem od 2 s (2, 4, 8, …, 512 s, łącznie
 * ok. 17 minut), z losowym rozrzutem do 50%, żeby ponowienia po awarii zależności nie uderzały
 * naraz. Zakończone joby trzymamy dobę (podgląd w Bull Board; job o tym samym ID dodany
 * ponownie w tym czasie zostanie pominięty), nieudane 14 dni.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 10,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60 },
} as const satisfies DefaultJobOptions;

export interface QueueDefinition {
  /** Do czego służy kolejka (opis w Bull Board i w dokumentacji). */
  readonly description: string;
  /** Ile jobów tej kolejki przetwarza naraz jeden proces workera. */
  readonly concurrency: number;
  /** Nadpisania {@link DEFAULT_JOB_OPTIONS} dla jobów tej kolejki. */
  readonly jobOptions?: DefaultJobOptions;
}

export const QUEUE_DEFINITIONS = {
  'domain-events': {
    description:
      'Eventy domenowe z outboxa: osobny job dla każdego konsumenta (nazwa joba = nazwa konsumenta)',
    concurrency: 10,
  },
  maintenance: {
    description: 'Joby cykliczne infrastruktury, np. sprzątanie outboxa',
    concurrency: 1,
  },
  media: {
    description:
      'Przetwarzanie zdjęć: weryfikacja, usunięcie EXIF, warianty WebP i moderacja (F-12)',
    concurrency: 2,
  },
  auctions: {
    description:
      'Zamykanie aukcji: joby z terminem (ID z ends_at) i sweeper co 10 s jako siatka bezpieczeństwa (F-16)',
    concurrency: 10,
  },
  notifications: {
    description:
      'Powiadomienia z terminem, np. „aukcja kończy się za godzinę” (F-20); dostarczenie idzie przez domain-events',
    concurrency: 10,
  },
  search: {
    description:
      'Indeks wyszukiwarki (Meilisearch): aktualizacja aukcji najwyżej raz na 5 s i nocny pełny reindeks (F-19)',
    concurrency: 5,
  },
  web: {
    description:
      'Rewalidacja stron ISR w web po zmianach aukcji: najwyżej raz na 5 s na stronę (ID z końcem okna, F-18)',
    concurrency: 5,
  },
  emails: {
    description:
      'Wysyłka e-maili (weryfikacja adresu, reset hasła). Treść zawiera linki z tokenami, więc job znika po wysłaniu',
    concurrency: 5,
    jobOptions: { removeOnComplete: true },
  },
} as const satisfies Record<string, QueueDefinition>;

/** Nazwa kolejki z katalogu. */
export type QueueName = keyof typeof QUEUE_DEFINITIONS;

export const QUEUE_NAMES = Object.keys(QUEUE_DEFINITIONS) as QueueName[];

/** Kolejka eventów domenowych z outboxa (relay → konsumenci). */
export const DOMAIN_EVENTS_QUEUE = 'domain-events' satisfies QueueName;

/**
 * Dead-letter queue: kopie jobów, które wyczerpały wszystkie próby. Żaden worker jej nie
 * przetwarza; wpisy czekają na decyzję (ponowienie przez DeadLetterQueue.replay albo usunięcie).
 */
export const DEAD_LETTER_QUEUE = 'dead-letter';

export function isQueueName(value: string): value is QueueName {
  return Object.hasOwn(QUEUE_DEFINITIONS, value);
}

/** Opcje jobów kolejki: domyślne plus nadpisania z katalogu. */
export function jobOptionsFor(queue: QueueName): DefaultJobOptions {
  const definition: QueueDefinition = QUEUE_DEFINITIONS[queue];
  return { ...DEFAULT_JOB_OPTIONS, ...definition.jobOptions };
}
