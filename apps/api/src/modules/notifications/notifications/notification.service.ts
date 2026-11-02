// Powiadomienia (F-20): zapis w transakcji zdarzenia (deduplikacja po `dedupe_key`), centrum
// powiadomień (lista, nieprzeczytane) i dostarczenie po zatwierdzeniu (event NotificationCreated):
// zdarzenie na żywo do pokoju użytkownika i e-mail według preferencji, z limitem e-maili
// o przebiciu (raz na 15 min na aukcję).
import { notificationEmail } from '@biddy/emails';
import { NOTIFICATION_EMAIL, type NotificationType, OUTBID_EMAIL_INTERVAL_MS } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { MailQueue } from '../../../infra/mail/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { RealtimePublisher } from '../../../infra/realtime/index.js';
import { FollowService } from '../../identity/index.js';
import { type Notification, notifications } from '../db/notifications.schema.js';
import { NotificationCreated } from '../notifications.events.js';
import { notificationContent, type NotificationPayload } from './notification-content.js';
import { PreferenceService } from './preference.service.js';
import { createUnsubscribeToken } from './unsubscribe-token.js';

export interface NotifyInput {
  readonly userId: string;
  readonly type: NotificationType;
  /** Klucz deduplikacji (unikalny z użytkownikiem), np. `OUTBID:{eventId}`. */
  readonly dedupeKey: string;
  readonly auctionId: string | null;
  readonly payload: NotificationPayload;
}

export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly path: string;
  readonly read: boolean;
  readonly createdAt: Date;
}

/** Strona listy powiadomień. */
export const NOTIFICATIONS_PAGE = 30;

/** Ścieżki stron web w e-mailach. */
const SETTINGS_PATH = '/konto/powiadomienia';
const UNSUBSCRIBE_PAGE_PATH = '/wypisz';
const UNSUBSCRIBE_ONE_CLICK_PATH = '/api/wypisz';

function toView(row: Notification): NotificationView {
  const content = notificationContent(row.type, row.payload as unknown as NotificationPayload);
  return {
    id: row.id,
    type: row.type,
    title: content.title,
    body: content.lines.join(' '),
    path: content.path,
    read: row.readAt !== null,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PreferenceService) private readonly preferences: PreferenceService,
    @Inject(FollowService) private readonly users: FollowService,
    @Inject(MailQueue) private readonly mail: MailQueue,
    @Inject(RealtimePublisher) private readonly realtime: RealtimePublisher,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Zapis powiadomień w transakcji wywołującego (np. konsumenta eventu). Powiadomienie z tym
   * samym `dedupeKey` u tego użytkownika jest pomijane, więc ponowne dostarczenie eventu nie
   * tworzy duplikatu. Dostarczenie: event NotificationCreated po zatwierdzeniu.
   */
  async notify(tx: Transaction, inputs: readonly NotifyInput[]): Promise<number> {
    if (inputs.length === 0) {
      return 0;
    }
    const created = await tx
      .insert(notifications)
      .values(
        inputs.map((input) => ({
          userId: input.userId,
          type: input.type,
          dedupeKey: input.dedupeKey,
          auctionId: input.auctionId,
          payload: input.payload as unknown as Record<string, unknown>,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id, userId: notifications.userId, type: notifications.type });
    if (created.length > 0) {
      await this.outbox.add(
        tx,
        ...created.map((row) =>
          NotificationCreated.create({
            aggregateId: row.id,
            payload: { userId: row.userId, type: row.type },
          }),
        ),
      );
    }
    return created.length;
  }

  /** Powiadomienia od najnowszych; `before` to ID ostatniego z poprzedniej strony. */
  async list(
    userId: string,
    before?: string,
  ): Promise<{ items: NotificationView[]; nextBefore: string | null }> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          before === undefined ? undefined : lt(notifications.id, before),
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(NOTIFICATIONS_PAGE + 1);
    const page = rows.slice(0, NOTIFICATIONS_PAGE);
    return {
      items: page.map(toView),
      nextBefore: rows.length > NOTIFICATIONS_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async unreadCount(userId: string, tx?: Transaction): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.unread ?? 0;
  }

  /** Oznacza wskazane (albo wszystkie) jako przeczytane; zwraca liczbę nieprzeczytanych. */
  async markRead(userId: string, ids: readonly string[] | 'all'): Promise<number> {
    if (ids === 'all' || ids.length > 0) {
      await this.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            ids === 'all' ? undefined : inArray(notifications.id, [...ids]),
          ),
        );
    }
    return this.unreadCount(userId);
  }

  /** Dostarczenie: na żywo (licznik w dzwonku) i e-mail według preferencji i limitu. */
  @OnDomainEvent(NotificationCreated, { consumer: 'notifications.deliver' })
  async deliver(
    event: DomainEventOf<typeof NotificationCreated>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const [row] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.id, event.aggregateId));
    if (row === undefined) {
      return;
    }
    const view = toView(row);
    this.realtime.publish({
      userId: row.userId,
      event: 'notification.new',
      payload: {
        id: view.id,
        type: view.type,
        title: view.title,
        body: view.body,
        url: view.path,
        createdAt: view.createdAt.toISOString(),
        unreadCount: await this.unreadCount(row.userId, tx),
      },
    });
    if (row.emailedAt === null) {
      await this.email(tx, row);
    }
  }

  private async email(tx: Transaction, row: Notification): Promise<void> {
    if (!(await this.preferences.emailEnabled(row.userId, row.type, tx))) {
      return;
    }
    const [contact] = await this.users.contacts([row.userId], tx);
    if (contact === undefined || contact.email === null) {
      return;
    }
    if (row.type === 'OUTBID' && row.auctionId !== null && (await this.recentlyEmailed(tx, row))) {
      return;
    }
    const web = this.config.web.url;
    const content = notificationContent(row.type, row.payload as unknown as NotificationPayload);
    const token = NOTIFICATION_EMAIL[row.type].configurable
      ? createUnsubscribeToken(this.config.auth.secret, row.userId, row.type)
      : undefined;
    const rendered = await notificationEmail({
      recipientName: contact.name,
      title: content.title,
      lines: content.lines,
      action: { label: content.actionLabel, url: `${web}${content.path}` },
      settingsUrl: `${web}${SETTINGS_PATH}`,
      unsubscribeUrl:
        token === undefined ? undefined : `${web}${UNSUBSCRIBE_PAGE_PATH}?token=${token}`,
    });
    await this.mail.enqueue(
      {
        to: contact.email,
        ...rendered,
        // RFC 8058: przycisk „Wypisz” w kliencie poczty wysyła POST na ten adres.
        headers:
          token === undefined
            ? undefined
            : {
                'List-Unsubscribe': `<${web}${UNSUBSCRIBE_ONE_CLICK_PATH}?token=${token}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
      },
      { jobId: `notification-${row.id}` },
    );
    await tx
      .update(notifications)
      .set({ emailedAt: new Date() })
      .where(eq(notifications.id, row.id));
  }

  /**
   * E-mail o przebiciu w tej aukcji w ostatnich 15 min. Blokada doradcza na (użytkownik, aukcja)
   * do końca transakcji: dwa równoległe przebicia nie wyślą dwóch e-maili.
   */
  private async recentlyEmailed(tx: Transaction, row: Notification): Promise<boolean> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`outbid-email:${row.userId}:${row.auctionId ?? ''}`}, 0))`,
    );
    const [recent] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, row.userId),
          eq(notifications.type, 'OUTBID'),
          eq(notifications.auctionId, row.auctionId ?? ''),
          ne(notifications.id, row.id),
          gt(notifications.emailedAt, new Date(Date.now() - OUTBID_EMAIL_INTERVAL_MS)),
        ),
      )
      .limit(1);
    return recent !== undefined;
  }
}
