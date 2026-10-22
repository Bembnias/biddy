// Przejścia stanu płatności (F-23, PROJECT.md §7.8) wspólne dla odpowiedzi operatora
// (createPayment), webhooka i pollingu zapasowego. Wywołujący blokuje wiersz (SELECT … FOR
// UPDATE) w swojej transakcji, a przejście w tej samej transakcji zapisuje stan, księgowanie
// w ledgerze i event w outboxie. Dzięki blokadzie i sprawdzeniu stanu webhook i polling nie
// zaksięgują tej samej wpłaty dwa razy; księgowanie ma też własny klucz idempotencji.
import type { Money } from '@biddy/shared';
import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { Transaction } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { LedgerService } from '../../ledger/index.js';
import { type PaymentRow, payments } from '../db/payments.schema.js';
import type { PaymentFailureReason } from '../domain/payment-values.js';
import { PaymentFailed, PaymentSucceeded } from '../payments.events.js';

/** Kwota potwierdzona przez operatora różni się od kwoty płatności: niczego nie księgujemy. */
export class PaymentAmountMismatchError extends Error {
  constructor(paymentId: string, expected: Money, actual: Money) {
    super(
      `Płatność ${paymentId}: operator potwierdził ${actual.amount} ${actual.currency}, a oczekiwano ${expected.amount} ${expected.currency}`,
    );
    this.name = 'PaymentAmountMismatchError';
  }
}

export function paymentAmount(row: PaymentRow): Money {
  return { amount: row.amount, currency: row.currency };
}

export interface SuccessDetails {
  /** Kwota potwierdzona przez operatora (musi równać się kwocie płatności). */
  readonly amount: Money;
  /** Opłata operatora za płatność (`payment_fees_expense`), gdy ją podaje. */
  readonly providerFee?: Money;
}

@Injectable()
export class PaymentTransitions {
  private readonly logger = new Logger(PaymentTransitions.name);

  constructor(
    private readonly ledger: LedgerService,
    private readonly outbox: Outbox,
  ) {}

  /**
   * PENDING albo FAILED → SUCCEEDED (pieniądze wpłynęły, także po naszym PROVIDER_ERROR):
   * księgowanie PAYMENT_RECEIVED (i PAYMENT_FEE_CHARGED), event PaymentSucceeded. Płatność już
   * udana: no-op.
   *
   * @param payment wiersz zablokowany w `tx`
   * @throws {PaymentAmountMismatchError}
   */
  async succeed(
    tx: Transaction,
    payment: PaymentRow,
    details: SuccessDetails,
  ): Promise<PaymentRow> {
    if (payment.status === 'SUCCEEDED') {
      return payment;
    }
    if (details.amount.amount !== payment.amount || details.amount.currency !== payment.currency) {
      throw new PaymentAmountMismatchError(payment.id, paymentAmount(payment), details.amount);
    }
    const now = new Date();
    const [updated] = await tx
      .update(payments)
      .set({ status: 'SUCCEEDED', failureReason: null, succeededAt: now, updatedAt: now })
      .where(eq(payments.id, payment.id))
      .returning();
    if (updated === undefined) {
      throw new Error(`Nie zaktualizowano płatności ${payment.id}`);
    }
    await this.ledger.post(tx, {
      type: 'PAYMENT_RECEIVED',
      idempotencyKey: `payment:${payment.id}:received`,
      orderId: payment.orderId,
      sellerId: payment.sellerId,
      provider: payment.provider,
      amount: paymentAmount(payment),
      sellerAmount: { amount: payment.sellerAmount, currency: payment.currency },
    });
    if (details.providerFee !== undefined && details.providerFee.amount > 0) {
      await this.ledger.post(tx, {
        type: 'PAYMENT_FEE_CHARGED',
        idempotencyKey: `payment:${payment.id}:fee`,
        provider: payment.provider,
        amount: details.providerFee,
        orderId: payment.orderId,
      });
    }
    await this.outbox.add(
      tx,
      PaymentSucceeded.create({
        aggregateId: payment.id,
        payload: {
          orderId: payment.orderId,
          buyerId: payment.buyerId,
          sellerId: payment.sellerId,
          provider: payment.provider,
          method: payment.method,
          amount: paymentAmount(payment),
        },
      }),
    );
    if (payment.status === 'FAILED') {
      this.logger.warn(
        { paymentId: payment.id, previousReason: payment.failureReason },
        'Płatność oznaczona jako nieudana okazała się udana u operatora',
      );
    }
    return updated;
  }

  /**
   * PENDING → FAILED z powodem, event PaymentFailed. Płatność już rozliczona: no-op (udanej nie
   * cofa późniejsze odrzucenie; zwrot to osobna operacja).
   *
   * @param payment wiersz zablokowany w `tx`
   */
  async fail(
    tx: Transaction,
    payment: PaymentRow,
    reason: PaymentFailureReason,
  ): Promise<PaymentRow> {
    if (payment.status !== 'PENDING') {
      if (payment.status === 'SUCCEEDED') {
        this.logger.warn(
          { paymentId: payment.id, reason },
          'Odrzucenie płatności, która jest już udana: pomijamy',
        );
      }
      return payment;
    }
    const now = new Date();
    const [updated] = await tx
      .update(payments)
      .set({ status: 'FAILED', failureReason: reason, failedAt: now, updatedAt: now })
      .where(eq(payments.id, payment.id))
      .returning();
    if (updated === undefined) {
      throw new Error(`Nie zaktualizowano płatności ${payment.id}`);
    }
    await this.outbox.add(
      tx,
      PaymentFailed.create({
        aggregateId: payment.id,
        payload: {
          orderId: payment.orderId,
          buyerId: payment.buyerId,
          provider: payment.provider,
          reason,
        },
      }),
    );
    return updated;
  }
}
