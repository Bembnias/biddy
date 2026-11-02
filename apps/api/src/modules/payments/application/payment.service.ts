// Płatności zamówień u operatora (F-23, PROJECT.md §7.8). createPayment działa w trzech krokach:
// 1. wiersz PENDING idempotentny po kluczu wywołującego (np. `order:{id}:attempt:1`),
// 2. wywołanie operatora z naszym kluczem `payment:{id}` (ponowienie po błędzie sieci nie tworzy
//    drugiej płatności u operatora),
// 3. zapis wyniku w transakcji: ID operatora i przekierowanie, a od razu SUCCEEDED albo FAILED,
//    gdy operator tak odpowie.
// Webhook, który dotrze przed krokiem 3, nie znajdzie płatności i zostanie ponowiony przez
// operatora. Checkout (F-25) wywołuje createPayment; kod BLIK idzie tylko do operatora.
import { isCurrencyCode, type Money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type PaymentRow, payments } from '../db/payments.schema.js';
import {
  PAYMENT_METHODS,
  type PaymentFailureReason,
  type PaymentMethodType,
  type PaymentStatus,
} from '../domain/payment-values.js';
import {
  type CreatePaymentResult,
  isPaymentGatewayError,
  type PaymentMethod,
} from '../ports/payment-gateway.port.js';
import { GatewayRegistry } from './gateway-registry.js';
import { paymentAmount, PaymentTransitions } from './payment-transitions.js';
import { SellerAccountService } from './seller-account.service.js';

const MAX_KEY_LENGTH = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CreatePaymentCommand {
  readonly orderId: string;
  readonly buyer: { readonly id: string; readonly email: string; readonly ip: string };
  readonly sellerId: string;
  /** Cała wpłata (cena + POK + dostawa). */
  readonly amount: Money;
  /** Część sprzedającego (cena); reszta to część Biddy. */
  readonly sellerAmount: Money;
  readonly method: PaymentMethod;
  /** Dokąd operator odsyła kupującego po płatności z przekierowaniem. */
  readonly returnUrl: string;
  /** Klucz wywołującego, np. `order:{orderId}:attempt:1`. */
  readonly idempotencyKey: string;
}

export interface PaymentView {
  readonly id: string;
  readonly orderId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly provider: string;
  readonly providerPaymentId: string | null;
  readonly method: PaymentMethodType;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly sellerAmount: Money;
  readonly platformAmount: Money;
  readonly failureReason: PaymentFailureReason | null;
  /** Strona operatora, na którą trzeba przekierować kupującego (płatność w toku). */
  readonly redirectUrl: string | null;
  readonly createdAt: Date;
  readonly succeededAt: Date | null;
  readonly failedAt: Date | null;
}

export function toPaymentView(row: PaymentRow): PaymentView {
  const of = (amount: number): Money => ({ amount, currency: row.currency });
  return {
    id: row.id,
    orderId: row.orderId,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    provider: row.provider,
    providerPaymentId: row.providerPaymentId,
    method: row.method,
    status: row.status,
    amount: of(row.amount),
    sellerAmount: of(row.sellerAmount),
    platformAmount: of(row.platformAmount),
    failureReason: row.failureReason,
    redirectUrl: row.status === 'PENDING' ? row.redirectUrl : null,
    createdAt: row.createdAt,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
  };
}

function badRequest(detail: string): DomainError {
  return new DomainError({ code: 'BAD_REQUEST', detail });
}

function validate(command: CreatePaymentCommand): void {
  if (command.idempotencyKey.length === 0 || command.idempotencyKey.length > MAX_KEY_LENGTH) {
    throw badRequest(`Klucz idempotencji płatności musi mieć od 1 do ${MAX_KEY_LENGTH} znaków.`);
  }
  for (const [label, value] of [
    ['orderId', command.orderId],
    ['buyer.id', command.buyer.id],
    ['sellerId', command.sellerId],
  ] as const) {
    if (!UUID.test(value)) {
      throw badRequest(`${label} musi być UUID.`);
    }
  }
  const { amount, sellerAmount } = command;
  const valid = (value: Money) =>
    isCurrencyCode(value.currency) && Number.isSafeInteger(value.amount) && value.amount >= 0;
  if (!valid(amount) || !valid(sellerAmount) || amount.amount === 0) {
    throw badRequest('Kwota płatności musi być dodatnią liczbą groszy.');
  }
  if (amount.currency !== sellerAmount.currency || sellerAmount.amount > amount.amount) {
    throw badRequest('Część sprzedającego musi być w walucie płatności i nie większa od niej.');
  }
  if (!PAYMENT_METHODS.includes(command.method.type)) {
    throw badRequest(`Nieznana metoda płatności: ${command.method.type}.`);
  }
}

/** Czy wiersz zapisano dla tych samych danych (ponowienie), czy klucz użyto ponownie. */
function sameRequest(row: PaymentRow, command: CreatePaymentCommand): boolean {
  return (
    row.orderId === command.orderId &&
    row.buyerId === command.buyer.id &&
    row.sellerId === command.sellerId &&
    row.method === command.method.type &&
    row.currency === command.amount.currency &&
    row.amount === command.amount.amount &&
    row.sellerAmount === command.sellerAmount.amount
  );
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly sellerAccounts: SellerAccountService,
    private readonly transitions: PaymentTransitions,
  ) {}

  async get(id: string): Promise<PaymentView | undefined> {
    const [row] = await this.db.select().from(payments).where(eq(payments.id, id));
    return row === undefined ? undefined : toPaymentView(row);
  }

  /** Płatności zamówienia, najnowsza najpierw (checkout, F-25). */
  async forOrder(orderId: string, tx?: Transaction): Promise<PaymentView[]> {
    const rows = await (tx ?? this.db)
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(desc(payments.createdAt), desc(payments.id));
    return rows.map(toPaymentView);
  }

  /** Płatność po kluczu wywołującego (ponowienie żądania checkoutu) albo undefined. */
  async byIdempotencyKey(key: string, tx?: Transaction): Promise<PaymentView | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(payments)
      .where(eq(payments.idempotencyKey, key));
    return row === undefined ? undefined : toPaymentView(row);
  }

  /**
   * Tworzy płatność u operatora domyślnego. Ponowienie z tym samym kluczem zwraca tę samą
   * płatność (po błędzie sieci kończy wywołanie operatora z tym samym kluczem).
   *
   * @throws {DomainError} BAD_REQUEST (dane), IDEMPOTENCY_KEY_REUSED (klucz z innymi danymi),
   *   CONFLICT (sprzedający bez konta u operatora)
   */
  async createPayment(command: CreatePaymentCommand): Promise<PaymentView> {
    validate(command);
    const provider = this.registry.defaultProvider;
    // Bez konta sprzedawcy u operatora nie zakładamy płatności (rejestracja: F-32, F-25).
    if ((await this.sellerAccounts.find(command.sellerId, provider)) === undefined) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Sprzedający nie ma jeszcze konta u operatora płatności.',
      });
    }
    const [inserted] = await this.db
      .insert(payments)
      .values({
        orderId: command.orderId,
        buyerId: command.buyer.id,
        sellerId: command.sellerId,
        provider,
        method: command.method.type,
        currency: command.amount.currency,
        amount: command.amount.amount,
        sellerAmount: command.sellerAmount.amount,
        platformAmount: command.amount.amount - command.sellerAmount.amount,
        status: 'PENDING',
        idempotencyKey: command.idempotencyKey,
      })
      .onConflictDoNothing({ target: payments.idempotencyKey })
      .returning();
    const payment = inserted ?? (await this.byKey(command.idempotencyKey));
    if (inserted === undefined) {
      if (!sameRequest(payment, command)) {
        throw new DomainError({
          code: 'IDEMPOTENCY_KEY_REUSED',
          detail: 'Ten klucz płatności użyto już z innymi danymi.',
        });
      }
      if (payment.providerPaymentId !== null || payment.status !== 'PENDING') {
        return toPaymentView(payment);
      }
    }

    // Płatność kończymy u operatora z rekordu (ponowienie po zmianie operatora domyślnego).
    const account = await this.sellerAccounts.find(command.sellerId, payment.provider);
    if (account === undefined) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Sprzedający nie ma konta u operatora tej płatności.',
      });
    }
    let result: CreatePaymentResult;
    try {
      result = await this.registry.get(payment.provider).createPayment({
        orderId: payment.orderId,
        idempotencyKey: `payment:${payment.id}`,
        total: paymentAmount(payment),
        split: {
          providerSellerId: account.providerAccountId,
          sellerAmount: { amount: payment.sellerAmount, currency: payment.currency },
          platformAmount: { amount: payment.platformAmount, currency: payment.currency },
        },
        method: command.method,
        buyer: command.buyer,
        returnUrl: command.returnUrl,
      });
    } catch (error) {
      // Operator odrzucił żądanie jako błędne: ponowienie nic nie zmieni. Inne błędy (sieć,
      // niedostępność) zostawiają PENDING, a ponowienie z tym samym kluczem dokończy płatność.
      if (isPaymentGatewayError(error, 'INVALID_REQUEST')) {
        this.logger.error(
          { paymentId: payment.id, err: error },
          'Operator odrzucił żądanie płatności',
        );
        return toPaymentView(await this.failWithoutProvider(payment.id, 'PROVIDER_ERROR'));
      }
      throw error;
    }
    return toPaymentView(await this.applyResult(payment.id, result));
  }

  private async applyResult(paymentId: string, result: CreatePaymentResult): Promise<PaymentRow> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update');
      if (locked === undefined) {
        throw new Error(`Nie ma płatności ${paymentId}`);
      }
      let row = locked;
      const providerPaymentId = result.providerPaymentId;
      if (row.providerPaymentId === null && providerPaymentId !== undefined) {
        const [updated] = await tx
          .update(payments)
          .set({
            providerPaymentId,
            redirectUrl: result.status === 'ACTION_REQUIRED' ? result.redirectUrl : null,
            raw: { ...result },
            updatedAt: new Date(),
          })
          .where(eq(payments.id, paymentId))
          .returning();
        row = updated ?? row;
      }
      if (result.status === 'SUCCEEDED') {
        return this.transitions.succeed(tx, row, { amount: paymentAmount(row) });
      }
      if (result.status === 'FAILED') {
        return this.transitions.fail(tx, row, result.reason);
      }
      return row;
    });
  }

  /** Porażka po odrzuceniu żądania przez operatora (event PaymentFailed). */
  private async failWithoutProvider(
    paymentId: string,
    reason: PaymentFailureReason,
  ): Promise<PaymentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, paymentId))
        .for('update');
      if (row === undefined) {
        throw new Error(`Nie ma płatności ${paymentId}`);
      }
      return this.transitions.fail(tx, row, reason);
    });
  }

  private async byKey(key: string): Promise<PaymentRow> {
    const [row] = await this.db.select().from(payments).where(eq(payments.idempotencyKey, key));
    if (row === undefined) {
      throw new Error(`Nie ma płatności z kluczem ${key}`);
    }
    return row;
  }
}
