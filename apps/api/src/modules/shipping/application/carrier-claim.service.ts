// Rejestr reklamacji u przewoźników (F-24, PROJECT.md §8.4): zaginięcie albo uszkodzenie paczki
// zgłasza Biddy jako zleceniodawca. Przejścia `OPEN → SUBMITTED → ACCEPTED | REJECTED`, najwyżej
// jedna reklamacja na przesyłkę. Rozstrzygnięcie publikuje CarrierClaimResolved: księgowanie
// (CARRIER_CLAIM_SETTLED, §7.9) robi konsument razem z rekompensatą (F-26), UI daje F-34.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { type CarrierClaimRow, carrierClaims, shipments } from '../db/shipping.schema.js';
import type { CarrierClaimType } from '../domain/shipping-values.js';
import { CarrierClaimResolved } from '../shipping.events.js';

export interface OpenClaimInput {
  readonly shipmentId: string;
  readonly type: CarrierClaimType;
  /** Kwota roszczenia w walucie przesyłki (grosze). */
  readonly claimedAmount: number;
  readonly note?: string;
}

function conflict(detail: string): DomainError {
  return new DomainError({ code: 'CONFLICT', detail });
}

@Injectable()
export class CarrierClaimService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: Outbox,
  ) {}

  /** Otwiera reklamację przesyłki utworzonej u dostawcy; druga reklamacja tej przesyłki: 409. */
  async open(input: OpenClaimInput): Promise<CarrierClaimRow> {
    if (!Number.isSafeInteger(input.claimedAmount) || input.claimedAmount <= 0) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Kwota reklamacji musi być dodatnia.',
      });
    }
    const [shipment] = await this.db
      .select({ currency: shipments.currency, providerShipmentId: shipments.providerShipmentId })
      .from(shipments)
      .where(eq(shipments.id, input.shipmentId));
    if (shipment === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono przesyłki.' });
    }
    if (shipment.providerShipmentId === null) {
      throw conflict('Reklamację można złożyć tylko dla przesyłki nadanej u przewoźnika.');
    }
    const [claim] = await this.db
      .insert(carrierClaims)
      .values({
        shipmentId: input.shipmentId,
        type: input.type,
        currency: shipment.currency,
        claimedAmount: input.claimedAmount,
        note: input.note ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (claim === undefined) {
      throw conflict('Ta przesyłka ma już reklamację.');
    }
    return claim;
  }

  /** Reklamacja zgłoszona u przewoźnika (z jego numerem sprawy). */
  async submit(claimId: string, providerClaimRef: string): Promise<CarrierClaimRow> {
    const now = new Date();
    const [claim] = await this.db
      .update(carrierClaims)
      .set({ status: 'SUBMITTED', providerClaimRef, submittedAt: now, updatedAt: now })
      .where(and(eq(carrierClaims.id, claimId), eq(carrierClaims.status, 'OPEN')))
      .returning();
    return claim ?? this.notOpen(claimId);
  }

  /**
   * Rozstrzygnięcie: przyjęta z kwotą odzyskaną (0 – kwota roszczenia) albo odrzucona (0).
   * Event w tej samej transakcji co zmiana statusu.
   */
  async resolve(
    claimId: string,
    outcome:
      | { readonly status: 'ACCEPTED'; readonly recoveredAmount: number }
      | { readonly status: 'REJECTED' },
  ): Promise<CarrierClaimRow> {
    const recovered = outcome.status === 'ACCEPTED' ? outcome.recoveredAmount : 0;
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(carrierClaims)
        .where(eq(carrierClaims.id, claimId))
        .for('update');
      if (current === undefined) {
        throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono reklamacji.' });
      }
      if (current.status !== 'OPEN' && current.status !== 'SUBMITTED') {
        throw conflict('Ta reklamacja jest już rozstrzygnięta.');
      }
      if (!Number.isSafeInteger(recovered) || recovered < 0 || recovered > current.claimedAmount) {
        throw new DomainError({
          code: 'VALIDATION_FAILED',
          detail: 'Kwota odzyskana musi wynosić od 0 do kwoty reklamacji.',
        });
      }
      const [claim] = await tx
        .update(carrierClaims)
        .set({
          status: outcome.status,
          recoveredAmount: recovered,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(carrierClaims.id, claimId))
        .returning();
      const [shipment] = await tx
        .select({ orderId: shipments.orderId })
        .from(shipments)
        .where(eq(shipments.id, current.shipmentId));
      await this.outbox.add(
        tx,
        CarrierClaimResolved.create({
          aggregateId: claimId,
          payload: {
            shipmentId: current.shipmentId,
            orderId: shipment?.orderId ?? null,
            type: current.type,
            status: outcome.status,
            claimed: { amount: current.claimedAmount, currency: current.currency },
            recovered: { amount: recovered, currency: current.currency },
          },
        }),
      );
      return claim ?? current;
    });
  }

  async forShipment(shipmentId: string): Promise<CarrierClaimRow | undefined> {
    const [claim] = await this.db
      .select()
      .from(carrierClaims)
      .where(eq(carrierClaims.shipmentId, shipmentId));
    return claim;
  }

  /** Reklamacja nieistniejąca (404) albo nie w stanie OPEN (409). */
  private async notOpen(claimId: string): Promise<never> {
    const [exists] = await this.db
      .select({ id: carrierClaims.id })
      .from(carrierClaims)
      .where(eq(carrierClaims.id, claimId));
    if (exists === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono reklamacji.' });
    }
    throw conflict('Reklamacji nie można zgłosić: nie jest otwarta.');
  }
}
