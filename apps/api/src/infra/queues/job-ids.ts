// Konwencje ID jobów BullMQ. BullMQ pomija dodanie joba, którego ID już istnieje (oczekujący,
// opóźniony, aktywny albo zachowany po zakończeniu), więc ID decyduje o deduplikacji.
//
// Job z terminem (PROJECT.md §15.2, §15.3): ID zawiera termin, np.
// `close-{auctionId}-{endsAtEpochMs}`. Stałe ID (np. `close-{auctionId}`) uniemożliwiłoby
// zaplanowanie joba na nowy termin, dopóki stary job istnieje, także z wnętrza tego joba
// (aukcja przedłużona w ostatniej chwili). Z terminem w ID nowy termin to nowy job, a ten sam
// termin dodany dwa razy to jeden job.

/** Rodzaj joba w ID: małe litery, cyfry, `.` i `-`, np. `close` albo `order.payment-deadline`. */
const KIND_PATTERN = /^[a-z][a-z0-9.-]*$/;

/**
 * Część ID pochodząca z danych (UUID encji, nazwa konsumenta). Bez dwukropka: BullMQ używa go
 * w kluczach Redisa i odrzuca takie ID.
 */
const ID_PART_PATTERN = /^[A-Za-z0-9_.-]+$/;

export class InvalidJobIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobIdError';
  }
}

function assertPart(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new InvalidJobIdError(
      `Niepoprawny fragment ID joba (${label}): „${value}”. Dozwolone: ${pattern.source}`,
    );
  }
}

/**
 * ID joba z terminem: `{kind}-{entityId}-{terminWMilisekundachEpoki}`.
 *
 * @example deadlineJobId('close', auction.id, auction.endsAt) // close-0199…-1767225600000
 */
export function deadlineJobId(kind: string, entityId: string, deadline: Date | number): string {
  assertPart(kind, KIND_PATTERN, 'rodzaj');
  assertPart(entityId, ID_PART_PATTERN, 'ID encji');
  const epochMs = deadline instanceof Date ? deadline.getTime() : deadline;
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new InvalidJobIdError(`Niepoprawny termin joba: ${String(deadline)}`);
  }
  return `${kind}-${entityId}-${epochMs}`;
}

/**
 * ID joba dostarczającego event do konsumenta: `{konsument}-{eventId}`. Relay może przekazać
 * event ponownie (np. po restarcie w trakcie porcji), a to samo ID nie tworzy drugiego joba.
 */
export function eventJobId(consumer: string, eventId: string): string {
  assertPart(consumer, ID_PART_PATTERN, 'konsument');
  assertPart(eventId, ID_PART_PATTERN, 'ID eventu');
  return `${consumer}-${eventId}`;
}
