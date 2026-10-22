// Polling zapasowy (F-23, PROJECT.md §7.8 pkt 5): webhooki potrafią zaginąć, więc co minutę
// sprawdzamy u operatora (getPayment) płatności w PENDING starsze niż 15 minut i stosujemy ten
// sam przejściowy stan co webhook. Płatność bez ID operatora (wywołanie operatora nie skończyło
// się odpowiedzią) po 15 minutach jest nieudana (PROVIDER_ERROR).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lt, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type PaymentRow, payments } from '../db/payments.schema.js';
import type { PaymentSnapshot } from '../ports/payment-gateway.port.js';
import { GatewayRegistry } from './gateway-registry.js';
import { PaymentTransitions } from './payment-transitions.js';

/** Płatność czeka tyle na webhook, zanim zapytamy operatora sami. */
export const POLL_PENDING_AFTER_MINUTES = 15;

/** Najwięcej płatności sprawdzanych w jednym wykonaniu (najdawniej sprawdzane najpierw). */
export const POLL_BATCH_SIZE = 100;

export interface PollReport {
  readonly checked: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly stillPending: number;
  readonly errors: number;
}

@Injectable()
export class PendingPaymentsPoller {
  private readonly logger = new Logger(PendingPaymentsPoller.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly transitions: PaymentTransitions,
  ) {}

  @ScheduledJob({ queue: 'payments', name: 'payments.poll-pending', every: 60_000 })
  async run(): Promise<PollReport> {
    return this.pollPending();
  }

  /** Jedno wykonanie pollingu; błąd jednej płatności nie przerywa pozostałych. */
  async pollPending(): Promise<PollReport> {
    const due = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.status, 'PENDING'),
          lt(payments.createdAt, sql`now() - make_interval(mins => ${POLL_PENDING_AFTER_MINUTES})`),
        ),
      )
      .orderBy(sql`${payments.polledAt} asc nulls first`, asc(payments.createdAt))
      .limit(POLL_BATCH_SIZE);
    const report = { checked: 0, succeeded: 0, failed: 0, stillPending: 0, errors: 0 };
    for (const payment of due) {
      report.checked += 1;
      try {
        const status = await this.poll(payment);
        if (status === 'SUCCEEDED') {
          report.succeeded += 1;
        } else if (status === 'FAILED') {
          report.failed += 1;
        } else {
          report.stillPending += 1;
        }
      } catch (error) {
        report.errors += 1;
        this.logger.error(
          { paymentId: payment.id, provider: payment.provider, err: error },
          'Polling płatności nieudany',
        );
      }
    }
    if (report.checked > 0) {
      this.logger.log(report, 'Polling płatności w PENDING');
    }
    return report;
  }

  private async poll(payment: PaymentRow): Promise<PaymentRow['status']> {
    let snapshot: PaymentSnapshot | undefined;
    if (payment.providerPaymentId !== null) {
      snapshot = await this.registry.get(payment.provider).getPayment(payment.providerPaymentId);
    }
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, payment.id))
        .for('update');
      if (locked === undefined || locked.status !== 'PENDING') {
        return locked?.status ?? payment.status;
      }
      let current = locked;
      if (snapshot === undefined) {
        this.logger.warn(
          { paymentId: payment.id, provider: payment.provider },
          'Płatność bez odpowiedzi operatora od 15 minut: oznaczamy jako nieudaną',
        );
        current = await this.transitions.fail(tx, locked, 'PROVIDER_ERROR');
      } else if (snapshot.status === 'SUCCEEDED') {
        current = await this.transitions.succeed(tx, locked, {
          amount: snapshot.amount,
          ...(snapshot.providerFee === undefined ? {} : { providerFee: snapshot.providerFee }),
        });
      } else if (snapshot.status === 'FAILED') {
        current = await this.transitions.fail(
          tx,
          locked,
          snapshot.failureReason ?? 'PROVIDER_ERROR',
        );
      }
      await tx
        .update(payments)
        .set({ polledAt: new Date(), ...(snapshot === undefined ? {} : { raw: { ...snapshot } }) })
        .where(eq(payments.id, payment.id));
      return current.status;
    });
  }
}
