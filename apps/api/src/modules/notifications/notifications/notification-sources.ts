// Źródła powiadomień (F-20): eventy modułów auctions i orders (także OrderPaid, F-24) oraz job
// „kończy się za godzinę”.
// Konsument zapisuje powiadomienia w transakcji obsługi eventu z kluczem deduplikacji, więc
// ponowne dostarczenie eventu niczego nie powtórzy.
import { money as moneyOf } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { deadlineJobId, JobHandler, JobQueues, type JobRun } from '../../../infra/queues/index.js';
import {
  AuctionCancelled,
  AuctionDirectory,
  AuctionEnded,
  type AuctionNotice,
  AuctionPublished,
  UserOutbid,
} from '../../auctions/index.js';
import { FollowService, ProfileService } from '../../identity/index.js';
import { OrderCreated, OrderPaid } from '../../orders/index.js';
import type { AuctionRef } from './notification-content.js';
import { NotificationService } from './notification.service.js';

/** Powiadomienie „kończy się” na tyle przed końcem aukcji. */
export const ENDING_SOON_BEFORE_MS = 60 * 60 * 1000;
export const ENDING_SOON_JOB = 'notifications.ending-soon';
/** Job, który ruszył wcześniej niż godzinę przed końcem (np. po zmianie końca), czeka dalej. */
const ENDING_SOON_TOLERANCE_MS = 60 * 1000;

function ref(notice: AuctionNotice): AuctionRef {
  return { id: notice.id, publicId: notice.publicId, slug: notice.slug, title: notice.title };
}

@Injectable()
export class NotificationSources {
  private readonly logger = new Logger(NotificationSources.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AuctionDirectory) private readonly auctions: AuctionDirectory,
    @Inject(FollowService) private readonly follows: FollowService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    private readonly jobs: JobQueues,
  ) {}

  @OnDomainEvent(UserOutbid, { consumer: 'notifications.outbid' })
  async onOutbid(
    event: DomainEventOf<typeof UserOutbid>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const notice = await this.auctions.notice(event.aggregateId, tx);
    if (notice === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: event.payload.userId,
        type: 'OUTBID',
        dedupeKey: `OUTBID:${event.id}`,
        auctionId: notice.id,
        payload: {
          auction: ref(notice),
          price: event.payload.currentPrice,
          endsAt: event.payload.endsAt,
        },
      },
    ]);
  }

  /** Planuje „kończy się za godzinę” (job z terminem; ten sam termin to ten sam job). */
  @OnDomainEvent(AuctionPublished, { consumer: 'notifications.schedule-ending-soon' })
  async onPublished(event: DomainEventOf<typeof AuctionPublished>): Promise<void> {
    await this.scheduleEndingSoon(event.aggregateId, new Date(event.payload.endsAt));
  }

  @OnDomainEvent(AuctionPublished, { consumer: 'notifications.followed-seller' })
  async onPublishedForFollowers(
    event: DomainEventOf<typeof AuctionPublished>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const followers = await this.follows.followerIds(event.payload.sellerId, tx);
    const notice =
      followers.length === 0 ? undefined : await this.auctions.notice(event.aggregateId, tx);
    if (notice === undefined) {
      return;
    }
    const names = await this.profiles.displayNames([event.payload.sellerId], tx);
    await this.notifications.notify(
      tx,
      followers.map((userId) => ({
        userId,
        type: 'FOLLOWED_SELLER_NEW_AUCTION' as const,
        dedupeKey: `NEW_AUCTION:${notice.id}`,
        auctionId: notice.id,
        payload: {
          auction: ref(notice),
          price: event.payload.startPrice,
          endsAt: event.payload.endsAt,
          sellerName: names.get(event.payload.sellerId) ?? '',
        },
      })),
    );
  }

  /**
   * Wygrana (kupujący) i sprzedaż (sprzedający): zamówienie powstaje przy zakończeniu. Zamówienie
   * z drugiej szansy (F-26) ich nie wysyła: licytujący przyjmuje ofertę na stronie, a sprzedający
   * dostaje SECOND_CHANCE_ANSWERED.
   */
  @OnDomainEvent(OrderCreated, { consumer: 'notifications.order-created' })
  async onOrderCreated(
    event: DomainEventOf<typeof OrderCreated>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    if (event.payload.secondChanceOfferId !== undefined) {
      return;
    }
    const notice = await this.auctions.notice(event.payload.auctionId, tx);
    if (notice === undefined) {
      return;
    }
    const common = {
      auction: ref(notice),
      orderPublicId: event.payload.publicId,
      itemsTotal: event.payload.itemsTotal,
      total: event.payload.total,
      paymentDueAt: event.payload.paymentDueAt,
    };
    await this.notifications.notify(tx, [
      {
        userId: event.payload.buyerId,
        type: 'WON',
        dedupeKey: `WON:${notice.id}`,
        auctionId: notice.id,
        payload: common,
      },
      {
        userId: event.payload.sellerId,
        type: 'SOLD',
        dedupeKey: `SOLD:${notice.id}`,
        auctionId: notice.id,
        payload: common,
      },
    ]);
  }

  /** Opłacone zamówienie (F-24): sprzedający ma nadać paczkę (event publikuje F-25). */
  @OnDomainEvent(OrderPaid, { consumer: 'notifications.order-paid' })
  async onOrderPaid(
    event: DomainEventOf<typeof OrderPaid>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const notice = await this.auctions.notice(event.payload.auctionId, tx);
    if (notice === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: event.payload.sellerId,
        type: 'ORDER_PAID',
        dedupeKey: `ORDER_PAID:${event.aggregateId}`,
        auctionId: notice.id,
        payload: {
          auction: ref(notice),
          orderPublicId: event.payload.publicId,
          total: event.payload.total,
          shipBy: event.payload.shipBy,
        },
      },
    ]);
  }

  @OnDomainEvent(AuctionEnded, { consumer: 'notifications.auction-unsold' })
  async onEnded(
    event: DomainEventOf<typeof AuctionEnded>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    if (event.payload.outcome !== 'UNSOLD') {
      return;
    }
    const notice = await this.auctions.notice(event.aggregateId, tx);
    if (notice === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: event.payload.sellerId,
        type: 'UNSOLD',
        dedupeKey: `UNSOLD:${notice.id}`,
        auctionId: notice.id,
        payload: {
          auction: ref(notice),
          reason: notice.bidCount > 0 ? 'RESERVE_NOT_MET' : 'NO_BIDS',
        },
      },
    ]);
  }

  /** Anulowanie (§6.6): licytujący i obserwujący. */
  @OnDomainEvent(AuctionCancelled, { consumer: 'notifications.auction-cancelled' })
  async onCancelled(
    event: DomainEventOf<typeof AuctionCancelled>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    if (event.payload.previousStatus !== 'ACTIVE') {
      return;
    }
    const [notice, audience] = await Promise.all([
      this.auctions.notice(event.aggregateId, tx),
      this.auctions.audience(event.aggregateId, tx),
    ]);
    if (notice === undefined) {
      return;
    }
    await this.notifications.notify(
      tx,
      audience.map((userId) => ({
        userId,
        type: 'AUCTION_CANCELLED' as const,
        dedupeKey: `CANCELLED:${notice.id}`,
        auctionId: notice.id,
        payload: { auction: ref(notice), cancelledBy: event.payload.cancelledBy },
      })),
    );
  }

  async scheduleEndingSoon(auctionId: string, endsAt: Date): Promise<void> {
    const runAt = new Date(endsAt.getTime() - ENDING_SOON_BEFORE_MS);
    if (runAt.getTime() <= Date.now()) {
      return;
    }
    await this.jobs.add(
      'notifications',
      ENDING_SOON_JOB,
      { auctionId },
      { jobId: deadlineJobId('ending-soon', auctionId, runAt), runAt },
    );
  }

  /** „Kończy się za godzinę” dla obserwujących i licytujących aktywnej aukcji. */
  @JobHandler('notifications', ENDING_SOON_JOB)
  async endingSoon(job: JobRun<{ auctionId: string }>): Promise<number> {
    return this.db.transaction(async (tx) => this.notifyEndingSoon(tx, job.data.auctionId));
  }

  private async notifyEndingSoon(tx: Transaction, auctionId: string): Promise<number> {
    const notice = await this.auctions.notice(auctionId, tx);
    if (notice?.status !== 'ACTIVE' || notice.endsAt === null) {
      return 0;
    }
    const remaining = notice.endsAt.getTime() - Date.now();
    if (remaining <= 0) {
      return 0;
    }
    if (remaining > ENDING_SOON_BEFORE_MS + ENDING_SOON_TOLERANCE_MS) {
      // Koniec przesunął się na później: nowy job na nowy termin.
      await this.scheduleEndingSoon(auctionId, notice.endsAt);
      return 0;
    }
    const audience = await this.auctions.audience(auctionId, tx);
    const created = await this.notifications.notify(
      tx,
      audience.map((userId) => ({
        userId,
        type: 'ENDING_SOON' as const,
        dedupeKey: `ENDING_SOON:${notice.id}`,
        auctionId: notice.id,
        payload: {
          auction: ref(notice),
          price: moneyOf(notice.price, notice.currency),
          endsAt: notice.endsAt?.toISOString(),
        },
      })),
    );
    this.logger.log({ auctionId, created }, 'Powiadomienia „kończy się za godzinę”');
    return created;
  }
}
