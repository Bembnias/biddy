// Widok sporu dla stron i personelu (F-28): spór z historią, przesyłka zwrotna z trackingiem,
// wycena zwrotu (sprzedający przed odpowiedzią), stan zwrotu pieniędzy i koszty sprzedającego.
// Zdjęcia z historii wydaje API (prywatne, decyzja nr 133), więc widok zna tylko ich ID.
import { type Money, money } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';

import { MediaService } from '../../media/index.js';
import { RefundService, type RefundRow } from '../../payments/index.js';
import {
  type ShipmentDetails,
  ShipmentService,
  type ShippingOption,
} from '../../shipping/index.js';
import type { DisputeEventRow, DisputeRow } from '../db/disputes.schema.js';
import { DisputeService } from './dispute.service.js';
import { refundOf, sellerCosts, storedDecision } from './dispute-transitions.js';

/** Kto ogląda spór: strona albo personel. */
export type DisputeViewer = 'BUYER' | 'SELLER' | 'STAFF';

export interface DisputeView {
  readonly dispute: DisputeRow;
  readonly viewer: DisputeViewer;
  readonly events: readonly DisputeEventRow[];
  readonly returnShipment: ShipmentDetails | undefined;
  /** Usługa i cena zwrotu dla sprzedającego przed odpowiedzią (null, gdy zwrot niemożliwy). */
  readonly returnQuote: ShippingOption | null | undefined;
  /** Kwota dla kupującego z rozstrzygnięcia (także przed weryfikacją zwrotu). */
  readonly refundAmount: Money | null;
  /** Ostatni zwrot pieniędzy po sporze (stan u operatora). */
  readonly refund: RefundRow | undefined;
  /** Dostawa w obie strony potrącona sprzedającemu (wina sprzedającego). */
  readonly sellerCosts: Money | null;
}

@Injectable()
export class DisputeViewService {
  constructor(
    private readonly disputes: DisputeService,
    private readonly shipments: ShipmentService,
    private readonly refunds: RefundService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  async view(dispute: DisputeRow, viewer: DisputeViewer): Promise<DisputeView> {
    const [events, returnShipment, refunds] = await Promise.all([
      this.disputes.events(dispute.id),
      dispute.returnShipmentId === null
        ? Promise.resolve(undefined)
        : this.shipments.details(dispute.returnShipmentId),
      this.refunds.forOrder(dispute.orderId),
    ]);
    const returnQuote =
      viewer !== 'BUYER' && dispute.status === 'AWAITING_SELLER'
        ? ((await this.shipments.returnQuote(dispute.orderId)) ?? null)
        : undefined;
    const fullRefundBySeller = dispute.outcome === 'FULL_REFUND' && dispute.fault === 'SELLER';
    const returnPrice =
      returnShipment !== undefined && dispute.returnShippedAt !== null
        ? money(returnShipment.shipment.price, returnShipment.shipment.currency)
        : null;
    return {
      dispute,
      viewer,
      events,
      returnShipment,
      returnQuote,
      refundAmount: dispute.outcome === null ? null : refundOf(dispute, storedDecision(dispute)),
      refund: refunds.findLast(
        (row) => row.reason === 'DISPUTE' || row.reason === 'DISPUTE_PARTIAL',
      ),
      sellerCosts:
        viewer !== 'BUYER' && fullRefundBySeller && dispute.status === 'RESOLVED'
          ? sellerCosts(dispute, returnPrice)
          : null,
    };
  }

  /**
   * Wariant zdjęcia ze sporu dla strony albo personelu: tylko zdjęcia z historii tego sporu.
   * undefined, gdy zdjęcia nie ma w sporze albo pliku nie ma w magazynie.
   */
  async photo(
    dispute: DisputeRow,
    mediaId: string,
    variant: string,
  ): Promise<{ readonly data: Buffer; readonly contentType: string } | undefined> {
    const events = await this.disputes.events(dispute.id);
    if (!events.some((event) => event.mediaIds.includes(mediaId))) {
      return undefined;
    }
    return this.media.privateVariant(mediaId, variant);
  }
}
