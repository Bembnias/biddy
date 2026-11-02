// Widok zamówienia dla obu stron (F-26): stan z datami etapów, przedmiot ze snapshotu, druga
// strona, przesyłka z trackingiem, ostatni zwrot, dostępne akcje i (dla sprzedającego
// anulowanego zamówienia) stan drugiej szansy.
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { ProfileService } from '../../identity/index.js';
import { RefundService, type RefundRow } from '../../payments/index.js';
import { type ShipmentDetails, ShipmentService } from '../../shipping/index.js';
import { type OrderItem, orderItems } from '../db/orders.schema.js';
import { notReceivedBlocker, notReceivedFrom } from '../domain/lifecycle-rules.js';
import {
  type SecondChanceState,
  SecondChanceService,
} from '../second-chance/second-chance.service.js';
import { OrderService, type ParticipantOrder } from './order.service.js';

export interface OrderDetails extends ParticipantOrder {
  readonly item: OrderItem;
  readonly counterpartName: string;
  readonly shipment: ShipmentDetails | undefined;
  /** Ostatni zwrot zamówienia (bez nieudanych przed udanym). */
  readonly refund: RefundRow | undefined;
  /** Zgłoszenie braku paczki: od kiedy (null, gdy nie dotyczy) i czy już można. */
  readonly notReceived: { readonly from: Date; readonly allowed: boolean } | null;
  readonly secondChance: SecondChanceState | undefined;
}

@Injectable()
export class OrderDetailsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly orders: OrderService,
    private readonly shipments: ShipmentService,
    private readonly refunds: RefundService,
    private readonly secondChance: SecondChanceService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  async forParticipant(idOrPublicId: string, userId: string): Promise<OrderDetails> {
    const participant = await this.orders.forParticipant(idOrPublicId, userId);
    const { order, role } = participant;
    const [item] = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.createdAt))
      .limit(1);
    if (item === undefined) {
      throw new Error(`Zamówienie ${order.id} bez pozycji`);
    }
    const counterpartId = role === 'BUYER' ? order.sellerId : order.buyerId;
    const names = await this.profiles.displayNames([counterpartId]);
    const shipment = await this.shipments.forOrder(order.id);
    const refunds = await this.refunds.forOrder(order.id);
    const refund =
      refunds.findLast((row) => row.status !== 'FAILED') ?? refunds[refunds.length - 1];
    const now = new Date();
    return {
      ...participant,
      item,
      counterpartName: names.get(counterpartId) ?? '',
      shipment,
      refund,
      notReceived:
        role === 'BUYER' && order.status === 'SHIPPED' && order.shippedAt !== null
          ? {
              from: notReceivedFrom(order.shippedAt),
              allowed: notReceivedBlocker(order, shipment?.shipment.status, now) === undefined,
            }
          : null,
      secondChance:
        role === 'SELLER' && order.status === 'CANCELLED_UNPAID'
          ? await this.secondChance.state(order, item, now)
          : undefined,
    };
  }
}
