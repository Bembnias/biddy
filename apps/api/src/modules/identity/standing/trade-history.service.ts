// Historia zamówień do poziomów kont (F-61, PROJECT.md §4.1). Moduł identity nie czyta tabel
// `orders`: zamówienia dopisuje moduł orders przez to API (konsument OrderPaid, w F-26
// zakończenie, w F-28 przegrany spór). Każdy zapis to upsert po `order_id`, więc ponowione
// zdarzenie niczego nie zmienia.
import type { BuyerHistory, SellerHistory } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq, or, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { tradeRecords } from '../db/standing.schema.js';

export interface TradeParties {
  readonly orderId: string;
  readonly buyerId: string;
  readonly sellerId: string;
}

/** Liczby z historii (bez wieku konta i KYC, które dokłada standing). */
export interface TradeCounts {
  readonly paidOrders: number;
  readonly completedOrders: number;
  readonly completedSales: number;
  readonly lostDisputes: number;
}

@Injectable()
export class TradeHistoryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Zamówienie opłacone (kupujący: poziom „sprawdzony”). */
  async recordPaid(tx: Transaction, parties: TradeParties, paidAt: Date): Promise<void> {
    await tx
      .insert(tradeRecords)
      .values({ ...parties, paidAt })
      .onConflictDoUpdate({
        target: tradeRecords.orderId,
        set: {
          paidAt: sql`coalesce(${tradeRecords.paidAt}, excluded.paid_at)`,
          updatedAt: new Date(),
        },
      });
  }

  /** Zamówienie zakończone (F-26): zakupy do „zaufanego”, sprzedaże do „zweryfikowanego”. */
  async recordCompleted(tx: Transaction, parties: TradeParties, completedAt: Date): Promise<void> {
    await tx
      .insert(tradeRecords)
      .values({ ...parties, completedAt })
      .onConflictDoUpdate({
        target: tradeRecords.orderId,
        set: {
          completedAt: sql`coalesce(${tradeRecords.completedAt}, excluded.completed_at)`,
          updatedAt: new Date(),
        },
      });
  }

  /** Spór przegrany przez sprzedającego (F-28): blokuje poziom „zweryfikowany”. */
  async recordDisputeLost(tx: Transaction, parties: TradeParties, decidedAt: Date): Promise<void> {
    await tx
      .insert(tradeRecords)
      .values({ ...parties, sellerDisputeLostAt: decidedAt })
      .onConflictDoUpdate({
        target: tradeRecords.orderId,
        set: {
          sellerDisputeLostAt: sql`coalesce(${tradeRecords.sellerDisputeLostAt}, excluded.seller_dispute_lost_at)`,
          updatedAt: new Date(),
        },
      });
  }

  /** Kupujący zamówienia albo undefined (zamówienie nieopłacone przed F-61 i bez backfillu). */
  async parties(orderId: string, tx?: Transaction): Promise<TradeParties | undefined> {
    const [row] = await (tx ?? this.db)
      .select({
        orderId: tradeRecords.orderId,
        buyerId: tradeRecords.buyerId,
        sellerId: tradeRecords.sellerId,
      })
      .from(tradeRecords)
      .where(eq(tradeRecords.orderId, orderId));
    return row;
  }

  async counts(userId: string, tx?: Transaction): Promise<TradeCounts> {
    const [row] = await (tx ?? this.db)
      .select({
        paidOrders: sql<number>`count(*) filter (where ${tradeRecords.buyerId} = ${userId} and ${tradeRecords.paidAt} is not null)::int`,
        completedOrders: sql<number>`count(*) filter (where ${tradeRecords.buyerId} = ${userId} and ${tradeRecords.completedAt} is not null)::int`,
        completedSales: sql<number>`count(*) filter (where ${tradeRecords.sellerId} = ${userId} and ${tradeRecords.completedAt} is not null)::int`,
        lostDisputes: sql<number>`count(*) filter (where ${tradeRecords.sellerId} = ${userId} and ${tradeRecords.sellerDisputeLostAt} is not null)::int`,
      })
      .from(tradeRecords)
      .where(or(eq(tradeRecords.buyerId, userId), eq(tradeRecords.sellerId, userId)));
    return row ?? { paidOrders: 0, completedOrders: 0, completedSales: 0, lostDisputes: 0 };
  }
}

/** Historia kupującego do `buyerLevel`. */
export function buyerHistoryOf(counts: TradeCounts, accountCreatedAt: Date): BuyerHistory {
  return {
    paidOrders: counts.paidOrders,
    completedOrders: counts.completedOrders,
    accountCreatedAt,
  };
}

/** Historia sprzedającego do `sellerLevel`; status KYC przyjdzie z F-32. */
export function sellerHistoryOf(counts: TradeCounts, kycVerified: boolean): SellerHistory {
  return {
    completedSales: counts.completedSales,
    lostDisputes: counts.lostDisputes,
    kycVerified,
  };
}
