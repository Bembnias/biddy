// Spór od strony użytkowników i personelu (F-28, PROJECT.md §7.5): zgłoszenie w oknie 36 h,
// odpowiedź sprzedającego (zwrot z odesłaniem albo bez, propozycja zwrotu części ceny,
// odrzucenie), odpowiedź kupującego na propozycję, wyjaśnienia stron, nadanie i weryfikacja zwrotu
// oraz decyzja personelu po eskalacji. Każda zmiana blokuje wiersz sporu i sprawdza stan; akcja,
// która nie pasuje do stanu, dostaje 409 DISPUTE_STATE_CHANGED. Terminy pilnują joby
// (dispute-deadlines.ts), a pieniądze rusza moduł orders (OrderDisputes) w tych samych transakcjach.
import {
  disputeReasonRequiresPhoto,
  type DisputeFault,
  type DisputeOutcome,
  type DisputeReason,
  type DisputeStatus,
  money,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { MediaService } from '../../media/index.js';
import { type DisputeParticipant, OrderDisputes } from '../../orders/index.js';
import { type DispatchInput, ShipmentService } from '../../shipping/index.js';
import { disputeEvents, type DisputeRow, disputes } from '../db/disputes.schema.js';
import { responseDueAt, SYSTEM_STATEMENTS } from '../domain/dispute-rules.js';
import { DisputeOpened, DisputePartialOffered } from '../disputes.events.js';
import {
  addDisputeEvent,
  disputeNotFound,
  lockDispute,
  stateChanged,
  transitionDispute,
} from './dispute-records.js';
import {
  type DisputeActorRef,
  type DisputeDecision,
  DisputeTransitions,
  disputeParties,
  storedDecision,
} from './dispute-transitions.js';

export type DisputeRole = 'BUYER' | 'SELLER';

export interface OpenDisputeInput {
  readonly reason: DisputeReason;
  readonly description: string;
  readonly mediaIds: readonly string[];
}

export type SellerResponseInput =
  | { readonly action: 'ACCEPT'; readonly returnRequired: boolean; readonly note?: string }
  | { readonly action: 'OFFER_PARTIAL'; readonly amount: number; readonly note?: string }
  | { readonly action: 'REJECT'; readonly note: string; readonly mediaIds?: readonly string[] };

export interface OfferResponseInput {
  readonly accept: boolean;
  readonly note?: string;
}

export interface ReturnReviewInput {
  readonly accept: boolean;
  readonly note?: string;
  readonly mediaIds?: readonly string[];
}

export interface CommentInput {
  readonly note: string;
  readonly mediaIds?: readonly string[];
}

export interface DecisionInput {
  readonly outcome: DisputeOutcome;
  readonly fault?: DisputeFault;
  readonly returnRequired?: boolean;
  readonly amount?: number;
  readonly statement: string;
}

export type ShipReturnInput = Pick<DispatchInput, 'sender' | 'dispatchMethod'>;

/** Spór oglądany przez stronę. */
export interface PartyDispute {
  readonly dispute: DisputeRow;
  readonly role: DisputeRole;
}

/** Najmniej znaków wyjaśnienia odrzucenia i zakwestionowania zwrotu. */
const EXPLANATION_MIN = 10;

function invalid(path: string, message: string): DomainError {
  return new DomainError({
    code: 'VALIDATION_FAILED',
    errors: [{ path, code: 'custom', message }],
  });
}

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly orders: OrderDisputes,
    private readonly transitions: DisputeTransitions,
    private readonly shipments: ShipmentService,
    @Inject(MediaService) private readonly media: MediaService,
    private readonly outbox: Outbox,
  ) {}

  // --- Odczyt ---

  /** Spór zamówienia dla strony; brak sporu albo obca osoba: 404. */
  async forOrder(
    idOrPublicId: string,
    userId: string,
  ): Promise<PartyDispute & { readonly order: DisputeParticipant }> {
    const order = await this.orders.participant(idOrPublicId, userId);
    const dispute = await this.byOrder(order.orderId);
    if (dispute === undefined) {
      throw disputeNotFound();
    }
    return { dispute, role: order.role, order };
  }

  /** Spór dla strony; obca osoba: 404. */
  async forParty(disputeId: string, userId: string): Promise<PartyDispute> {
    const dispute = await this.byId(disputeId);
    const role = dispute === undefined ? undefined : roleOf(dispute, userId);
    if (dispute === undefined || role === undefined) {
      throw disputeNotFound();
    }
    return { dispute, role };
  }

  async byId(disputeId: string): Promise<DisputeRow | undefined> {
    const [dispute] = await this.db.select().from(disputes).where(eq(disputes.id, disputeId));
    return dispute;
  }

  async byOrder(orderId: string): Promise<DisputeRow | undefined> {
    const [dispute] = await this.db.select().from(disputes).where(eq(disputes.orderId, orderId));
    return dispute;
  }

  /** Historia sporu, najstarsze wpisy pierwsze. */
  async events(disputeId: string) {
    return this.db
      .select()
      .from(disputeEvents)
      .where(eq(disputeEvents.disputeId, disputeId))
      .orderBy(asc(disputeEvents.createdAt), asc(disputeEvents.id));
  }

  /** Spory w danym stanie dla personelu, najstarsza zmiana pierwsza (kolejka eskalacji). */
  async queue(status: DisputeStatus, limit = 100): Promise<DisputeRow[]> {
    return this.db
      .select()
      .from(disputes)
      .where(eq(disputes.status, status))
      .orderBy(asc(status === 'ESCALATED' ? disputes.escalatedAt : disputes.updatedAt))
      .limit(limit);
  }

  // --- Zgłoszenie ---

  /**
   * Zgłoszenie problemu przez kupującego. Ponowienie zwraca istniejący spór (`created: false`).
   *
   * @throws {DomainError} NOT_FOUND (nie kupujący), VALIDATION_FAILED (brak zdjęcia, zdjęcia
   *   niegotowe), DISPUTE_UNAVAILABLE, DISPUTE_WINDOW_CLOSED, ORDER_ON_HOLD
   */
  async open(
    idOrPublicId: string,
    userId: string,
    input: OpenDisputeInput,
  ): Promise<{ readonly dispute: DisputeRow; readonly created: boolean }> {
    const order = await this.orders.participant(idOrPublicId, userId);
    if (order.role !== 'BUYER') {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
    }
    const existing = await this.byOrder(order.orderId);
    if (existing !== undefined) {
      return { dispute: existing, created: false };
    }
    if (disputeReasonRequiresPhoto(input.reason) && input.mediaIds.length === 0) {
      throw invalid('mediaIds', 'Dodaj co najmniej jedno zdjęcie problemu.');
    }
    const now = new Date();
    try {
      const dispute = await this.db.transaction(async (tx) => {
        const disputed = await this.orders.open(tx, order.orderId, now);
        const due = responseDueAt(now);
        const [created] = await tx
          .insert(disputes)
          .values({
            orderId: disputed.orderId,
            orderPublicId: disputed.publicId,
            title: disputed.title,
            buyerId: disputed.buyerId,
            sellerId: disputed.sellerId,
            currency: disputed.amounts.itemsTotal.currency,
            itemsTotal: disputed.amounts.itemsTotal.amount,
            shippingFee: disputed.amounts.shippingFee.amount,
            orderTotal: disputed.amounts.total.amount,
            reason: input.reason,
            description: input.description,
            responseDueAt: due,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (created === undefined) {
          throw new Error(`Nie zapisano sporu zamówienia ${disputed.orderId}`);
        }
        await this.media.attach(userId, input.mediaIds, 'DISPUTE_EVIDENCE', tx);
        await addDisputeEvent(
          tx,
          created.id,
          {
            type: 'OPENED',
            actor: 'BUYER',
            actorId: userId,
            note: input.description,
            mediaIds: input.mediaIds,
          },
          now,
        );
        await this.outbox.add(
          tx,
          DisputeOpened.create({
            aggregateId: created.id,
            payload: {
              ...disputeParties(created),
              reason: input.reason,
              responseDueAt: due.toISOString(),
            },
          }),
        );
        return created;
      });
      this.logger.log(
        { disputeId: dispute.id, orderId: dispute.orderId, reason: dispute.reason },
        'Kupujący zgłosił problem z zamówieniem',
      );
      return { dispute, created: true };
    } catch (error) {
      // Równoległe zgłoszenie: drugie czeka na blokadę zamówienia i widzi już DISPUTED.
      if (error instanceof DomainError && error.code === 'DISPUTE_UNAVAILABLE') {
        const concurrent = await this.byOrder(order.orderId);
        if (concurrent !== undefined) {
          return { dispute: concurrent, created: false };
        }
      }
      throw error;
    }
  }

  // --- Odpowiedzi stron ---

  /**
   * Odpowiedź sprzedającego w 48 h: zwrot (z odesłaniem albo bez), propozycja zwrotu części ceny
   * albo odrzucenie (eskalacja).
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_STATE_CHANGED, VALIDATION_FAILED,
   *   RETURN_SHIPPING_UNAVAILABLE
   */
  async respondAsSeller(
    disputeId: string,
    userId: string,
    input: SellerResponseInput,
  ): Promise<DisputeRow> {
    const { dispute: found } = await this.asRole(disputeId, userId, 'SELLER');
    if (found.status !== 'AWAITING_SELLER') {
      throw stateChanged(found.status);
    }
    if (input.action === 'OFFER_PARTIAL' && input.amount > found.itemsTotal) {
      throw invalid('amount', 'Zwrot nie może być większy niż cena przedmiotu.');
    }
    if (input.action === 'REJECT' && input.note.trim().length < EXPLANATION_MIN) {
      throw invalid('note', `Wyjaśnij odrzucenie (co najmniej ${String(EXPLANATION_MIN)} znaków).`);
    }
    // Przesyłkę zwrotną przygotowujemy przed transakcją (moduł shipping ma własne zapisy);
    // nieużyta zostaje PENDING i wraca przy kolejnej próbie.
    const returnShipment =
      input.action === 'ACCEPT' && input.returnRequired
        ? await this.shipments.prepareReturn(found.orderId)
        : undefined;
    const by: DisputeActorRef = { actor: 'SELLER', actorId: userId };
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const dispute = await this.lockInState(tx, disputeId, 'AWAITING_SELLER');
      switch (input.action) {
        case 'ACCEPT': {
          await addDisputeEvent(
            tx,
            dispute.id,
            { type: 'SELLER_ACCEPTED', ...by, note: input.note ?? null },
            now,
          );
          const decision = partiesDecision(
            'FULL_REFUND',
            returnShipment === undefined
              ? SYSTEM_STATEMENTS.sellerAccepted
              : SYSTEM_STATEMENTS.sellerAcceptedWithReturn,
          );
          return returnShipment === undefined
            ? this.transitions.resolve(tx, dispute, decision, now)
            : this.transitions.requestReturn(
                tx,
                dispute,
                decision,
                returnShipment.shipment.id,
                now,
              );
        }
        case 'OFFER_PARTIAL': {
          const due = responseDueAt(now);
          const updated = await transitionDispute(
            tx,
            dispute,
            'PARTIAL_OFFERED',
            { partialOfferAmount: input.amount, responseDueAt: due },
            now,
          );
          await addDisputeEvent(
            tx,
            dispute.id,
            { type: 'PARTIAL_OFFERED', ...by, note: input.note ?? null, amount: input.amount },
            now,
          );
          await this.outbox.add(
            tx,
            DisputePartialOffered.create({
              aggregateId: dispute.id,
              payload: {
                ...disputeParties(dispute),
                amount: money(input.amount, dispute.currency),
                responseDueAt: due.toISOString(),
              },
            }),
          );
          return updated;
        }
        case 'REJECT': {
          const mediaIds = input.mediaIds ?? [];
          await this.media.attach(userId, mediaIds, 'DISPUTE_EVIDENCE', tx);
          return this.transitions.escalate(tx, dispute, 'SELLER_REJECTED', by, now, {
            note: input.note,
            mediaIds,
          });
        }
      }
    });
  }

  /**
   * Odpowiedź kupującego na propozycję zwrotu części ceny: przyjęcie kończy spór, odrzucenie
   * przekazuje go do Biddy.
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_STATE_CHANGED
   */
  async answerOffer(
    disputeId: string,
    userId: string,
    input: OfferResponseInput,
  ): Promise<DisputeRow> {
    await this.asRole(disputeId, userId, 'BUYER');
    const by: DisputeActorRef = { actor: 'BUYER', actorId: userId };
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const dispute = await this.lockInState(tx, disputeId, 'PARTIAL_OFFERED');
      if (!input.accept) {
        return this.transitions.escalate(tx, dispute, 'OFFER_REJECTED', by, now, {
          note: input.note ?? null,
        });
      }
      const amount = dispute.partialOfferAmount;
      if (amount === null) {
        throw new Error(`Spór ${dispute.id}: propozycja bez kwoty`);
      }
      await addDisputeEvent(
        tx,
        dispute.id,
        { type: 'PARTIAL_ACCEPTED', ...by, note: input.note ?? null, amount },
        now,
      );
      return this.transitions.resolve(
        tx,
        dispute,
        {
          ...partiesDecision(
            'PARTIAL_REFUND',
            SYSTEM_STATEMENTS.partialAccepted(money(amount, dispute.currency)),
          ),
          refundAmount: amount,
        },
        now,
      );
    });
  }

  /**
   * Wyjaśnienie strony (notatka i zdjęcia) przed rozstrzygnięciem.
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_STATE_CHANGED, VALIDATION_FAILED (zdjęcia)
   */
  async comment(disputeId: string, userId: string, input: CommentInput): Promise<DisputeRow> {
    const { role } = await this.forParty(disputeId, userId);
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const dispute = await lockDispute(tx, disputeId);
      if (dispute === undefined) {
        throw disputeNotFound();
      }
      if (dispute.status === 'RESOLVED') {
        throw stateChanged(dispute.status);
      }
      const mediaIds = input.mediaIds ?? [];
      await this.media.attach(userId, mediaIds, 'DISPUTE_EVIDENCE', tx);
      await addDisputeEvent(
        tx,
        dispute.id,
        { type: 'COMMENT', actor: role, actorId: userId, note: input.note, mediaIds },
        now,
      );
      return dispute;
    });
  }

  // --- Zwrot z odesłaniem ---

  /**
   * „Nadaj zwrot” kupującego: dane nadawcy i sposób nadania, a przesyłkę u dostawcy tworzy worker
   * (F-24). Stan sporu zmienia dopiero tracking (nadanie u przewoźnika).
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_STATE_CHANGED, VALIDATION_FAILED (dane nadawcy),
   *   DISPATCH_METHOD_UNAVAILABLE
   */
  async shipReturn(disputeId: string, userId: string, input: ShipReturnInput): Promise<DisputeRow> {
    const { dispute } = await this.asRole(disputeId, userId, 'BUYER');
    if (dispute.status !== 'AWAITING_RETURN' || dispute.returnShipmentId === null) {
      throw stateChanged(dispute.status);
    }
    await this.shipments.dispatch(dispute.returnShipmentId, {
      ...input,
      declaredValue: money(dispute.itemsTotal, dispute.currency),
      reference: `${dispute.orderPublicId}-Z`,
    });
    return dispute;
  }

  /** Etykieta zwrotu (PDF) dla kupującego; undefined, gdy jeszcze jej nie ma. */
  async returnLabel(disputeId: string, userId: string): Promise<Buffer | undefined> {
    const { dispute } = await this.asRole(disputeId, userId, 'BUYER');
    return dispute.returnShipmentId === null
      ? undefined
      : this.shipments.label(dispute.returnShipmentId);
  }

  /**
   * Weryfikacja zwrotu przez sprzedającego: przyjęcie wykonuje zapisane rozstrzygnięcie (pełny
   * zwrot), zakwestionowanie przekazuje spór do Biddy.
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_STATE_CHANGED, VALIDATION_FAILED
   */
  async reviewReturn(
    disputeId: string,
    userId: string,
    input: ReturnReviewInput,
  ): Promise<DisputeRow> {
    await this.asRole(disputeId, userId, 'SELLER');
    if (!input.accept && (input.note?.trim().length ?? 0) < EXPLANATION_MIN) {
      throw invalid(
        'note',
        `Opisz problem ze zwrotem (co najmniej ${String(EXPLANATION_MIN)} znaków).`,
      );
    }
    const by: DisputeActorRef = { actor: 'SELLER', actorId: userId };
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const dispute = await this.lockInState(tx, disputeId, 'RETURN_DELIVERED');
      if (!input.accept) {
        const mediaIds = input.mediaIds ?? [];
        await this.media.attach(userId, mediaIds, 'DISPUTE_EVIDENCE', tx);
        return this.transitions.escalate(tx, dispute, 'RETURN_CONTESTED', by, now, {
          note: input.note ?? null,
          mediaIds,
        });
      }
      await addDisputeEvent(
        tx,
        dispute.id,
        { type: 'RETURN_ACCEPTED', ...by, note: input.note ?? null },
        now,
      );
      return this.transitions.resolve(tx, dispute, storedDecision(dispute), now);
    });
  }

  // --- Decyzja personelu ---

  /**
   * Decyzja zespołu Biddy w sporze po eskalacji, z uzasadnieniem dla stron (DSA).
   *
   * @throws {DomainError} NOT_FOUND, DISPUTE_NOT_ESCALATED, VALIDATION_FAILED,
   *   RETURN_SHIPPING_UNAVAILABLE
   */
  async decide(disputeId: string, staffId: string, input: DecisionInput): Promise<DisputeRow> {
    const found = await this.byId(disputeId);
    if (found === undefined) {
      throw disputeNotFound();
    }
    if (found.status !== 'ESCALATED') {
      throw new DomainError({
        code: 'DISPUTE_NOT_ESCALATED',
        extensions: { status: found.status },
      });
    }
    const decision = staffDecision(found, staffId, input);
    const returnShipment =
      input.returnRequired === true ? await this.shipments.prepareReturn(found.orderId) : undefined;
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const dispute = await lockDispute(tx, disputeId);
      if (dispute?.status !== 'ESCALATED') {
        throw new DomainError({
          code: 'DISPUTE_NOT_ESCALATED',
          extensions: { status: dispute?.status ?? null },
        });
      }
      await addDisputeEvent(
        tx,
        dispute.id,
        {
          type: 'DECISION',
          actor: 'STAFF',
          actorId: staffId,
          note: decision.statement,
          amount: decision.refundAmount,
        },
        now,
      );
      return returnShipment === undefined
        ? this.transitions.resolve(tx, dispute, decision, now)
        : this.transitions.requestReturn(tx, dispute, decision, returnShipment.shipment.id, now);
    });
  }

  // --- Wspólne ---

  private async asRole(
    disputeId: string,
    userId: string,
    role: DisputeRole,
  ): Promise<PartyDispute> {
    const party = await this.forParty(disputeId, userId);
    if (party.role !== role) {
      throw disputeNotFound();
    }
    return party;
  }

  private async lockInState(
    tx: Transaction,
    disputeId: string,
    status: DisputeStatus,
  ): Promise<DisputeRow> {
    const dispute = await lockDispute(tx, disputeId);
    if (dispute === undefined) {
      throw disputeNotFound();
    }
    if (dispute.status !== status) {
      throw stateChanged(dispute.status);
    }
    return dispute;
  }
}

/** Rola użytkownika w sporze albo undefined (obca osoba). */
export function roleOf(dispute: DisputeRow, userId: string): DisputeRole | undefined {
  if (dispute.buyerId === userId) {
    return 'BUYER';
  }
  return dispute.sellerId === userId ? 'SELLER' : undefined;
}

/** Porozumienie stron: wina sprzedającego przy pełnym zwrocie (decyzja nr 129). */
function partiesDecision(outcome: DisputeOutcome, statement: string): DisputeDecision {
  return {
    outcome,
    fault: outcome === 'FULL_REFUND' ? 'SELLER' : null,
    refundAmount: null,
    decidedBy: 'PARTIES',
    decidedByStaffId: null,
    statement,
  };
}

/** Decyzja personelu po walidacji pól zależnych od rozstrzygnięcia. */
function staffDecision(
  dispute: DisputeRow,
  staffId: string,
  input: DecisionInput,
): DisputeDecision {
  if (input.outcome === 'FULL_REFUND' && input.fault === undefined) {
    throw invalid('fault', 'Przy pełnym zwrocie wskaż winę: SELLER albo CARRIER.');
  }
  if (input.outcome !== 'FULL_REFUND' && input.fault !== undefined) {
    throw invalid('fault', 'Winę wskazujemy tylko przy pełnym zwrocie.');
  }
  if (input.outcome === 'PARTIAL_REFUND') {
    if (input.amount === undefined || input.amount <= 0 || input.amount > dispute.itemsTotal) {
      throw invalid('amount', 'Zwrot częściowy: od 1 gr do ceny przedmiotu.');
    }
  } else if (input.amount !== undefined) {
    throw invalid('amount', 'Kwotę podajemy tylko przy zwrocie częściowym.');
  }
  if (input.returnRequired === true) {
    if (input.outcome !== 'FULL_REFUND' || input.fault !== 'SELLER') {
      throw invalid(
        'returnRequired',
        'Odesłanie dotyczy tylko pełnego zwrotu z winy sprzedającego.',
      );
    }
    if (dispute.returnShippedAt !== null) {
      throw invalid('returnRequired', 'Zwrot był już nadany; nie można żądać kolejnego.');
    }
  }
  return {
    outcome: input.outcome,
    fault: input.fault ?? null,
    refundAmount: input.outcome === 'PARTIAL_REFUND' ? (input.amount ?? null) : null,
    decidedBy: 'STAFF',
    decidedByStaffId: staffId,
    statement: input.statement.trim(),
  };
}
