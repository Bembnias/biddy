// Powiadomienia o wypłatach (F-27, PROJECT.md §7.6, §16.1): wypłata wysłana, wypłata nieudana
// (środki wróciły na saldo) i zapis rachunku do wypłat. Zmiana rachunku to sygnał przejęcia
// konta, więc e-mail wychodzi zawsze (NOTIFICATION_EMAIL), z maską rachunku i końcem blokady.
import { Inject, Injectable } from '@nestjs/common';

import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import { PayoutAccountChanged, PayoutFailed, PayoutPaid } from '../../payments/index.js';
import { NotificationService } from './notification.service.js';

@Injectable()
export class PayoutNotificationSources {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @OnDomainEvent(PayoutPaid, { consumer: 'notifications.payout-paid' })
  async onPayoutPaid(
    event: DomainEventOf<typeof PayoutPaid>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notifications.notify(tx, [
      {
        userId: event.payload.sellerId,
        type: 'PAYOUT_PAID',
        dedupeKey: `PAYOUT_PAID:${event.aggregateId}`,
        auctionId: null,
        payload: {
          payout: {
            amount: event.payload.amount,
            bankAccountMasked: event.payload.bankAccountMasked,
            trigger: event.payload.trigger,
          },
        },
      },
    ]);
  }

  @OnDomainEvent(PayoutFailed, { consumer: 'notifications.payout-failed' })
  async onPayoutFailed(
    event: DomainEventOf<typeof PayoutFailed>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notifications.notify(tx, [
      {
        userId: event.payload.sellerId,
        type: 'PAYOUT_FAILED',
        dedupeKey: `PAYOUT_FAILED:${event.aggregateId}`,
        auctionId: null,
        payload: {
          payout: {
            amount: event.payload.amount,
            trigger: event.payload.trigger,
            failureReason: event.payload.reason,
          },
        },
      },
    ]);
  }

  @OnDomainEvent(PayoutAccountChanged, { consumer: 'notifications.payout-account-changed' })
  async onPayoutAccountChanged(
    event: DomainEventOf<typeof PayoutAccountChanged>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notifications.notify(tx, [
      {
        userId: event.payload.userId,
        type: 'PAYOUT_ACCOUNT_CHANGED',
        dedupeKey: `PAYOUT_ACCOUNT_CHANGED:${event.id}`,
        auctionId: null,
        payload: {
          payout: {
            bankAccountMasked: event.payload.bankAccountMasked,
            first: event.payload.first,
            blockedUntil: event.payload.payoutsBlockedUntil,
          },
        },
      },
    ]);
  }
}
