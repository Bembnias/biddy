// Powiadomienia o sporach (F-28, PROJECT.md §7.5): zgłoszenie (sprzedający), propozycja zwrotu
// części ceny (kupujący), eskalacja (obie strony), zwrot z odesłaniem (kupujący; sprzedający przy
// decyzji Biddy), odbiór zwrotu (sprzedający) i rozstrzygnięcie z uzasadnieniem (obie strony).
// Wszystkie są transakcyjne (terminy i pieniądze), więc e-mail wychodzi zawsze.
import { Inject, Injectable } from '@nestjs/common';

import type { Transaction } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
} from '../../../infra/outbox/index.js';
import {
  DisputeEscalated,
  DisputeOpened,
  DisputePartialOffered,
  DisputeResolved,
  DisputeReturnDelivered,
  DisputeReturnRequested,
} from '../../disputes/index.js';
import type { DisputeRef } from './notification-content.js';
import { NotificationService } from './notification.service.js';

type DisputeType =
  | 'DISPUTE_OPENED'
  | 'DISPUTE_PARTIAL_OFFERED'
  | 'DISPUTE_ESCALATED'
  | 'DISPUTE_RETURN_REQUESTED'
  | 'DISPUTE_RETURN_DELIVERED'
  | 'DISPUTE_RESOLVED';

interface DisputeParties {
  readonly orderPublicId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly title: string;
}

@Injectable()
export class DisputeNotificationSources {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  @OnDomainEvent(DisputeOpened, { consumer: 'notifications.dispute-opened' })
  async onOpened(
    event: DomainEventOf<typeof DisputeOpened>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notify(tx, event.id, 'DISPUTE_OPENED', event.payload, ['SELLER'], {
      dueAt: event.payload.responseDueAt,
    });
  }

  @OnDomainEvent(DisputePartialOffered, { consumer: 'notifications.dispute-partial-offered' })
  async onPartialOffered(
    event: DomainEventOf<typeof DisputePartialOffered>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notify(tx, event.id, 'DISPUTE_PARTIAL_OFFERED', event.payload, ['BUYER'], {
      dueAt: event.payload.responseDueAt,
      amount: event.payload.amount,
    });
  }

  @OnDomainEvent(DisputeEscalated, { consumer: 'notifications.dispute-escalated' })
  async onEscalated(
    event: DomainEventOf<typeof DisputeEscalated>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notify(tx, event.id, 'DISPUTE_ESCALATED', event.payload, ['BUYER', 'SELLER'], {
      dueAt: event.payload.decisionDueAt,
      cause: event.payload.cause,
    });
  }

  @OnDomainEvent(DisputeReturnRequested, { consumer: 'notifications.dispute-return-requested' })
  async onReturnRequested(
    event: DomainEventOf<typeof DisputeReturnRequested>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    // Sprzedający, który sam zgodził się na zwrot, wie o nim; przy decyzji Biddy dostaje powiadomienie.
    const roles: readonly ('BUYER' | 'SELLER')[] =
      event.payload.decidedBy === 'STAFF' ? ['BUYER', 'SELLER'] : ['BUYER'];
    await this.notify(tx, event.id, 'DISPUTE_RETURN_REQUESTED', event.payload, roles, {
      dueAt: event.payload.returnShipBy,
      decidedBy: event.payload.decidedBy,
    });
  }

  @OnDomainEvent(DisputeReturnDelivered, { consumer: 'notifications.dispute-return-delivered' })
  async onReturnDelivered(
    event: DomainEventOf<typeof DisputeReturnDelivered>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notify(tx, event.id, 'DISPUTE_RETURN_DELIVERED', event.payload, ['SELLER'], {
      dueAt: event.payload.inspectionEndsAt,
    });
  }

  @OnDomainEvent(DisputeResolved, { consumer: 'notifications.dispute-resolved' })
  async onResolved(
    event: DomainEventOf<typeof DisputeResolved>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    await this.notify(tx, event.id, 'DISPUTE_RESOLVED', event.payload, ['BUYER', 'SELLER'], {
      outcome: event.payload.outcome,
      fault: event.payload.fault,
      amount: event.payload.refund,
      sellerCosts: event.payload.sellerCosts,
      decidedBy: event.payload.decidedBy,
      statement: event.payload.statement,
    });
  }

  private async notify(
    tx: Transaction,
    eventId: string,
    type: DisputeType,
    parties: DisputeParties,
    roles: readonly ('BUYER' | 'SELLER')[],
    details: Omit<DisputeRef, 'orderPublicId' | 'title' | 'recipientRole'>,
  ): Promise<void> {
    await this.notifications.notify(
      tx,
      roles.map((role) => ({
        userId: role === 'BUYER' ? parties.buyerId : parties.sellerId,
        type,
        dedupeKey: `${type}:${eventId}:${role}`,
        auctionId: null,
        payload: {
          dispute: {
            orderPublicId: parties.orderPublicId,
            title: parties.title,
            recipientRole: role,
            ...details,
          },
        },
      })),
    );
  }
}
