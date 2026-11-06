// Przejścia sporu wspólne dla akcji stron, decyzji personelu i jobów terminów (F-28, PROJECT.md
// §7.5, §7.9). Każda metoda działa w transakcji wywołującego na zablokowanym sporze:
// - escalate: ESCALATED z terminem decyzji (72 h) i powiadomieniem obu stron;
// - requestReturn: AWAITING_RETURN z przesyłką zwrotną i terminem nadania (5 dni roboczych);
//   rozstrzygnięcie FULL_REFUND jest już zapisane i wykona się po weryfikacji zwrotu;
// - resolve: RESOLVED z rozstrzygnięciem, rozliczenie zamówienia (OrderDisputes.settle w tej samej
//   transakcji) i strike za przegraną po decyzji personelu (wina sprzedającego, F-61).
import {
  type DisputeActor,
  type DisputeDecider,
  type DisputeEscalationCause,
  type DisputeFault,
  type DisputeOutcome,
  type Money,
  money,
} from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { Transaction } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { StrikeService, TradeHistoryService } from '../../identity/index.js';
import { type DisputeSettlement, OrderDisputes } from '../../orders/index.js';
import { ShipmentService } from '../../shipping/index.js';
import type { DisputeRow } from '../db/disputes.schema.js';
import {
  carrierClaimType,
  decisionDueAt,
  outcomeSummary,
  returnShipBy,
} from '../domain/dispute-rules.js';
import { DisputeEscalated, DisputeResolved, DisputeReturnRequested } from '../disputes.events.js';
import { addDisputeEvent, transitionDispute } from './dispute-records.js';

/** Rozstrzygnięcie z uzasadnieniem (zapis w sporze i wykonanie na zamówieniu). */
export interface DisputeDecision {
  readonly outcome: DisputeOutcome;
  readonly fault: DisputeFault | null;
  /** Zwrot częściowy w groszach; null przy innych rozstrzygnięciach. */
  readonly refundAmount: number | null;
  readonly decidedBy: DisputeDecider;
  readonly decidedByStaffId: string | null;
  readonly statement: string;
}

/** Kto wywołał przejście (wpis w historii). */
export interface DisputeActorRef {
  readonly actor: DisputeActor;
  readonly actorId: string | null;
}

export const SYSTEM_ACTOR: DisputeActorRef = { actor: 'SYSTEM', actorId: null };

/** Pola wspólne eventów sporu. */
export function disputeParties(dispute: DisputeRow) {
  return {
    orderId: dispute.orderId,
    orderPublicId: dispute.orderPublicId,
    buyerId: dispute.buyerId,
    sellerId: dispute.sellerId,
    title: dispute.title,
  };
}

/** Kolumny rozstrzygnięcia w sporze. */
function decisionColumns(decision: DisputeDecision, now: Date) {
  return {
    outcome: decision.outcome,
    fault: decision.fault,
    refundAmount: decision.refundAmount,
    decidedBy: decision.decidedBy,
    decidedByStaffId: decision.decidedByStaffId,
    statement: decision.statement,
    decidedAt: now,
  };
}

/** Rozstrzygnięcie zapisane w sporze (np. przed weryfikacją zwrotu). */
export function storedDecision(dispute: DisputeRow): DisputeDecision {
  if (dispute.outcome === null || dispute.decidedBy === null || dispute.statement === null) {
    throw new Error(`Spór ${dispute.id} (${dispute.status}) bez zapisanego rozstrzygnięcia`);
  }
  return {
    outcome: dispute.outcome,
    fault: dispute.fault,
    refundAmount: dispute.refundAmount,
    decidedBy: dispute.decidedBy,
    decidedByStaffId: dispute.decidedByStaffId,
    statement: dispute.statement,
  };
}

@Injectable()
export class DisputeTransitions {
  constructor(
    private readonly orders: OrderDisputes,
    private readonly shipments: ShipmentService,
    @Inject(StrikeService) private readonly strikes: StrikeService,
    @Inject(TradeHistoryService) private readonly trades: TradeHistoryService,
    private readonly outbox: Outbox,
  ) {}

  async escalate(
    tx: Transaction,
    dispute: DisputeRow,
    cause: DisputeEscalationCause,
    by: DisputeActorRef,
    now: Date,
    entry: { readonly note?: string | null; readonly mediaIds?: readonly string[] } = {},
  ): Promise<DisputeRow> {
    const due = decisionDueAt(now);
    const updated = await transitionDispute(
      tx,
      dispute,
      'ESCALATED',
      { escalatedAt: now, decisionDueAt: due, responseDueAt: null },
      now,
    );
    await addDisputeEvent(
      tx,
      dispute.id,
      {
        type: escalationEventType(cause),
        ...by,
        note: entry.note ?? null,
        mediaIds: entry.mediaIds ?? [],
      },
      now,
    );
    if (escalationEventType(cause) !== 'ESCALATED') {
      await addDisputeEvent(tx, dispute.id, { type: 'ESCALATED', ...SYSTEM_ACTOR }, now);
    }
    await this.outbox.add(
      tx,
      DisputeEscalated.create({
        aggregateId: dispute.id,
        payload: { ...disputeParties(dispute), cause, decisionDueAt: due.toISOString() },
      }),
    );
    return updated;
  }

  /**
   * Zwrot z odesłaniem: rozstrzygnięcie FULL_REFUND zapisane od razu, wykonanie po weryfikacji
   * zwrotu. `returnShipmentId`: przesyłka przygotowana przed transakcją (`prepareReturn`).
   */
  async requestReturn(
    tx: Transaction,
    dispute: DisputeRow,
    decision: DisputeDecision,
    returnShipmentId: string,
    now: Date,
  ): Promise<DisputeRow> {
    const shipBy = returnShipBy(now);
    const updated = await transitionDispute(
      tx,
      dispute,
      'AWAITING_RETURN',
      {
        ...decisionColumns(decision, now),
        returnRequired: true,
        returnShipmentId,
        returnShipBy: shipBy,
        responseDueAt: null,
      },
      now,
    );
    await this.outbox.add(
      tx,
      DisputeReturnRequested.create({
        aggregateId: dispute.id,
        payload: {
          ...disputeParties(dispute),
          returnShipBy: shipBy.toISOString(),
          decidedBy: decision.decidedBy,
        },
      }),
    );
    return updated;
  }

  /**
   * Rozstrzygnięcie: RESOLVED, rozliczenie zamówienia i (po decyzji personelu na korzyść
   * kupującego z winy sprzedającego) strike `DISPUTE_LOST` z wpisem przegranego sporu.
   */
  async resolve(
    tx: Transaction,
    dispute: DisputeRow,
    decision: DisputeDecision,
    now: Date,
  ): Promise<DisputeRow> {
    const settlement = await this.settlement(dispute, decision);
    const updated = await transitionDispute(
      tx,
      dispute,
      'RESOLVED',
      { ...decisionColumns(decision, now), resolvedAt: now, responseDueAt: null },
      now,
    );
    await this.orders.settle(tx, dispute.orderId, settlement, now);
    const refund = refundOf(dispute, decision);
    await addDisputeEvent(
      tx,
      dispute.id,
      {
        type: 'RESOLVED',
        ...SYSTEM_ACTOR,
        note: outcomeSummary(decision.outcome, refund),
        amount: refund?.amount ?? null,
      },
      now,
    );
    if (decision.decidedBy === 'STAFF' && decision.fault === 'SELLER') {
      const parties = {
        orderId: dispute.orderId,
        buyerId: dispute.buyerId,
        sellerId: dispute.sellerId,
      };
      await this.strikes.issue(tx, {
        userId: dispute.sellerId,
        reason: 'DISPUTE_LOST',
        sourceKey: `DISPUTE_LOST:${dispute.orderId}`,
        orderId: dispute.orderId,
        context: { orderPublicId: dispute.orderPublicId, title: dispute.title },
      });
      await this.trades.recordDisputeLost(tx, parties, now);
    }
    await this.outbox.add(
      tx,
      DisputeResolved.create({
        aggregateId: dispute.id,
        payload: {
          ...disputeParties(dispute),
          outcome: decision.outcome,
          fault: decision.fault,
          refund,
          sellerCosts:
            settlement.outcome === 'FULL_REFUND' && settlement.fault === 'SELLER'
              ? sellerCosts(dispute, settlement.returnShipping)
              : null,
          decidedBy: decision.decidedBy,
          statement: decision.statement,
        },
      }),
    );
    return updated;
  }

  /** Rozliczenie zamówienia dla rozstrzygnięcia (cena zwrotu tylko, gdy zwrot był nadany). */
  private async settlement(
    dispute: DisputeRow,
    decision: DisputeDecision,
  ): Promise<DisputeSettlement> {
    switch (decision.outcome) {
      case 'SELLER_FAVOR':
        return { outcome: 'SELLER_FAVOR' };
      case 'PARTIAL_REFUND':
        if (decision.refundAmount === null) {
          throw new Error(`Spór ${dispute.id}: zwrot częściowy bez kwoty`);
        }
        return {
          outcome: 'PARTIAL_REFUND',
          amount: money(decision.refundAmount, dispute.currency),
        };
      case 'FULL_REFUND':
        return decision.fault === 'CARRIER'
          ? {
              outcome: 'FULL_REFUND',
              fault: 'CARRIER',
              claimType: carrierClaimType(dispute.reason),
            }
          : {
              outcome: 'FULL_REFUND',
              fault: 'SELLER',
              returnShipping: await this.returnPrice(dispute),
            };
    }
  }

  private async returnPrice(dispute: DisputeRow): Promise<Money | null> {
    if (dispute.returnShipmentId === null || dispute.returnShippedAt === null) {
      return null;
    }
    const shipment = await this.shipments.details(dispute.returnShipmentId);
    return shipment === undefined
      ? null
      : money(shipment.shipment.price, shipment.shipment.currency);
  }
}

/** Dostawa do kupującego i zwrot po stronie sprzedającego (jak w OrderDisputes.settle). */
export function sellerCosts(dispute: DisputeRow, returnShipping: Money | null): Money {
  return money(dispute.shippingFee + (returnShipping?.amount ?? 0), dispute.currency);
}

/** Wpis w historii dla przyczyny eskalacji (akcja strony albo sam fakt eskalacji). */
function escalationEventType(cause: DisputeEscalationCause) {
  switch (cause) {
    case 'SELLER_REJECTED':
      return 'SELLER_REJECTED';
    case 'OFFER_REJECTED':
      return 'PARTIAL_REJECTED';
    case 'RETURN_CONTESTED':
      return 'RETURN_CONTESTED';
    case 'SELLER_SILENT':
    case 'BUYER_SILENT':
    case 'RETURN_FAILED':
      return 'ESCALATED';
  }
}

/** Kwota dla kupującego: zwrot częściowy, pełna kwota zamówienia albo null. */
export function refundOf(dispute: DisputeRow, decision: DisputeDecision): Money | null {
  switch (decision.outcome) {
    case 'SELLER_FAVOR':
      return null;
    case 'PARTIAL_REFUND':
      return decision.refundAmount === null ? null : money(decision.refundAmount, dispute.currency);
    case 'FULL_REFUND':
      return money(dispute.orderTotal, dispute.currency);
  }
}
