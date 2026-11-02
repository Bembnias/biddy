// Zwroty płatności (PROJECT.md §6.8, §7.4, §7.8): spóźniona płatność anulowanego zamówienia
// i płatność zdublowana (F-25), nienadanie, zaginięcie i nieodebrana paczka (F-26); spory
// i chargebacki dojdą w F-28. Przebieg:
// 1. `request` w transakcji wywołującego: wiersz PENDING (idempotentny po kluczu) i event
//    RefundRequested w outboxie, więc zlecenie zwrotu jest atomowe ze zmianą stanu u wywołującego,
// 2. konsument eventu woła operatora z kluczem `refund:{id}` (ponowienie nie robi drugiego zwrotu)
//    i zapisuje ID zwrotu u operatora,
// 3. webhook REFUND_SUCCEEDED: stan SUCCEEDED, księgowanie ORDER_REFUNDED (przy nieodebranej
//    paczce NOT_PICKED_UP_REFUNDED: dostawa zostaje w Biddy) i event RefundSucceeded;
//    REFUND_FAILED: stan FAILED i błąd w logach (ręczna obsługa przez support, panel w F-34).
// Ledger księgujemy dopiero po potwierdzeniu operatora: nieudany zwrot nie zmienia sald.
import { type Money, money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne, sum } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { LedgerService } from '../../ledger/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import {
  payments,
  type RefundOrderAmounts,
  type RefundRow,
  refunds,
} from '../db/payments.schema.js';
import type { RefundReason } from '../domain/payment-values.js';
import { RefundRequested, RefundSucceeded } from '../payments.events.js';
import { GatewayRegistry } from './gateway-registry.js';

export type RequestRefundCommand = {
  readonly paymentId: string;
  /** Klucz wywołującego, np. `refund:payment:{id}:late`. */
  readonly idempotencyKey: string;
} & (
  | {
      readonly reason: Exclude<RefundReason, 'NOT_PICKED_UP'>;
      /** Kwota zwrotu; domyślnie cała płatność (bez wcześniejszych zwrotów). */
      readonly amount?: Money;
    }
  | {
      /** Nieodebrana paczka: zwrot ceny i POK, dostawa zostaje w Biddy (§7.4). */
      readonly reason: 'NOT_PICKED_UP';
      readonly orderAmounts: RefundOrderAmounts;
    }
);

@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly ledger: LedgerService,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Zleca zwrot udanej płatności w transakcji wywołującego. Ponowienie z tym samym kluczem zwraca
   * istniejący zwrot. Zwroty jednej płatności nie przekraczają jej kwoty (blokada płatności).
   *
   * @throws {DomainError} CONFLICT (płatność nieudana albo zwrot ponad kwotę płatności)
   */
  async request(tx: Transaction, command: RequestRefundCommand): Promise<RefundRow> {
    const [existing] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.idempotencyKey, command.idempotencyKey));
    if (existing !== undefined) {
      return existing;
    }
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, command.paymentId))
      .for('update');
    if (payment?.status !== 'SUCCEEDED') {
      throw new DomainError({ code: 'CONFLICT', detail: 'Zwrot dotyczy tylko udanej płatności.' });
    }
    const [refunded] = await tx
      .select({ total: sum(refunds.amount).mapWith(Number) })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), ne(refunds.status, 'FAILED')));
    const available = payment.amount - (refunded?.total ?? 0);
    const requested =
      command.reason === 'NOT_PICKED_UP'
        ? money(
            command.orderAmounts.itemsTotal.amount + command.orderAmounts.pokFee.amount,
            command.orderAmounts.itemsTotal.currency,
          )
        : command.amount;
    const amount = requested?.amount ?? available;
    if (
      amount <= 0 ||
      amount > available ||
      (requested !== undefined && requested.currency !== payment.currency)
    ) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Kwota zwrotu przekracza kwotę płatności do zwrotu.',
      });
    }
    const [created] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.id,
        orderId: payment.orderId,
        provider: payment.provider,
        currency: payment.currency,
        amount,
        reason: command.reason,
        idempotencyKey: command.idempotencyKey,
        orderAmounts: command.reason === 'NOT_PICKED_UP' ? command.orderAmounts : null,
      })
      .returning();
    if (created === undefined) {
      throw new Error(`Nie zapisano zwrotu płatności ${payment.id}`);
    }
    await this.outbox.add(
      tx,
      RefundRequested.create({
        aggregateId: created.id,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: { amount, currency: payment.currency },
          reason: command.reason,
        },
      }),
    );
    this.logger.log(
      { refundId: created.id, paymentId: payment.id, reason: command.reason, amount },
      'Zlecono zwrot płatności',
    );
    return created;
  }

  /** Zwroty zamówienia (najstarsze najpierw): widok zamówienia (F-26). */
  async forOrder(orderId: string): Promise<RefundRow[]> {
    return this.db
      .select()
      .from(refunds)
      .where(eq(refunds.orderId, orderId))
      .orderBy(refunds.createdAt);
  }

  /** Zwroty płatności (najstarsze najpierw). */
  async forPayment(paymentId: string): Promise<RefundRow[]> {
    return this.db
      .select()
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId))
      .orderBy(refunds.createdAt);
  }

  /**
   * Wywołanie operatora dla zleconego zwrotu. Klucz `refund:{id}` sprawia, że ponowienie po
   * błędzie sieci zwraca ten sam zwrot u operatora.
   */
  @OnDomainEvent(RefundRequested, { consumer: 'payments.execute-refund' })
  async onRefundRequested(
    event: DomainEventOf<typeof RefundRequested>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(eq(refunds.id, event.aggregateId))
      .for('update');
    if (refund === undefined || refund.providerRefundId !== null || refund.status !== 'PENDING') {
      return;
    }
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId));
    if (payment?.providerPaymentId === null || payment === undefined) {
      throw new Error(`Zwrot ${refund.id}: płatność bez ID operatora`);
    }
    const result = await this.registry.get(refund.provider).refund({
      providerPaymentId: payment.providerPaymentId,
      amount: { amount: refund.amount, currency: refund.currency },
      idempotencyKey: `refund:${refund.id}`,
    });
    await tx
      .update(refunds)
      .set({ providerRefundId: result.providerRefundId, updatedAt: new Date() })
      .where(eq(refunds.id, refund.id));
  }

  /**
   * Webhook REFUND_SUCCEEDED albo REFUND_FAILED w transakcji procesora zdarzeń. Zwraca false, gdy
   * zwrot jest nieznany (np. webhook przed zapisem ID operatora): procesor zgłasza błąd
   * i operator ponawia.
   */
  async applyProviderResult(
    tx: Transaction,
    provider: string,
    providerRefundId: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    confirmed: Money,
  ): Promise<boolean> {
    const [refund] = await tx
      .select()
      .from(refunds)
      .where(and(eq(refunds.provider, provider), eq(refunds.providerRefundId, providerRefundId)))
      .for('update');
    if (refund === undefined) {
      return false;
    }
    if (refund.status !== 'PENDING') {
      return true;
    }
    const now = new Date();
    if (outcome === 'FAILED') {
      await tx
        .update(refunds)
        .set({ status: 'FAILED', failedAt: now, updatedAt: now })
        .where(eq(refunds.id, refund.id));
      this.logger.error(
        { refundId: refund.id, paymentId: refund.paymentId, reason: refund.reason },
        'Operator odrzucił zwrot płatności: wymaga obsługi przez support',
      );
      return true;
    }
    if (confirmed.amount !== refund.amount || confirmed.currency !== refund.currency) {
      throw new Error(
        `Zwrot ${refund.id}: operator potwierdził ${confirmed.amount} ${confirmed.currency}, a oczekiwano ${refund.amount} ${refund.currency}`,
      );
    }
    const [payment] = await tx.select().from(payments).where(eq(payments.id, refund.paymentId));
    if (payment === undefined) {
      throw new Error(`Zwrot ${refund.id}: brak płatności`);
    }
    await tx
      .update(refunds)
      .set({ status: 'SUCCEEDED', succeededAt: now, updatedAt: now })
      .where(eq(refunds.id, refund.id));
    const amount = { amount: refund.amount, currency: refund.currency };
    const idempotencyKey = `refund:${refund.id}:succeeded`;
    if (refund.reason === 'NOT_PICKED_UP') {
      if (refund.orderAmounts === null) {
        throw new Error(`Zwrot ${refund.id}: brak kwot zamówienia dla nieodebranej paczki`);
      }
      await this.ledger.post(tx, {
        type: 'NOT_PICKED_UP_REFUNDED',
        idempotencyKey,
        orderId: refund.orderId,
        provider: refund.provider,
        amounts: refund.orderAmounts,
      });
    } else {
      await this.ledger.post(tx, {
        type: 'ORDER_REFUNDED',
        idempotencyKey,
        orderId: refund.orderId,
        provider: refund.provider,
        amount,
        reason: refund.reason,
      });
    }
    await this.outbox.add(
      tx,
      RefundSucceeded.create({
        aggregateId: refund.id,
        payload: {
          paymentId: refund.paymentId,
          orderId: refund.orderId,
          buyerId: payment.buyerId,
          amount,
          reason: refund.reason,
        },
      }),
    );
    return true;
  }
}
