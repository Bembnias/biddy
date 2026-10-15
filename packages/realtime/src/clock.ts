// Synchronizacja zegara z serwerem (PROJECT.md §15.4): przesunięcie = czas serwera minus czas
// lokalny w połowie zapytania, mediana z kilku próbek. Próbki z długim czasem odpowiedzi
// odrzucamy, bo asymetria opóźnień rośnie z czasem odpowiedzi.

export interface ClockSample {
  /** Czas serwera minus lokalny czas w połowie zapytania (ms). */
  readonly offset: number;
  /** Czas od wysłania do odpowiedzi (ms). */
  readonly roundTrip: number;
}

/** Domyślny próg czasu odpowiedzi, powyżej którego próbka jest odrzucana. */
export const MAX_SAMPLE_ROUND_TRIP_MS = 1_000;

export function clockSample(serverTime: string, sentAt: number, receivedAt: number): ClockSample {
  return {
    offset: Date.parse(serverTime) - (sentAt + receivedAt) / 2,
    roundTrip: receivedAt - sentAt,
  };
}

/**
 * Przesunięcie zegara z próbek: mediana przesunięć próbek z czasem odpowiedzi ≤ `maxRoundTripMs`
 * (połowa najszybszych, gdy jest ich dużo). Undefined, gdy żadna próbka się nie nadaje.
 */
export function estimateClockOffset(
  samples: readonly ClockSample[],
  maxRoundTripMs: number = MAX_SAMPLE_ROUND_TRIP_MS,
): number | undefined {
  const usable = samples
    .filter((sample) => Number.isFinite(sample.offset) && sample.roundTrip <= maxRoundTripMs)
    .sort((a, b) => a.roundTrip - b.roundTrip);
  if (usable.length === 0) {
    return undefined;
  }
  // Szybsze próbki mają mniejszą niepewność (połowa czasu odpowiedzi).
  const fastest = usable.slice(0, Math.max(1, Math.ceil(usable.length / 2) + 1));
  const offsets = fastest.map((sample) => sample.offset).sort((a, b) => a - b);
  const middle = Math.floor(offsets.length / 2);
  return offsets.length % 2 === 1
    ? (offsets[middle] ?? 0)
    : ((offsets[middle - 1] ?? 0) + (offsets[middle] ?? 0)) / 2;
}
