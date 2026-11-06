// Przetwarzanie zdarzeń operatora (F-23, PROJECT.md §7.8):
// 1. adapter weryfikuje podpis i tłumaczy webhook na zdarzenia znormalizowane,
// 2. każde zdarzenie we własnej transakcji: wpis w processed_webhooks (provider, event_id) i obsługa,
// 3. duplikat (ten sam event_id) trafia na konflikt klucza i jest pomijany; równoległe dostarczenie
//    czeka na transakcję pierwszego, więc stan zmienia się raz.
// Błąd obsługi wycofuje też wpis idempotencji: odpowiadamy 500, a operator ponawia webhook.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type PaymentRow, payments, processedWebhooks } from '../db/payments.schema.js';
import type { WebhookOutcome } from '../domain/payment-values.js';
import {
  isPaymentGatewayError,
  type NormalizedPaymentEvent,
  type NormalizedPaymentEventType,
  type RawWebhookRequest,
} from '../ports/payment-gateway.port.js';
import { GatewayRegistry } from './gateway-registry.js';
import { PaymentTransitions } from './payment-transitions.js';
import { PayoutService } from '../payouts/payout.service.js';
import { RefundService } from './refund.service.js';
import { SellerAccountService } from './seller-account.service.js';

/** Zdarzenia z obsługą (F-23, zwroty: F-25, wypłaty: F-27); chargebacki obsłuży F-28. */
const HANDLED_EVENT_TYPES: ReadonlySet<NormalizedPaymentEventType> = new Set([
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'REFUND_SUCCEEDED',
  'REFUND_FAILED',
  'PAYOUT_PAID',
  'PAYOUT_FAILED',
  'SELLER_STATUS_CHANGED',
]);

export interface WebhookReceipt {
  /** Zdarzenia w webhooku. */
  readonly received: number;
  /** Przetworzone teraz (obsłużone albo zapisane jako bez obsługi). */
  readonly processed: number;
  /** Przetworzone już wcześniej (ponowione dostarczenie). */
  readonly duplicates: number;
}

/**
 * Zdarzenie dotyczy obiektu, którego jeszcze nie znamy (np. webhook przed zapisem odpowiedzi
 * operatora w createPayment). Odpowiedź 500 sprawia, że operator ponowi webhook później.
 */
export class UnknownWebhookSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownWebhookSubjectError';
  }
}

@Injectable()
export class PaymentEventProcessor {
  private readonly logger = new Logger(PaymentEventProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly transitions: PaymentTransitions,
    private readonly sellerAccounts: SellerAccountService,
    private readonly refunds: RefundService,
    private readonly payouts: PayoutService,
  ) {}

  /**
   * Webhook operatora z surowym body.
   *
   * @throws {DomainError} NOT_FOUND (operator bez adaptera), UNAUTHORIZED (zły podpis),
   *   BAD_REQUEST (nieznany format)
   */
  async receive(provider: string, request: RawWebhookRequest): Promise<WebhookReceipt> {
    const gateway = this.registry.find(provider);
    if (gateway === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nieznany operator płatności.' });
    }
    let events: NormalizedPaymentEvent[];
    try {
      events = await gateway.parseWebhook(request);
    } catch (error) {
      if (isPaymentGatewayError(error, 'INVALID_SIGNATURE')) {
        this.logger.warn({ provider, reason: error.message }, 'Odrzucony webhook: zły podpis');
        throw new DomainError({
          code: 'UNAUTHORIZED',
          detail: 'Nieprawidłowy podpis webhooka.',
          cause: error,
        });
      }
      if (isPaymentGatewayError(error, 'INVALID_REQUEST')) {
        throw new DomainError({ code: 'BAD_REQUEST', detail: error.message, cause: error });
      }
      throw error;
    }
    let processed = 0;
    for (const event of events) {
      if (await this.process(provider, event)) {
        processed += 1;
      }
    }
    const receipt = { received: events.length, processed, duplicates: events.length - processed };
    this.logger.log(
      { provider, ...receipt, events: events.map((event) => `${event.type}:${event.eventId}`) },
      'Webhook operatora płatności',
    );
    return receipt;
  }

  /**
   * Jedno zdarzenie w jednej transakcji. Zwraca false dla duplikatu (zdarzenie przetworzone
   * wcześniej albo równolegle).
   */
  async process(provider: string, event: NormalizedPaymentEvent): Promise<boolean> {
    const outcome: WebhookOutcome = HANDLED_EVENT_TYPES.has(event.type) ? 'HANDLED' : 'IGNORED';
    return this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .insert(processedWebhooks)
        .values({ provider, eventId: event.eventId, eventType: event.type, outcome })
        .onConflictDoNothing()
        .returning({ eventId: processedWebhooks.eventId });
      if (claimed === undefined) {
        return false;
      }
      await this.handle(tx, provider, event);
      return true;
    });
  }

  private async handle(
    tx: Transaction,
    provider: string,
    event: NormalizedPaymentEvent,
  ): Promise<void> {
    if (event.type === 'PAYMENT_SUCCEEDED') {
      const payment = await this.lockPayment(tx, provider, event.providerPaymentId);
      await this.transitions.succeed(tx, payment, {
        amount: event.amount,
        ...(event.providerFee === undefined ? {} : { providerFee: event.providerFee }),
      });
    } else if (event.type === 'PAYMENT_FAILED') {
      const payment = await this.lockPayment(tx, provider, event.providerPaymentId);
      await this.transitions.fail(tx, payment, event.reason);
    } else if (event.type === 'REFUND_SUCCEEDED' || event.type === 'REFUND_FAILED') {
      const known = await this.refunds.applyProviderResult(
        tx,
        provider,
        event.providerRefundId,
        event.type === 'REFUND_SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
        event.amount,
      );
      if (!known) {
        throw new UnknownWebhookSubjectError(
          `Nieznany zwrot ${provider}:${event.providerRefundId}`,
        );
      }
    } else if (event.type === 'PAYOUT_PAID' || event.type === 'PAYOUT_FAILED') {
      const known = await this.payouts.applyProviderResult(
        tx,
        provider,
        event.providerPayoutId,
        event.type === 'PAYOUT_PAID' ? 'PAID' : 'FAILED',
        event.amount,
      );
      if (!known) {
        throw new UnknownWebhookSubjectError(
          `Nieznana wypłata ${provider}:${event.providerPayoutId}`,
        );
      }
    } else if (event.type === 'SELLER_STATUS_CHANGED') {
      const known = await this.sellerAccounts.applyStatus(
        tx,
        provider,
        event.providerSellerId,
        event.status,
      );
      if (!known) {
        throw new UnknownWebhookSubjectError(
          `Nieznane konto sprzedawcy ${provider}:${event.providerSellerId}`,
        );
      }
    } else {
      this.logger.warn(
        { provider, eventId: event.eventId, type: event.type },
        'Zdarzenie operatora bez obsługi w tej wersji (chargebacki: F-28)',
      );
    }
  }

  private async lockPayment(
    tx: Transaction,
    provider: string,
    providerPaymentId: string,
  ): Promise<PaymentRow> {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId)),
      )
      .for('update');
    if (payment === undefined) {
      throw new UnknownWebhookSubjectError(`Nieznana płatność ${provider}:${providerPaymentId}`);
    }
    return payment;
  }
}
