// Reguły blokad (F-61, PROJECT.md §4.1) jako czyste funkcje: które strike'i liczą się do progu,
// kiedy powstaje blokada i kiedy jest bezterminowa. Serwis woła je pod blokadą wiersza
// użytkownika, więc dwa strike'i naraz nie dadzą dwóch blokad.
import {
  type AccountBlockCause,
  type AccountBlockKind,
  type AccountPolicy,
  blockKindOf,
  type StrikeRole,
} from '@biddy/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StrikeFact {
  readonly id: string;
  readonly role: StrikeRole;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface BlockFact {
  readonly id: string;
  readonly kind: AccountBlockKind;
  readonly cause: AccountBlockCause;
  readonly strikeIds: readonly string[];
  readonly startsAt: Date;
  /** null = bezterminowa. */
  readonly endsAt: Date | null;
  readonly liftedAt: Date | null;
}

export interface BlockDecision {
  readonly kind: AccountBlockKind;
  readonly cause: AccountBlockCause;
  readonly strikeIds: readonly string[];
  readonly startsAt: Date;
  /** null = bezterminowa. */
  readonly endsAt: Date | null;
  /** Druga blokada w oknie eskalacji (dlatego bezterminowa). */
  readonly escalated: boolean;
}

/** Blokada działa: niezdjęta, już się zaczęła i jeszcze się nie skończyła. */
export function isBlockActive(block: BlockFact, now: Date): boolean {
  return (
    block.liftedAt === null &&
    block.startsAt <= now &&
    (block.endsAt === null || block.endsAt > now)
  );
}

/**
 * Aktywna blokada danego rodzaju, która trwa najdłużej (bezterminowa przed terminową) albo
 * undefined.
 */
export function strongestActiveBlock<T extends BlockFact>(
  blocks: readonly T[],
  kind: AccountBlockKind,
  now: Date,
): T | undefined {
  let strongest: T | undefined;
  for (const block of blocks) {
    if (block.kind !== kind || !isBlockActive(block, now)) {
      continue;
    }
    if (
      strongest === undefined ||
      block.endsAt === null ||
      (strongest.endsAt !== null && block.endsAt > strongest.endsAt)
    ) {
      strongest = block;
    }
  }
  return strongest;
}

/**
 * Strike'i roli, które liczą się do progu: niecofnięte, z okna (`windowDays`) i jeszcze nie
 * „zużyte” przez niezdjętą blokadę tej roli. Dzięki temu po końcu blokady potrzeba trzech nowych
 * strike'ów, a nie jednego.
 */
export function countableStrikes<T extends StrikeFact>(
  role: StrikeRole,
  strikes: readonly T[],
  blocks: readonly BlockFact[],
  policy: AccountPolicy,
  now: Date,
): T[] {
  const kind = blockKindOf(role);
  const consumed = new Set(
    blocks
      .filter((block) => block.kind === kind && block.liftedAt === null)
      .flatMap((block) => block.strikeIds),
  );
  const windowStart = now.getTime() - policy.strikes.windowDays * DAY_MS;
  return strikes
    .filter(
      (strike) =>
        strike.role === role &&
        strike.revokedAt === null &&
        strike.createdAt.getTime() > windowStart &&
        !consumed.has(strike.id),
    )
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Czy nowy strike roli daje blokadę: próg strike'ów w oknie i brak aktywnej blokady tego rodzaju.
 * Blokada jest bezterminowa, gdy w oknie eskalacji zaczęła się inna niezdjęta blokada z progu
 * strike'ów (także już wygasła).
 */
export function blockDecision(
  role: StrikeRole,
  strikes: readonly StrikeFact[],
  blocks: readonly BlockFact[],
  policy: AccountPolicy,
  now: Date,
): BlockDecision | undefined {
  const kind = blockKindOf(role);
  if (strongestActiveBlock(blocks, kind, now) !== undefined) {
    return undefined;
  }
  const counted = countableStrikes(role, strikes, blocks, policy, now);
  if (counted.length < policy.strikes.blockThreshold) {
    return undefined;
  }
  const escalationStart = now.getTime() - policy.strikes.escalationWindowDays * DAY_MS;
  const escalated = blocks.some(
    (block) =>
      block.kind === kind &&
      block.cause === 'STRIKES' &&
      block.liftedAt === null &&
      block.startsAt.getTime() > escalationStart,
  );
  return {
    kind,
    cause: 'STRIKES',
    strikeIds: counted.map((strike) => strike.id),
    startsAt: now,
    endsAt: escalated ? null : new Date(now.getTime() + policy.strikes.blockDays * DAY_MS),
    escalated,
  };
}

/**
 * Potwierdzona podróbka (§4.1): natychmiastowa, bezterminowa blokada wystawiania i wypłat do
 * decyzji moderatora. Rodzaj, który już ma aktywną blokadę bezterminową, pomijamy.
 */
export function counterfeitBlocks(
  strikeId: string,
  blocks: readonly BlockFact[],
  now: Date,
): BlockDecision[] {
  return (['LISTING', 'PAYOUTS'] as const)
    .filter((kind) => strongestActiveBlock(blocks, kind, now)?.endsAt !== null)
    .map((kind) => ({
      kind,
      cause: 'COUNTERFEIT',
      strikeIds: [strikeId],
      startsAt: now,
      endsAt: null,
      escalated: false,
    }));
}
