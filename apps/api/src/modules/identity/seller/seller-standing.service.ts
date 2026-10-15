// Stan konta sprzedawcy (F-14, PROJECT.md §4.1): poziom i limity, KYC, blokada wystawiania
// i potwierdzenie informacji o weryfikacji tożsamości. Poziom z historii sprzedaży i nadpisania
// limitów (`users.limits`) liczy F-61, status KYC z operatora F-32; do tego czasu każdy
// sprzedawca ma poziom „nowy” i brak KYC.
import {
  KYC_REQUIRED_ABOVE,
  SELLER_LIMITS,
  type SellerLevel,
  type SellerLevelLimits,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { users } from '../db/identity.schema.js';

export interface SellerStanding {
  readonly level: SellerLevel;
  readonly limits: SellerLevelLimits;
  /** Pozytywna weryfikacja u operatora płatności (F-32). */
  readonly kycVerified: boolean;
  /** Wartość aukcji, powyżej której wymagane jest KYC (grosze). */
  readonly kycRequiredAbove: number;
  /** Koniec blokady wystawiania albo null; blokada działa, gdy data jest w przyszłości. */
  readonly listingBlockedUntil: Date | null;
  /** Kiedy sprzedawca potwierdził informację o weryfikacji tożsamości (null = jeszcze nie). */
  readonly kycNoticeAcceptedAt: Date | null;
}

@Injectable()
export class SellerStandingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Stan sprzedawcy; z `tx` w transakcji wywołującego (np. publikacja aukcji). */
  async get(userId: string, tx?: Transaction): Promise<SellerStanding> {
    const [row] = await (tx ?? this.db)
      .select({
        listingBlockedUntil: users.listingBlockedUntil,
        kycNoticeAcceptedAt: users.sellerKycNoticeAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) {
      throw new Error(`Nie ma użytkownika ${userId}`);
    }
    const level: SellerLevel = 'NEW';
    return {
      level,
      limits: SELLER_LIMITS[level],
      kycVerified: false,
      kycRequiredAbove: KYC_REQUIRED_ABOVE,
      listingBlockedUntil: row.listingBlockedUntil,
      kycNoticeAcceptedAt: row.kycNoticeAcceptedAt,
    };
  }

  /** Zapisuje potwierdzenie informacji o KYC (dowód poinformowania, §17); kolejne nie zmienia daty. */
  async acceptKycNotice(userId: string, tx: Transaction): Promise<void> {
    const [row] = await tx
      .select({ acceptedAt: users.sellerKycNoticeAcceptedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (row !== undefined && row.acceptedAt === null) {
      await tx
        .update(users)
        .set({ sellerKycNoticeAcceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  }
}
