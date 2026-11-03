// Zamówienie w sporze (F-28, PROJECT.md §7.3, §7.5, §7.9): moduł disputes prowadzi przebieg sporu,
// a ta klasa zmienia stan zamówienia i rusza pieniądze w transakcji wywołującego:
// - open: DELIVERED → DISPUTED w oknie 36 h (środki zostają wstrzymane, auto-zakończenie i „Wszystko
//   OK” dotyczą tylko DELIVERED);
// - settle: na korzyść sprzedającego od razu COMPLETED ze zwolnieniem środków; pełny albo częściowy
//   zwrot zlecony u operatora, a REFUNDED / PARTIALLY_REFUNDED ustawia konsument RefundSucceeded
//   (order-lifecycle.ts) po potwierdzeniu, więc w stanie końcowym `buyer_funds_held` = 0.
// Wina sprzedającego dokłada potrącenie dostawy w obie strony, a wina przewoźnika rekompensatę
// równą cenie i reklamację u przewoźnika (rozlicza ją konsument CarrierClaimResolved).
import { type Money, money } from '@biddy/shared';
import { Injectable, Logger } from '@nestjs/common';

import type { Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { EscrowService, RefundService } from '../../payments/index.js';
import { CarrierClaimService, ShipmentService } from '../../shipping/index.js';
import type { Order } from '../db/orders.schema.js';
import {
  type LockedOrder,
  lockOrder,
  orderAmounts,
  orderParties,
  transitionOrder,
} from '../orders/order-records.js';
import { OrderService, type OrderRole } from '../orders/order.service.js';
import { OrderDisputed } from '../orders.events.js';
import { OrderLifecycle, requirePayment } from './order-lifecycle.js';

/** Zamówienie w sporze: dane, których moduł disputes potrzebuje bez czytania tabel zamówień. */
export interface DisputedOrder {
  readonly orderId: string;
  readonly publicId: string;
  readonly auctionId: string;
  readonly buyerId: string;
  readonly sellerId: string;
  readonly title: string;
  readonly photoUrl: string | null;
  readonly amounts: {
    readonly itemsTotal: Money;
    readonly pokFee: Money;
    readonly shippingFee: Money;
    readonly total: Money;
  };
}

/** Zamówienie oglądane przez stronę (przed zgłoszeniem albo w widoku sporu). */
export interface DisputeParticipant extends DisputedOrder {
  readonly role: OrderRole;
  readonly status: Order['status'];
  readonly inspectionEndsAt: Date | null;
  readonly onHold: boolean;
}

/** Rozstrzygnięcie sporu do wykonania na zamówieniu. */
export type DisputeSettlement =
  | { readonly outcome: 'SELLER_FAVOR' }
  | {
      readonly outcome: 'FULL_REFUND';
      readonly fault: 'SELLER';
      /** Cena przesyłki zwrotnej z cennika, gdy zwrot był nadany; dolicza się do dostawy. */
      readonly returnShipping: Money | null;
    }
  | {
      readonly outcome: 'FULL_REFUND';
      readonly fault: 'CARRIER';
      /** Reklamacja `LOST` (paczka nie dotarła mimo doręczenia), inaczej `DAMAGED`. */
      readonly claimType: 'LOST' | 'DAMAGED';
    }
  | { readonly outcome: 'PARTIAL_REFUND'; readonly amount: Money };

export type DisputeOpenBlocker = 'DISPUTE_UNAVAILABLE' | 'DISPUTE_WINDOW_CLOSED' | 'ORDER_ON_HOLD';

/** Czy kupujący może zgłosić problem (undefined: może). */
export function disputeOpenBlocker(
  order: Pick<Order, 'status' | 'inspectionEndsAt' | 'chargebackStatus'>,
  now: Date,
): DisputeOpenBlocker | undefined {
  if (order.status !== 'DELIVERED' || order.inspectionEndsAt === null) {
    return 'DISPUTE_UNAVAILABLE';
  }
  if (now.getTime() >= order.inspectionEndsAt.getTime()) {
    return 'DISPUTE_WINDOW_CLOSED';
  }
  return order.chargebackStatus === 'OPEN' ? 'ORDER_ON_HOLD' : undefined;
}

@Injectable()
export class OrderDisputes {
  private readonly logger = new Logger(OrderDisputes.name);

  constructor(
    private readonly orders: OrderService,
    private readonly lifecycle: OrderLifecycle,
    private readonly refunds: RefundService,
    private readonly escrow: EscrowService,
    private readonly shipments: ShipmentService,
    private readonly claims: CarrierClaimService,
    private readonly outbox: Outbox,
  ) {}

  /** Zamówienie strony (kupującego albo sprzedającego); inni: 404. */
  async participant(idOrPublicId: string, userId: string): Promise<DisputeParticipant> {
    const { order, role, snapshot } = await this.orders.forParticipant(idOrPublicId, userId);
    const cover = snapshot.item.photos[0]?.urls;
    return {
      ...disputedOrder(order, snapshot.auction.id, snapshot.item.title),
      photoUrl: cover?.['thumb'] ?? cover?.['medium'] ?? null,
      role,
      status: order.status,
      inspectionEndsAt: order.inspectionEndsAt,
      onHold: order.chargebackStatus === 'OPEN',
    };
  }

  /**
   * Zgłoszenie problemu: DELIVERED → DISPUTED z `disputed_at` i event OrderDisputed.
   *
   * @throws {DomainError} DISPUTE_UNAVAILABLE, DISPUTE_WINDOW_CLOSED (z `inspectionEndsAt`),
   *   ORDER_ON_HOLD
   */
  async open(tx: Transaction, orderId: string, now: Date): Promise<DisputedOrder> {
    const locked = await lockOrder(tx, orderId);
    if (locked === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    const { order, item } = locked;
    const blocker = disputeOpenBlocker(order, now);
    if (blocker !== undefined) {
      throw new DomainError({
        code: blocker,
        ...(blocker === 'DISPUTE_WINDOW_CLOSED' && order.inspectionEndsAt !== null
          ? { extensions: { inspectionEndsAt: order.inspectionEndsAt.toISOString() } }
          : {}),
      });
    }
    const updated = await transitionOrder(tx, order, 'DISPUTED', { disputedAt: now }, now);
    await this.outbox.add(
      tx,
      OrderDisputed.create({
        aggregateId: order.id,
        payload: { ...orderParties(order, item), disputedAt: now.toISOString() },
      }),
    );
    return disputedOrder(updated, item.auctionId, item.itemSnapshot.item.title);
  }

  /**
   * Wykonanie rozstrzygnięcia na zamówieniu DISPUTED (w transakcji rozstrzygnięcia sporu).
   * Klucze zwrotów i księgowań są z zamówienia, więc ponowienie niczego nie dubluje.
   */
  async settle(
    tx: Transaction,
    orderId: string,
    settlement: DisputeSettlement,
    now: Date,
  ): Promise<void> {
    const locked = await lockOrder(tx, orderId);
    if (locked === undefined) {
      throw new Error(`Spór o nieistniejące zamówienie ${orderId}`);
    }
    const { order } = locked;
    if (order.status !== 'DISPUTED') {
      throw new Error(`Rozstrzygnięcie sporu dla zamówienia ${order.id} w stanie ${order.status}`);
    }
    switch (settlement.outcome) {
      case 'SELLER_FAVOR':
        await this.lifecycle.complete(tx, locked, now, false);
        return;
      case 'PARTIAL_REFUND':
        await this.refunds.request(tx, {
          paymentId: requirePayment(order),
          reason: 'DISPUTE_PARTIAL',
          orderAmounts: orderAmounts(order),
          amount: settlement.amount,
          idempotencyKey: `refund:order:${order.id}:dispute-partial`,
        });
        return;
      case 'FULL_REFUND':
        await this.refunds.request(tx, {
          paymentId: requirePayment(order),
          reason: 'DISPUTE',
          idempotencyKey: `refund:order:${order.id}:dispute`,
        });
        if (settlement.fault === 'SELLER') {
          await this.chargeSeller(tx, order, settlement.returnShipping);
        } else {
          await this.compensateSeller(tx, locked, settlement.claimType, now);
        }
        return;
    }
  }

  /** Dostawa w obie strony po stronie sprzedającego (§7.9): saldo, a niedobór jako należność. */
  private async chargeSeller(tx: Transaction, order: Order, returnShipping: Money | null) {
    const costs = (order.shippingFee ?? 0) + (returnShipping?.amount ?? 0);
    await this.escrow.chargeDisputeCosts(tx, {
      orderId: order.id,
      sellerId: order.sellerId,
      amount: money(costs, order.currency),
    });
  }

  /** Wina przewoźnika (§7.5 pkt 5): rekompensata od razu i reklamacja przesyłki do kupującego. */
  private async compensateSeller(
    tx: Transaction,
    { order }: LockedOrder,
    claimType: 'LOST' | 'DAMAGED',
    now: Date,
  ): Promise<void> {
    await this.lifecycle.compensate(tx, order, now);
    const shipment = await this.shipments.forOrder(order.id);
    if (shipment === undefined || shipment.shipment.providerShipmentId === null) {
      this.logger.warn(
        { orderId: order.id },
        'Spór z winy przewoźnika bez nadanej przesyłki: reklamacja do złożenia ręcznie',
      );
      return;
    }
    if ((await this.claims.forShipment(shipment.shipment.id)) !== undefined) {
      return;
    }
    await this.claims.open(
      {
        shipmentId: shipment.shipment.id,
        type: claimType,
        claimedAmount: order.itemsTotal,
        note: `Spór o zamówienie ${order.publicId}: decyzja zespołu Biddy (wina przewoźnika).`,
      },
      tx,
    );
  }
}

function disputedOrder(order: Order, auctionId: string, title: string): DisputedOrder {
  return {
    orderId: order.id,
    publicId: order.publicId,
    auctionId,
    buyerId: order.buyerId,
    sellerId: order.sellerId,
    title,
    photoUrl: null,
    amounts: {
      itemsTotal: money(order.itemsTotal, order.currency),
      pokFee: money(order.pokFee, order.currency),
      shippingFee: money(order.shippingFee ?? 0, order.currency),
      total: money(order.total, order.currency),
    },
  };
}
