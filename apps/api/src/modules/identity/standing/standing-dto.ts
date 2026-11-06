// Kontrakt API stanu konta (F-61): poziomy i limity, strike'i, blokady i odwołania. Widok
// użytkownika nie zawiera notatek wewnętrznych personelu (`note`) ani identyfikatorów personelu.
import {
  ACCOUNT_BLOCK_CAUSES,
  ACCOUNT_BLOCK_KINDS,
  APPEAL_MESSAGE_MAX_LENGTH,
  APPEAL_MESSAGE_MIN_LENGTH,
  APPEAL_STATUSES,
  BUYER_LEVELS,
  SELLER_LEVELS,
  STRIKE_REASONS,
  STRIKE_ROLES,
} from '@biddy/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { AccountBlockRow, StrikeRow } from '../db/standing.schema.js';
import { isBlockActive } from './block-rules.js';
import { LEVEL_REQUIREMENT_KINDS, type NextLevel } from './next-level.js';
import { appealOpen } from './strike.service.js';
import type { StandingOverview } from './account-standing.service.js';

const datetime = z.iso.datetime();
const iso = (date: Date | null) => date?.toISOString() ?? null;

const appealSchema = z.object({
  status: z.enum(APPEAL_STATUSES),
  message: z.string().min(1).nullable().describe('Treść odwołania użytkownika'),
  appealedAt: datetime.nullable(),
  resolvedAt: datetime.nullable(),
  note: z.string().min(1).nullable().describe('Uzasadnienie decyzji personelu'),
});

export const STRIKE_STATES = ['ACTIVE', 'EXPIRED', 'REVOKED'] as const;

export const strikeSchema = z.object({
  id: z.uuid(),
  role: z.enum(STRIKE_ROLES),
  reason: z.enum(STRIKE_REASONS),
  statement: z.string().min(1).describe('Uzasadnienie (statement of reasons)'),
  orderId: z.uuid().nullable(),
  auctionId: z.uuid().nullable(),
  createdAt: datetime,
  expiresAt: datetime.describe('Po tej chwili strike nie liczy się do progu'),
  state: z.enum(STRIKE_STATES),
  revokedAt: datetime.nullable(),
  revokeNote: z.string().min(1).nullable(),
  appeal: appealSchema,
  canAppeal: z.boolean(),
});

export const BLOCK_STATES = ['ACTIVE', 'EXPIRED', 'LIFTED'] as const;

export const blockSchema = z.object({
  id: z.uuid(),
  kind: z.enum(ACCOUNT_BLOCK_KINDS),
  cause: z.enum(ACCOUNT_BLOCK_CAUSES),
  strikeIds: z.array(z.uuid()),
  startsAt: datetime,
  endsAt: datetime.nullable().describe('null = bezterminowa'),
  statement: z.string().min(1),
  state: z.enum(BLOCK_STATES),
  liftedAt: datetime.nullable(),
  liftNote: z.string().min(1).nullable(),
  appeal: appealSchema,
  canAppeal: z.boolean(),
});

export class StrikeDto extends createZodDto(strikeSchema) {}
export class AccountBlockDto extends createZodDto(blockSchema) {}

export class MyStrikesDto extends createZodDto(
  z.object({
    strikes: z.array(strikeSchema).describe('Ostatnie 2 lata, najnowsze pierwsze'),
    blocks: z.array(blockSchema).describe('Ostatnie 2 lata, najnowsze pierwsze'),
  }),
) {}

const activeBlockSchema = z
  .object({ id: z.uuid(), until: datetime.nullable().describe('null = bezterminowa') })
  .nullable();

const requirementSchema = z.object({
  kind: z.enum(LEVEL_REQUIREMENT_KINDS),
  current: z.int(),
  required: z.int(),
  met: z.boolean(),
});

const buyerLimitsSchema = z.object({
  maxBidAmount: z.int().nullable().describe('Maks. oferta w groszach albo null (bez limitu)'),
  maxActiveAuctions: z.int().nullable().describe('Maks. aukcji z aktywną ofertą albo null'),
});

const sellerLimitsSchema = z.object({
  maxActiveAuctions: z.int().nullable().describe('Maks. aktywnych aukcji albo null'),
  maxAuctionValue: z.int().nullable().describe('Maks. wartość aukcji w groszach albo null'),
});

export class MyStandingDto extends createZodDto(
  z.object({
    buyer: z.object({
      level: z.enum(BUYER_LEVELS),
      limits: buyerLimitsSchema,
      overridden: z.boolean().describe('Limity ustawione ręcznie przez Biddy'),
      next: z
        .object({
          level: z.enum(BUYER_LEVELS),
          limits: buyerLimitsSchema,
          requirements: z.array(requirementSchema),
        })
        .nullable(),
      block: activeBlockSchema.describe('Aktywna blokada licytowania'),
    }),
    seller: z.object({
      level: z.enum(SELLER_LEVELS),
      limits: sellerLimitsSchema,
      overridden: z.boolean(),
      next: z
        .object({
          level: z.enum(SELLER_LEVELS),
          limits: sellerLimitsSchema,
          requirements: z.array(requirementSchema),
        })
        .nullable(),
      block: activeBlockSchema.describe('Aktywna blokada wystawiania'),
    }),
    strikes: z.object({
      windowDays: z.int(),
      blockDays: z.int().describe('Długość pierwszej blokady w dniach'),
      threshold: z.int().describe("Tyle strike'ów w oknie daje blokadę"),
      buyer: z.int().describe("Strike'i kupującego, które liczą się do progu"),
      seller: z.int().describe("Strike'i sprzedającego, które liczą się do progu"),
    }),
  }),
) {}

export class AppealDto extends createZodDto(
  z
    .object({
      message: z
        .string()
        .trim()
        .min(
          APPEAL_MESSAGE_MIN_LENGTH,
          `Opisz sprawę w co najmniej ${String(APPEAL_MESSAGE_MIN_LENGTH)} znakach.`,
        )
        .max(
          APPEAL_MESSAGE_MAX_LENGTH,
          `Odwołanie może mieć najwyżej ${String(APPEAL_MESSAGE_MAX_LENGTH)} znaków.`,
        ),
    })
    .strict(),
) {}

export function strikeDto(row: StrikeRow, appealWindowDays: number, now = new Date()) {
  const state: (typeof STRIKE_STATES)[number] =
    row.revokedAt !== null ? 'REVOKED' : row.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
  return {
    id: row.id,
    role: row.role,
    reason: row.reason,
    statement: row.statement,
    orderId: row.orderId,
    auctionId: row.auctionId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    state,
    revokedAt: iso(row.revokedAt),
    revokeNote: row.revokeNote,
    appeal: appealDto(row),
    canAppeal: appealOpen(row, row.revokedAt === null, appealWindowDays, now),
  };
}

export function blockDto(row: AccountBlockRow, appealWindowDays: number, now = new Date()) {
  const active = isBlockActive(row, now);
  const state: (typeof BLOCK_STATES)[number] =
    row.liftedAt !== null ? 'LIFTED' : active || row.startsAt > now ? 'ACTIVE' : 'EXPIRED';
  return {
    id: row.id,
    kind: row.kind,
    cause: row.cause,
    strikeIds: row.strikeIds,
    startsAt: row.startsAt.toISOString(),
    endsAt: iso(row.endsAt),
    statement: row.statement,
    state,
    liftedAt: iso(row.liftedAt),
    liftNote: row.liftNote,
    appeal: appealDto(row),
    canAppeal: appealOpen(row, state === 'ACTIVE', appealWindowDays, now),
  };
}

function appealDto(row: StrikeRow | AccountBlockRow) {
  return {
    status: row.appealStatus,
    message: row.appealMessage,
    appealedAt: iso(row.appealedAt),
    resolvedAt: iso(row.appealResolvedAt),
    note: row.appealNote,
  };
}

function nextDto<TLevel extends string, TLimits>(
  next: NextLevel<TLevel> | null,
  limits: (level: TLevel) => TLimits,
) {
  return next === null
    ? null
    : { level: next.level, limits: limits(next.level), requirements: [...next.requirements] };
}

export function standingDto(overview: StandingOverview): MyStandingDto {
  const { policy, buyer, seller } = overview;
  return {
    buyer: {
      level: buyer.level,
      limits: buyer.limits,
      overridden: buyer.overridden,
      next: nextDto(overview.nextBuyer, (level) => policy.buyer.levels[level]),
      block:
        buyer.biddingBlock === null
          ? null
          : { id: buyer.biddingBlock.id, until: iso(buyer.biddingBlock.until) },
    },
    seller: {
      level: seller.level,
      limits: seller.limits,
      overridden: seller.overridden,
      next: nextDto(overview.nextSeller, (level) => policy.seller.levels[level]),
      block:
        seller.listingBlock === null
          ? null
          : { id: seller.listingBlock.id, until: iso(seller.listingBlock.until) },
    },
    strikes: {
      windowDays: policy.strikes.windowDays,
      blockDays: policy.strikes.blockDays,
      threshold: policy.strikes.blockThreshold,
      buyer: overview.countable.buyer,
      seller: overview.countable.seller,
    },
  };
}
