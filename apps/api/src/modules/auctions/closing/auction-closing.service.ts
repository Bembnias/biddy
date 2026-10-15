// Zamykanie aukcji (F-16, PROJECT.md §6.7, §15.2): job z terminem w ID planowany z eventów
// publikacji i przedłużenia, zamknięcie w transakcji z blokadą wiersza aukcji (dokładnie raz)
// i sweeper co 10 s dla aukcji, których job zaginął. Sprzedana aukcja dostaje zamówienie w tej
// samej transakcji (także przy Kup teraz, F-15).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { type DomainEventOf, OnDomainEvent, Outbox } from '../../../infra/outbox/index.js';
import {
  deadlineJobId,
  JobHandler,
  JobQueues,
  type JobRun,
  ScheduledJob,
} from '../../../infra/queues/index.js';
import { CategoryService, ItemService } from '../../catalog/index.js';
import { MediaService } from '../../media/index.js';
import { type Order, type OrderItemSnapshot, OrderService } from '../../orders/index.js';
import { AuctionEnded, AuctionExtended, AuctionPublished } from '../auctions.events.js';
import { type Auction, auctions } from '../db/auctions.schema.js';

export const CLOSE_JOB = 'auction.close';
/** Sweeper zamyka aukcje spóźnione o więcej niż 5 s (job zwykle zdąży wcześniej). */
const SWEEP_GRACE_MS = 5_000;
const SWEEP_BATCH = 100;

export type CloseResult = 'NOT_ACTIVE' | 'RESCHEDULED' | 'SOLD' | 'UNSOLD';

@Injectable()
export class AuctionClosingService {
  private readonly logger = new Logger(AuctionClosingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(OrderService) private readonly orders: OrderService,
    private readonly jobs: JobQueues,
    private readonly outbox: Outbox,
  ) {}

  @OnDomainEvent(AuctionPublished, { consumer: 'auctions.schedule-close' })
  async onPublished(event: DomainEventOf<typeof AuctionPublished>): Promise<void> {
    await this.schedule(event.aggregateId, new Date(event.payload.endsAt));
  }

  @OnDomainEvent(AuctionExtended, { consumer: 'auctions.reschedule-close' })
  async onExtended(event: DomainEventOf<typeof AuctionExtended>): Promise<void> {
    await this.schedule(event.aggregateId, new Date(event.payload.endsAt));
  }

  /** Job zamknięcia na `endsAt`; ten sam termin drugi raz to ten sam job (ID z terminem). */
  async schedule(auctionId: string, endsAt: Date): Promise<void> {
    await this.jobs.add(
      'auctions',
      CLOSE_JOB,
      { auctionId },
      { jobId: deadlineJobId('close', auctionId, endsAt), runAt: endsAt },
    );
  }

  @JobHandler('auctions', CLOSE_JOB)
  async onCloseJob(job: JobRun<{ auctionId: string }>): Promise<void> {
    await this.close(job.data.auctionId);
  }

  /** Siatka bezpieczeństwa (§15.2): aukcje po czasie, których job zaginął. */
  @ScheduledJob({ queue: 'auctions', name: 'auctions.close-sweeper', every: 10_000 })
  async sweep(): Promise<number> {
    const due = await this.db
      .select({ id: auctions.id })
      .from(auctions)
      .where(
        and(
          eq(auctions.status, 'ACTIVE'),
          lte(auctions.endsAt, sql`now() - ${`${String(SWEEP_GRACE_MS)} milliseconds`}::interval`),
        ),
      )
      .orderBy(asc(auctions.endsAt))
      .limit(SWEEP_BATCH);
    let closed = 0;
    for (const { id } of due) {
      try {
        const result = await this.close(id);
        if (result === 'SOLD' || result === 'UNSOLD') {
          closed += 1;
          this.logger.warn({ auctionId: id }, 'Sweeper zamknął aukcję (job zamknięcia nie zdążył)');
        }
      } catch (error) {
        // Błąd jednej aukcji (np. brak cennika POK) nie zatrzymuje pozostałych.
        this.logger.error({ auctionId: id, err: error }, 'Sweeper nie zamknął aukcji');
      }
    }
    return closed;
  }

  /**
   * Zamknięcie aukcji (dokładnie raz): pod blokadą wiersza aukcja nie ACTIVE to brak akcji,
   * przed `ends_at` (przedłużona) nowy job na aktualny termin, po `ends_at` wynik i zamówienie.
   */
  async close(auctionId: string): Promise<CloseResult> {
    let reschedule: Date | undefined;
    const result = await this.db.transaction(async (tx): Promise<CloseResult> => {
      const [auction] = await tx
        .select()
        .from(auctions)
        .where(eq(auctions.id, auctionId))
        .for('update');
      if (auction?.status !== 'ACTIVE' || auction.endsAt === null) {
        return 'NOT_ACTIVE';
      }
      const now = await clock(tx);
      if (auction.endsAt > now) {
        reschedule = auction.endsAt;
        return 'RESCHEDULED';
      }
      const sold =
        auction.leaderId !== null &&
        auction.currentPrice !== null &&
        (auction.reservePrice === null || auction.currentPrice >= auction.reservePrice);
      const [ended] = await tx
        .update(auctions)
        .set({
          status: sold ? 'ENDED_SOLD' : 'ENDED_UNSOLD',
          version: sql`${auctions.version} + 1`,
          updatedAt: now,
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (ended === undefined) {
        return 'NOT_ACTIVE';
      }
      if (sold) {
        await this.settleSale(tx, ended, 'TIME', auction.endsAt);
      }
      await this.outbox.add(
        tx,
        AuctionEnded.create({
          aggregateId: ended.id,
          payload: {
            sellerId: ended.sellerId,
            outcome: sold ? 'SOLD' : 'UNSOLD',
            winnerId: sold ? ended.leaderId : null,
            finalPrice:
              sold && ended.currentPrice !== null
                ? { amount: ended.currentPrice, currency: ended.currency }
                : null,
            endedBy: 'TIME',
            endedAt: auction.endsAt.toISOString(),
          },
        }),
      );
      this.logger.log(
        {
          auctionId: ended.id,
          outcome: sold ? 'SOLD' : 'UNSOLD',
          closeDelayMs: now.getTime() - auction.endsAt.getTime(),
        },
        'Aukcja zakończona',
      );
      return sold ? 'SOLD' : 'UNSOLD';
    });
    if (reschedule !== undefined) {
      await this.schedule(auctionId, reschedule);
    }
    return result;
  }

  /**
   * Zamówienie dla sprzedanej aukcji (stan po zakończeniu: lider i cena) w transakcji
   * zakończenia, ze snapshotem przedmiotu z tej chwili.
   */
  async settleSale(
    tx: Transaction,
    auction: Auction,
    endedBy: 'TIME' | 'BUY_NOW',
    endedAt: Date,
  ): Promise<Order> {
    if (auction.leaderId === null || auction.currentPrice === null) {
      throw new Error(`Aukcja ${auction.id} bez zwycięzcy nie może dostać zamówienia`);
    }
    return this.orders.createForAuction(tx, {
      auctionId: auction.id,
      buyerId: auction.leaderId,
      sellerId: auction.sellerId,
      currency: auction.currency,
      hammerPrice: auction.currentPrice,
      endedAt,
      snapshot: await this.snapshot(tx, auction, endedBy, endedAt),
    });
  }

  private async snapshot(
    tx: Transaction,
    auction: Auction,
    endedBy: 'TIME' | 'BUY_NOW',
    endedAt: Date,
  ): Promise<OrderItemSnapshot> {
    const item = await this.items.get(auction.itemId, tx);
    if (item === undefined) {
      throw new Error(`Aukcja ${auction.id} bez przedmiotu ${auction.itemId}`);
    }
    const [path, described, photos] = await Promise.all([
      item.categoryId === null ? [] : this.categories.pathNames(item.categoryId),
      item.categoryId === null
        ? []
        : this.categories.describeAttributes(item.categoryId, item.attributes),
      this.media.describe(auction.sellerId, item.mediaIds, tx),
    ]);
    return {
      version: 1,
      auction: {
        id: auction.id,
        publicId: auction.publicId,
        startPrice: auction.startPrice ?? 0,
        endedAt: endedAt.toISOString(),
        endedBy,
      },
      item: {
        id: item.id,
        title: item.title ?? '',
        description: item.description ?? '',
        condition: item.condition ?? '',
        brand: item.brand,
        category: item.categoryId === null ? null : { id: item.categoryId, path },
        attributes: described.map(({ key, label, value }) => ({ key, label, value })),
        attributeValues: { ...item.attributes },
        packageSize: item.packageSize,
        weightGrams: item.weightGrams,
        dimensionsCm:
          item.lengthCm === null || item.widthCm === null || item.heightCm === null
            ? null
            : { length: item.lengthCm, width: item.widthCm, height: item.heightCm },
        allowedCarriers: [...item.allowedCarriers],
        photos: photos.map((photo) => ({ id: photo.id, urls: photo.urls ?? {} })),
      },
    };
  }
}

/** Aktualny czas bazy (nie początek transakcji, która mogła czekać na blokadę). */
async function clock(tx: Transaction): Promise<Date> {
  const result = await tx.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`);
  const value = result.rows[0]?.now;
  return value instanceof Date ? value : new Date(value ?? Date.now());
}
