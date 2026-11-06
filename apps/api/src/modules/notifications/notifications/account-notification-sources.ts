// Powiadomienia o stanie konta (F-61): strike, cofnięcie, blokada, zdjęcie blokady i odrzucone
// odwołanie. Treść to zapisane uzasadnienie decyzji (statement of reasons, DSA), więc e-mail
// wychodzi zawsze (NOTIFICATION_EMAIL). Uwzględnione odwołanie daje powiadomienie o cofnięciu
// albo zdjęciu blokady z uzasadnieniem personelu.
import { Inject, Injectable } from '@nestjs/common';

import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import {
  AccountBlocked,
  AccountBlockLifted,
  AppealResolved,
  StrikeIssued,
  StrikeRevoked,
  StrikeService,
} from '../../identity/index.js';
import { NotificationService } from './notification.service.js';

@Injectable()
export class AccountNotificationSources {
  constructor(
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(StrikeService) private readonly strikes: StrikeService,
  ) {}

  @OnDomainEvent(StrikeIssued, { consumer: 'notifications.strike-issued' })
  async onStrikeIssued(
    event: DomainEventOf<typeof StrikeIssued>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const strike = await this.strikes.strikeById(event.aggregateId, tx);
    if (strike === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: strike.userId,
        type: 'STRIKE_ISSUED',
        dedupeKey: `STRIKE_ISSUED:${strike.id}`,
        auctionId: strike.auctionId,
        payload: { account: { reason: strike.reason, statement: strike.statement } },
      },
    ]);
  }

  @OnDomainEvent(StrikeRevoked, { consumer: 'notifications.strike-revoked' })
  async onStrikeRevoked(
    event: DomainEventOf<typeof StrikeRevoked>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const strike = await this.strikes.strikeById(event.aggregateId, tx);
    if (strike === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: strike.userId,
        type: 'STRIKE_REVOKED',
        dedupeKey: `STRIKE_REVOKED:${strike.id}`,
        auctionId: strike.auctionId,
        payload: {
          account: {
            reason: strike.reason,
            statement: strike.revokeNote ?? 'Strike nie liczy się już do progu blokady.',
          },
        },
      },
    ]);
  }

  @OnDomainEvent(AccountBlocked, { consumer: 'notifications.account-blocked' })
  async onAccountBlocked(
    event: DomainEventOf<typeof AccountBlocked>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const block = await this.strikes.blockById(event.aggregateId, tx);
    if (block === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: block.userId,
        type: 'ACCOUNT_BLOCKED',
        dedupeKey: `ACCOUNT_BLOCKED:${block.id}`,
        auctionId: null,
        payload: { account: { kind: block.kind, statement: block.statement } },
      },
    ]);
  }

  @OnDomainEvent(AccountBlockLifted, { consumer: 'notifications.account-unblocked' })
  async onAccountBlockLifted(
    event: DomainEventOf<typeof AccountBlockLifted>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const block = await this.strikes.blockById(event.aggregateId, tx);
    if (block === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: block.userId,
        type: 'ACCOUNT_UNBLOCKED',
        dedupeKey: `ACCOUNT_UNBLOCKED:${block.id}`,
        auctionId: null,
        payload: {
          account: { kind: block.kind, statement: block.liftNote ?? 'Blokada przestała działać.' },
        },
      },
    ]);
  }

  @OnDomainEvent(AppealResolved, { consumer: 'notifications.appeal-rejected' })
  async onAppealResolved(
    event: DomainEventOf<typeof AppealResolved>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const { decision, subject, subjectId } = event.payload;
    if (decision !== 'REJECTED') {
      return;
    }
    const target =
      subject === 'STRIKE'
        ? await this.strikes.strikeById(subjectId, tx)
        : await this.strikes.blockById(subjectId, tx);
    if (target === undefined) {
      return;
    }
    await this.notifications.notify(tx, [
      {
        userId: target.userId,
        type: 'APPEAL_REJECTED',
        dedupeKey: `APPEAL_REJECTED:${subjectId}`,
        auctionId: null,
        payload: {
          account: {
            subject,
            ...('reason' in target ? { reason: target.reason } : { kind: target.kind }),
            statement: target.appealNote ?? 'Decyzja pozostaje w mocy.',
          },
        },
      },
    ]);
  }
}
