// Eventy domenowe modułu identity (F-61, PROJECT.md §14.3): strike'i, blokady kont i odwołania.
// Konsumenci: powiadomienia z uzasadnieniem (F-61); audit log w F-34.
import {
  ACCOUNT_BLOCK_CAUSES,
  ACCOUNT_BLOCK_KINDS,
  APPEAL_DECISIONS,
  STRIKE_REASONS,
  STRIKE_ROLES,
} from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

/** Nowy strike (system albo personel). */
export const StrikeIssued = defineDomainEvent({
  type: 'StrikeIssued',
  version: 1,
  aggregateType: 'strike',
  payload: z.object({
    userId: z.uuid(),
    role: z.enum(STRIKE_ROLES),
    reason: z.enum(STRIKE_REASONS),
    orderId: z.uuid().nullable(),
    auctionId: z.uuid().nullable(),
    expiresAt: z.iso.datetime(),
  }),
});

/** Strike cofnięty przez personel, uwzględnione odwołanie albo system (spóźniona płatność). */
export const StrikeRevoked = defineDomainEvent({
  type: 'StrikeRevoked',
  version: 1,
  aggregateType: 'strike',
  payload: z.object({
    userId: z.uuid(),
    role: z.enum(STRIKE_ROLES),
    reason: z.enum(STRIKE_REASONS),
    bySystem: z.boolean(),
  }),
});

/** Nowa blokada konta; `until` null = bezterminowa. */
export const AccountBlocked = defineDomainEvent({
  type: 'AccountBlocked',
  version: 1,
  aggregateType: 'account-block',
  payload: z.object({
    userId: z.uuid(),
    kind: z.enum(ACCOUNT_BLOCK_KINDS),
    cause: z.enum(ACCOUNT_BLOCK_CAUSES),
    until: z.iso.datetime().nullable(),
  }),
});

/** Blokada zdjęta przed końcem (cofnięty strike, odwołanie albo decyzja moderatora). */
export const AccountBlockLifted = defineDomainEvent({
  type: 'AccountBlockLifted',
  version: 1,
  aggregateType: 'account-block',
  payload: z.object({
    userId: z.uuid(),
    kind: z.enum(ACCOUNT_BLOCK_KINDS),
  }),
});

/** Personel rozpatrzył odwołanie od strike'a albo blokady. */
export const AppealResolved = defineDomainEvent({
  type: 'AppealResolved',
  version: 1,
  aggregateType: 'appeal',
  payload: z.object({
    userId: z.uuid(),
    subject: z.enum(['STRIKE', 'BLOCK']),
    subjectId: z.uuid(),
    decision: z.enum(APPEAL_DECISIONS),
  }),
});
