// Checkout (F-25, PROJECT.md §7.2): widok dla kupującego, wybór dostawy i rozpoczęcie płatności.
// Kwoty liczy backend: suma = cena + POK (zamówienie, F-16) + dostawa (cena z cennika zapisana
// przy wyborze, F-24). Zmiana dostawy i nowa płatność blokują wiersz zamówienia (FOR UPDATE) do
// zapisu płatności, więc dwa równoległe „Zapłać” dają jedną płatność, a płatność w toku albo
// udana blokuje kolejną (nie da się zapłacić dwa razy).
import { type Money, money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, FollowService } from '../../identity/index.js';
import { PaymentService, type PaymentView, SellerAccountService } from '../../payments/index.js';
import {
  type PrepareShipmentInput,
  type ShipmentDetails,
  ShipmentService,
  type ShippingOption,
  ShippingQuoteService,
} from '../../shipping/index.js';
import { type Order, orders } from '../db/orders.schema.js';
import { parcelFromSnapshot } from '../orders/order-parcel.js';
import type { OrderItemSnapshot } from '../orders/order-snapshot.js';
import { OrderService } from '../orders/order.service.js';
import {
  type CheckoutBlocker,
  checkoutBlocker,
  type CheckoutPaymentMethod,
  checkoutTotal,
  effectivePaymentDeadline,
} from './checkout-rules.js';

/** Stan checkoutu dla kupującego. */
export interface CheckoutView {
  readonly order: Order;
  readonly snapshot: OrderItemSnapshot;
  readonly options: readonly ShippingOption[];
  readonly shipment: ShipmentDetails | undefined;
  /** Ostatnia płatność zamówienia. */
  readonly payment: PaymentView | undefined;
  /** Termin z przedłużeniem o 30 min dla płatności w toku (§6.8). */
  readonly effectiveDueAt: Date;
  /** Czy można zmienić dostawę i zapłacić (null) albo dlaczego nie. */
  readonly blocker: CheckoutBlocker | null;
}

export interface ChooseDeliveryCommand {
  readonly carrierId: string;
  readonly pickupPointId: string | null;
  readonly recipient: PrepareShipmentInput['recipient'];
}

export interface StartPaymentCommand {
  readonly method: CheckoutPaymentMethod;
  /** Kod BLIK (6 cyfr): tylko do operatora, nigdzie nie zapisywany. */
  readonly blikCode: string | null;
  /** Suma, którą kupujący widział na przycisku (grosze). */
  readonly expectedTotal: number;
  /** Nagłówek Idempotency-Key. */
  readonly idempotencyKey: string;
  readonly ip: string;
}

/** Klucz płatności u nas dla klucza klienta (unikalny w `payments`). */
export function checkoutPaymentKey(orderId: string, clientKey: string): string {
  return `checkout:${orderId}:${clientKey}`;
}

function blockerError(blocker: CheckoutBlocker): DomainError {
  return new DomainError({ code: blocker });
}

@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly orders: OrderService,
    private readonly quotes: ShippingQuoteService,
    private readonly shipments: ShipmentService,
    private readonly payments: PaymentService,
    private readonly sellerAccounts: SellerAccountService,
    private readonly follows: FollowService,
  ) {}

  /** Widok checkoutu (tylko kupujący; inni 404). */
  async view(idOrPublicId: string, buyerId: string): Promise<CheckoutView> {
    const { order, snapshot } = await this.buyerOrder(idOrPublicId, buyerId);
    return this.compose(order, snapshot);
  }

  /**
   * Wybór dostawy przed płatnością: przesyłka PENDING z ceną z cennika (F-24) i nowa suma
   * zamówienia. Ponowny wybór zastępuje poprzedni.
   *
   * @throws {DomainError} ORDER_NOT_AWAITING_PAYMENT, PAYMENT_DEADLINE_PASSED, PAYMENT_IN_PROGRESS
   *   i błędy wyboru dostawy z F-24 (SHIPPING_OPTION_UNAVAILABLE, PICKUP_POINT_*, …)
   */
  async chooseDelivery(
    idOrPublicId: string,
    buyerId: string,
    command: ChooseDeliveryCommand,
  ): Promise<CheckoutView> {
    const { order: found, snapshot } = await this.buyerOrder(idOrPublicId, buyerId);
    const order = await this.db.transaction(async (tx) => {
      const locked = await this.lock(tx, found.id);
      await this.assertCanPay(tx, locked);
      const prepared = await this.shipments.prepare({
        orderId: locked.id,
        direction: 'OUTBOUND',
        carrierId: command.carrierId,
        parcel: parcelFromSnapshot(snapshot),
        currency: locked.currency,
        pickupPointId: command.pickupPointId,
        recipient: command.recipient,
      });
      return this.saveShippingFee(tx, locked, prepared.shipment.price);
    });
    return this.compose(order, snapshot);
  }

  /**
   * Płatność za zamówienie u operatora domyślnego. Ponowienie z tym samym kluczem zwraca tę samą
   * płatność (`replayed`); inna metoda z tym samym kluczem to IDEMPOTENCY_KEY_REUSED.
   *
   * @throws {DomainError} ORDER_NOT_AWAITING_PAYMENT, PAYMENT_DEADLINE_PASSED, PAYMENT_IN_PROGRESS,
   *   DELIVERY_REQUIRED, CHECKOUT_TOTAL_CHANGED, SELLER_UNAVAILABLE, IDEMPOTENCY_KEY_REUSED
   */
  async startPayment(
    idOrPublicId: string,
    buyer: AuthenticatedUser,
    command: StartPaymentCommand,
  ): Promise<{ readonly view: CheckoutView; readonly replayed: boolean }> {
    const { order: found, snapshot } = await this.buyerOrder(idOrPublicId, buyer.id);
    const key = checkoutPaymentKey(found.id, command.idempotencyKey);
    const replayed = await this.db.transaction(async (tx) => {
      const order = await this.lock(tx, found.id);
      const earlier = await this.payments.byIdempotencyKey(key, tx);
      if (earlier !== undefined) {
        if (earlier.method !== command.method) {
          throw new DomainError({ code: 'IDEMPOTENCY_KEY_REUSED' });
        }
        // Płatność przerwana przed odpowiedzią operatora: createPayment z tym samym kluczem
        // ją dokończy. Pozostałe ponowienia zwracają bieżący stan.
        if (earlier.status !== 'PENDING' || earlier.providerPaymentId !== null) {
          return true;
        }
        await this.createPayment(order, buyer, command, key, earlier.amount);
        return true;
      }
      await this.assertCanPay(tx, order);
      const shipment = await this.shipments.forOrder(order.id);
      if (shipment === undefined || shipment.shipment.status !== 'PENDING') {
        throw new DomainError({ code: 'DELIVERY_REQUIRED' });
      }
      // Suma z ceną dostawy z przesyłki: zamówienie zawsze ma kwotę, którą pobieramy.
      const current = await this.saveShippingFee(tx, order, shipment.shipment.price);
      if (command.expectedTotal !== current.total) {
        throw new DomainError({
          code: 'CHECKOUT_TOTAL_CHANGED',
          extensions: { total: current.total, currency: current.currency },
        });
      }
      await this.ensureSellerAccount(current.sellerId);
      await this.createPayment(
        current,
        buyer,
        command,
        key,
        money(current.total, current.currency),
      );
      return false;
    });
    const order = await this.orders.byId(found.id);
    return { view: await this.compose(order ?? found, snapshot), replayed };
  }

  private async createPayment(
    order: Order,
    buyer: AuthenticatedUser,
    command: StartPaymentCommand,
    key: string,
    amount: Money,
  ): Promise<PaymentView> {
    return this.payments.createPayment({
      orderId: order.id,
      buyer: { id: buyer.id, email: buyer.email, ip: command.ip },
      sellerId: order.sellerId,
      amount,
      sellerAmount: money(order.itemsTotal, order.currency),
      method:
        command.method === 'BLIK'
          ? { type: 'BLIK', ...(command.blikCode === null ? {} : { code: command.blikCode }) }
          : { type: command.method },
      returnUrl: new URL(
        `/zamowienia/${encodeURIComponent(order.publicId)}/zaplac`,
        this.config.web.url,
      ).toString(),
      idempotencyKey: key,
    });
  }

  /**
   * Konto sprzedawcy u operatora przed pierwszą płatnością (do F-32, który zarejestruje
   * sprzedawcę przy wystawieniu). Bez potwierdzonego e-maila albo przy zablokowanym koncie
   * sprzedający nie przyjmie płatności.
   */
  private async ensureSellerAccount(sellerId: string): Promise<void> {
    if ((await this.sellerAccounts.find(sellerId)) !== undefined) {
      return;
    }
    const [contact] = await this.follows.contacts([sellerId]);
    if (contact?.email === null || contact === undefined) {
      throw new DomainError({ code: 'SELLER_UNAVAILABLE' });
    }
    await this.sellerAccounts.register({
      userId: sellerId,
      email: contact.email,
      displayName: contact.name,
      type: 'PRIVATE',
    });
  }

  private async assertCanPay(tx: Transaction, order: Order): Promise<void> {
    const attempts = await this.payments.forOrder(order.id, tx);
    const blocker = checkoutBlocker(order, attempts, new Date());
    if (blocker !== undefined) {
      throw blockerError(blocker);
    }
  }

  private async saveShippingFee(tx: Transaction, order: Order, fee: number): Promise<Order> {
    const total = checkoutTotal({ ...order, shippingFee: fee });
    if (order.shippingFee === fee && order.total === total) {
      return order;
    }
    const [updated] = await tx
      .update(orders)
      .set({ shippingFee: fee, total, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .returning();
    if (updated === undefined) {
      throw new Error(`Nie zaktualizowano zamówienia ${order.id}`);
    }
    return updated;
  }

  private async compose(order: Order, snapshot: OrderItemSnapshot): Promise<CheckoutView> {
    const [options, shipment, attempts] = await Promise.all([
      this.quotes.options(parcelFromSnapshot(snapshot), order.currency),
      this.shipments.forOrder(order.id),
      this.payments.forOrder(order.id),
    ]);
    return {
      order,
      snapshot,
      options,
      shipment,
      payment: attempts[0],
      effectiveDueAt: effectivePaymentDeadline(order.paymentDueAt, attempts),
      blocker: checkoutBlocker(order, attempts, new Date()) ?? null,
    };
  }

  private async buyerOrder(
    idOrPublicId: string,
    buyerId: string,
  ): Promise<{ readonly order: Order; readonly snapshot: OrderItemSnapshot }> {
    const participant = await this.orders.forParticipant(idOrPublicId, buyerId);
    if (participant.role !== 'BUYER') {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    return participant;
  }

  private async lock(tx: Transaction, orderId: string): Promise<Order> {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (order === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    return order;
  }
}
