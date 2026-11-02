// FakeGateway (F-23, PROJECT.md §7.8): pełnoprawny adapter portu PaymentGateway do developmentu,
// testów i stagingu. Zachowuje się jak operator w modelu SELLER_BALANCE: przyjmuje płatność ze
// splitem, rozlicza ją asynchronicznie (job z opóźnieniem) i wysyła podpisany webhook na nasz
// endpoint. Wynik wybierają magiczne kody BLIK albo kupujący na testowej stronie płatności.
// Rozliczenia i narzędzia deweloperskie są w FakeGatewaySimulator.
//
// Na produkcji nie działa: konfiguracja z `fake` przy DEPLOYMENT_ENV=production nie przechodzi
// walidacji, a GatewayRegistry nie rejestruje tego adaptera (config.payments.fake.enabled).
import { isCurrencyCode, type Money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../../infra/db/index.js';
import * as fakeTables from '../../db/fake-gateway.schema.js';
import {
  type FakeGatewayPaymentRow,
  fakeGatewayPayments,
  fakeGatewayPayouts,
  fakeGatewayRefunds,
  fakeGatewaySellers,
  type FakePaymentScenario,
} from '../../db/fake-gateway.schema.js';
import { SELLER_ACCOUNT_TYPES } from '../../domain/payment-values.js';
import {
  type CreatePaymentInput,
  type CreatePaymentResult,
  type CreatePayoutInput,
  type GatewayCapabilities,
  type NormalizedPaymentEvent,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentSnapshot,
  type PayoutResult,
  type RawWebhookRequest,
  type RefundInput,
  type RefundResult,
  type RegisterSellerInput,
  type ReleaseFundsInput,
  type ReleaseFundsResult,
  type SellerAccountResult,
  type SellerStatus,
} from '../../ports/payment-gateway.port.js';
import { FAKE_CAPABILITIES, paymentScenario, registrationStatus } from './fake-scenarios.js';
import { FAKE_GATEWAY_SCHEDULE, type FakeGatewaySchedule } from './fake-gateway-schedule.js';
import { fakeId, paymentMoney, requestHash } from './fake-records.js';
import {
  normalizeFakeEvent,
  parseFakeWebhookBody,
  verifyFakeSignature,
} from './fake-webhook-format.js';

const MAX_KEY_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ścieżka testowej strony płatności w web (apps/web/src/app/dev/fake-pay). */
export const FAKE_PAY_PAGE_PATH = '/dev/fake-pay';

function invalid(message: string): PaymentGatewayError {
  return new PaymentGatewayError('INVALID_REQUEST', message);
}

function notFound(message: string): PaymentGatewayError {
  return new PaymentGatewayError('NOT_FOUND', message);
}

function conflict(key: string): PaymentGatewayError {
  return new PaymentGatewayError(
    'IDEMPOTENCY_CONFLICT',
    `Klucz idempotencji „${key}” użyto już z innymi danymi`,
  );
}

function assertKey(key: string): void {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw invalid(`Klucz idempotencji musi mieć od 1 do ${MAX_KEY_LENGTH} znaków`);
  }
}

function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) {
    throw invalid(`${label} musi być UUID (małe litery)`);
  }
}

function assertAmount(value: Money, label: string): void {
  if (!isCurrencyCode(value.currency) || !Number.isSafeInteger(value.amount) || value.amount < 0) {
    throw invalid(`${label}: oczekiwano nieujemnej kwoty w groszach w obsługiwanej walucie`);
  }
}

function assertPositive(value: Money, label: string): void {
  assertAmount(value, label);
  if (value.amount === 0) {
    throw invalid(`${label} musi być większa od zera`);
  }
}

function isHttpUrl(value: string): boolean {
  const parsed = URL.parse(value);
  return parsed !== null && ['http:', 'https:'].includes(parsed.protocol);
}

function validatePayment(input: CreatePaymentInput): void {
  assertKey(input.idempotencyKey);
  assertUuid(input.orderId, 'orderId');
  assertUuid(input.buyer.id, 'buyer.id');
  assertPositive(input.total, 'Kwota płatności');
  assertAmount(input.split.sellerAmount, 'Część sprzedawcy');
  assertAmount(input.split.platformAmount, 'Część platformy');
  const currencies = new Set([
    input.total.currency,
    input.split.sellerAmount.currency,
    input.split.platformAmount.currency,
  ]);
  if (currencies.size > 1) {
    throw invalid('Kwota i podział muszą być w jednej walucie');
  }
  if (input.split.sellerAmount.amount + input.split.platformAmount.amount !== input.total.amount) {
    throw invalid('Części sprzedawcy i platformy muszą sumować się do kwoty płatności');
  }
  if (!isHttpUrl(input.returnUrl)) {
    throw invalid('returnUrl musi być adresem http(s)');
  }
}

/** Status płatności i wynik dla scenariusza (bez zapisu). */
function initialPayment(
  scenario: FakePaymentScenario,
  id: string,
  redirectUrl: string,
): { status: FakeGatewayPaymentRow['status']; result: CreatePaymentResult } {
  switch (scenario) {
    case 'INVALID_CODE':
      return {
        status: 'FAILED',
        result: { status: 'FAILED', providerPaymentId: id, reason: 'INVALID_BLIK_CODE' },
      };
    case 'BUYER':
      return {
        status: 'PENDING',
        result: { status: 'ACTION_REQUIRED', providerPaymentId: id, redirectUrl },
      };
    case 'SUCCEED':
    case 'DECLINE':
    case 'HANG':
      return { status: 'PENDING', result: { status: 'PENDING', providerPaymentId: id } };
  }
}

@Injectable()
export class FakeGateway implements PaymentGateway {
  readonly provider = 'fake' as const;
  readonly capabilities: GatewayCapabilities = FAKE_CAPABILITIES;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof fakeTables>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FAKE_GATEWAY_SCHEDULE) private readonly schedule: FakeGatewaySchedule,
  ) {}

  async registerSeller(input: RegisterSellerInput): Promise<SellerAccountResult> {
    assertKey(input.idempotencyKey);
    assertUuid(input.sellerId, 'sellerId');
    if (!SELLER_ACCOUNT_TYPES.includes(input.type)) {
      throw invalid(`Nieznany typ konta sprzedawcy: ${input.type}`);
    }
    if (!/^[^@\s]+@[^@\s]+$/.test(input.email) || input.displayName.trim() === '') {
      throw invalid('Rejestracja wymaga adresu e-mail i nazwy sprzedawcy');
    }
    const hash = requestHash({
      sellerId: input.sellerId,
      type: input.type,
      email: input.email,
      displayName: input.displayName,
    });
    const [created] = await this.db
      .insert(fakeGatewaySellers)
      .values({
        id: fakeId('fake_sel'),
        sellerRef: input.sellerId,
        email: input.email,
        displayName: input.displayName,
        type: input.type,
        status: registrationStatus(input.email),
        currency: 'PLN',
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
      })
      .onConflictDoNothing({ target: fakeGatewaySellers.idempotencyKey })
      .returning();
    const seller =
      created ??
      (await this.db
        .select()
        .from(fakeGatewaySellers)
        .where(eq(fakeGatewaySellers.idempotencyKey, input.idempotencyKey))
        .then(([row]) => row));
    if (seller === undefined) {
      throw new Error('Nie zapisano sprzedawcy FakeGateway');
    }
    if (seller.requestHash !== hash) {
      throw conflict(input.idempotencyKey);
    }
    return { providerSellerId: seller.id, status: seller.status };
  }

  async getSellerStatus(providerSellerId: string): Promise<SellerStatus> {
    const [seller] = await this.db
      .select({ status: fakeGatewaySellers.status })
      .from(fakeGatewaySellers)
      .where(eq(fakeGatewaySellers.id, providerSellerId));
    if (seller === undefined) {
      throw notFound(`Nieznany sprzedawca ${providerSellerId}`);
    }
    return seller.status;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    validatePayment(input);
    const scenario = paymentScenario(input.method);
    // Odcisk z kodem BLIK: ten sam klucz z innym kodem to inne żądanie (kodu nie zapisujemy).
    const hash = requestHash(input);
    const { row, inserted } = await this.db.transaction(async (tx) => {
      const [seller] = await tx
        .select()
        .from(fakeGatewaySellers)
        .where(eq(fakeGatewaySellers.id, input.split.providerSellerId));
      if (seller === undefined) {
        throw invalid(`Nieznany sprzedawca ${input.split.providerSellerId}`);
      }
      if (seller.currency !== input.total.currency) {
        throw invalid('Płatność musi być w walucie salda sprzedawcy');
      }
      const id = fakeId('fake_pay');
      const initial = initialPayment(
        scenario,
        id,
        `${this.config.web.url}${FAKE_PAY_PAGE_PATH}/${id}`,
      );
      const [created] = await tx
        .insert(fakeGatewayPayments)
        .values({
          id,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          result: initial.result,
          orderId: input.orderId,
          buyerRef: input.buyer.id,
          sellerId: seller.id,
          method: input.method.type,
          scenario,
          currency: input.total.currency,
          amount: input.total.amount,
          sellerAmount: input.split.sellerAmount.amount,
          platformAmount: input.split.platformAmount.amount,
          status: initial.status,
          failureReason: initial.status === 'FAILED' ? 'INVALID_BLIK_CODE' : null,
          returnUrl: input.returnUrl,
          settledAt: initial.status === 'FAILED' ? new Date() : null,
        })
        .onConflictDoNothing({ target: fakeGatewayPayments.idempotencyKey })
        .returning();
      if (created !== undefined) {
        return { row: created, inserted: true };
      }
      const [existing] = await tx
        .select()
        .from(fakeGatewayPayments)
        .where(eq(fakeGatewayPayments.idempotencyKey, input.idempotencyKey));
      if (existing === undefined) {
        throw new Error('Nie zapisano płatności FakeGateway');
      }
      return { row: existing, inserted: false };
    });
    if (!inserted && row.requestHash !== hash) {
      throw conflict(input.idempotencyKey);
    }
    // Ponowienie też zleca rozliczenie (ID joba z płatności): zlecenie mogło się nie udać.
    if (row.status === 'PENDING' && (row.scenario === 'SUCCEED' || row.scenario === 'DECLINE')) {
      await this.schedule.settleLater({
        kind: 'payment',
        id: row.id,
        outcome: row.scenario === 'SUCCEED' ? 'SUCCEEDED' : 'FAILED',
      });
    }
    return row.result as CreatePaymentResult;
  }

  async getPayment(providerPaymentId: string): Promise<PaymentSnapshot> {
    const row = await this.payment(this.db, providerPaymentId);
    return {
      providerPaymentId: row.id,
      status: row.status,
      amount: paymentMoney(row, row.amount),
      refundedAmount: paymentMoney(row, row.refundedAmount),
      ...(row.failureReason === null ? {} : { failureReason: row.failureReason }),
    };
  }

  async releaseFunds(input: ReleaseFundsInput): Promise<ReleaseFundsResult> {
    assertKey(input.idempotencyKey);
    assertPositive(input.sellerAmount, 'Kwota zwolnienia');
    const row = await this.payment(this.db, input.providerPaymentId);
    if (row.sellerId !== input.providerSellerId) {
      throw invalid('Płatność należy do innego sprzedawcy');
    }
    if (row.status !== 'SUCCEEDED') {
      throw invalid('Zwolnić można tylko środki opłaconej płatności');
    }
    if (
      input.sellerAmount.currency !== row.currency ||
      input.sellerAmount.amount > row.sellerAmount
    ) {
      throw invalid('Kwota zwolnienia przekracza część sprzedawcy w płatności');
    }
    // SELLER_BALANCE: środki są już na saldzie sprzedawcy u operatora, zwolnienie robi ledger.
    return { status: 'NOT_REQUIRED' };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    assertKey(input.idempotencyKey);
    assertPositive(input.amount, 'Kwota zwrotu');
    const hash = requestHash(input);
    const { refund, inserted } = await this.db.transaction(async (tx) => {
      // Blokada płatności przed sprawdzeniem klucza: równoległe zwroty (także z tym samym
      // kluczem) czekają w kolejce, więc drugi widzi już zwrot pierwszego.
      const payment = await this.payment(tx, input.providerPaymentId, true);
      const existing = await this.refundByKey(tx, input.idempotencyKey);
      if (existing !== undefined) {
        return { refund: existing, inserted: false };
      }
      if (payment.status !== 'SUCCEEDED') {
        throw invalid('Zwrócić można tylko opłaconą płatność');
      }
      if (input.amount.currency !== payment.currency) {
        throw invalid('Zwrot musi być w walucie płatności');
      }
      // Zwroty w toku też się liczą: dwa zwroty po 60 zł z płatności 100 zł to za dużo.
      const [open] = await tx
        .select({ total: sql<string>`coalesce(sum(${fakeGatewayRefunds.amount}), 0)` })
        .from(fakeGatewayRefunds)
        .where(
          and(
            eq(fakeGatewayRefunds.paymentId, payment.id),
            ne(fakeGatewayRefunds.status, 'FAILED'),
          ),
        );
      if (Number(open?.total ?? 0) + input.amount.amount > payment.amount) {
        throw new PaymentGatewayError(
          'REFUND_EXCEEDS_PAYMENT',
          `Zwroty przekroczyłyby kwotę płatności ${payment.id}`,
        );
      }
      const [created] = await tx
        .insert(fakeGatewayRefunds)
        .values({
          id: fakeId('fake_ref'),
          paymentId: payment.id,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          currency: input.amount.currency,
          amount: input.amount.amount,
          status: 'PENDING',
        })
        .returning();
      return { refund: created, inserted: true };
    });
    if (refund === undefined) {
      throw new Error('Nie zapisano zwrotu FakeGateway');
    }
    if (refund.requestHash !== hash) {
      throw conflict(input.idempotencyKey);
    }
    if (inserted || refund.status === 'PENDING') {
      await this.schedule.settleLater({ kind: 'refund', id: refund.id });
    }
    return { providerRefundId: refund.id, status: refund.status };
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutResult> {
    assertKey(input.idempotencyKey);
    assertPositive(input.amount, 'Kwota wypłaty');
    const hash = requestHash(input);
    const payout = await this.db.transaction(async (tx) => {
      // Blokada salda przed sprawdzeniem klucza (jak w refund): równoległe wypłaty czekają.
      const [seller] = await tx
        .select()
        .from(fakeGatewaySellers)
        .where(eq(fakeGatewaySellers.id, input.providerSellerId))
        .for('update');
      if (seller === undefined) {
        throw notFound(`Nieznany sprzedawca ${input.providerSellerId}`);
      }
      const existing = await this.payoutByKey(tx, input.idempotencyKey);
      if (existing !== undefined) {
        return existing;
      }
      if (seller.status !== 'VERIFIED') {
        throw new PaymentGatewayError(
          'SELLER_NOT_VERIFIED',
          'Wypłata wymaga zweryfikowanego sprzedawcy',
        );
      }
      if (input.amount.currency !== seller.currency) {
        throw invalid('Wypłata musi być w walucie salda sprzedawcy');
      }
      if (input.amount.amount > seller.balance) {
        throw new PaymentGatewayError(
          'INSUFFICIENT_BALANCE',
          `Wypłata ${input.amount.amount} gr przekracza saldo sprzedawcy (${seller.balance} gr)`,
        );
      }
      await tx
        .update(fakeGatewaySellers)
        .set({ balance: seller.balance - input.amount.amount, updatedAt: new Date() })
        .where(eq(fakeGatewaySellers.id, seller.id));
      const [created] = await tx
        .insert(fakeGatewayPayouts)
        .values({
          id: fakeId('fake_po'),
          sellerId: seller.id,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          currency: input.amount.currency,
          amount: input.amount.amount,
          status: 'PENDING',
        })
        .returning();
      return created;
    });
    if (payout === undefined) {
      throw new Error('Nie zapisano wypłaty FakeGateway');
    }
    if (payout.requestHash !== hash) {
      throw conflict(input.idempotencyKey);
    }
    if (payout.status === 'PENDING') {
      await this.schedule.settleLater({ kind: 'payout', id: payout.id });
    }
    return { providerPayoutId: payout.id, status: payout.status };
  }

  parseWebhook(request: RawWebhookRequest): Promise<NormalizedPaymentEvent[]> {
    // Błąd podpisu jako odrzucona obietnica, jak każda operacja portu (nie wyjątek synchroniczny).
    return Promise.resolve().then(() => {
      verifyFakeSignature(this.config.payments.fake.webhookSecret, request);
      return [normalizeFakeEvent(parseFakeWebhookBody(request.rawBody))];
    });
  }

  private async payment(
    db: Database<typeof fakeTables> | Transaction,
    id: string,
    lock = false,
  ): Promise<FakeGatewayPaymentRow> {
    const query = db.select().from(fakeGatewayPayments).where(eq(fakeGatewayPayments.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (row === undefined) {
      throw notFound(`Nieznana płatność ${id}`);
    }
    return row;
  }

  private async refundByKey(tx: Transaction, key: string) {
    const [row] = await tx
      .select()
      .from(fakeGatewayRefunds)
      .where(eq(fakeGatewayRefunds.idempotencyKey, key));
    return row;
  }

  private async payoutByKey(tx: Transaction, key: string) {
    const [row] = await tx
      .select()
      .from(fakeGatewayPayouts)
      .where(eq(fakeGatewayPayouts.idempotencyKey, key));
    return row;
  }
}
