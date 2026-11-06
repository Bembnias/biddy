// Zapisane punkty odbioru kupującego (F-64): do 10 na konto, jeden domyślny na usługę, lista
// tylko dla bieżącego dostawcy punktów. Punkt sprawdzamy u dostawcy przed zapisem (poza
// transakcją), a limit i domyślność pilnuje blokada doradcza konta; indeksy unikalne są drugą
// linią obrony.
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import type { ShippingProviderName } from '../../../infra/config/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type SavedPickupPointRow, savedPickupPoints } from '../db/shipping.schema.js';
import { PickupPointService } from './pickup-point.service.js';

/** Najwięcej zapisanych punktów odbioru na konto. */
export const MAX_SAVED_PICKUP_POINTS = 10;

export interface SavePickupPointInput {
  readonly carrierId: string;
  readonly pointId: string;
  readonly isDefault?: boolean;
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono punktu odbioru.' });
}

@Injectable()
export class SavedPickupPointService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PickupPointService) private readonly points: PickupPointService,
  ) {}

  /** Punkty konta u bieżącego dostawcy punktów: najpierw domyślne, potem od najnowszych. */
  list(userId: string): Promise<SavedPickupPointRow[]> {
    return this.db
      .select()
      .from(savedPickupPoints)
      .where(
        and(eq(savedPickupPoints.userId, userId), eq(savedPickupPoints.provider, this.provider())),
      )
      .orderBy(
        desc(savedPickupPoints.isDefault),
        desc(savedPickupPoints.createdAt),
        desc(savedPickupPoints.id),
      );
  }

  /**
   * Zapis punktu. Już zapisany punkt nie tworzy drugiego wpisu (`created: false`), a przy
   * `isDefault` staje się domyślny. Pierwszy punkt usługi jest domyślny.
   * @throws {DomainError} PICKUP_POINT_LIMIT_REACHED, PICKUP_POINT_NOT_FOUND,
   *   SHIPPING_OPTION_UNAVAILABLE
   */
  async save(
    userId: string,
    input: SavePickupPointInput,
  ): Promise<{ readonly point: SavedPickupPointRow; readonly created: boolean }> {
    const provider = this.provider();
    const existing = await this.find(userId, provider, input.carrierId, input.pointId);
    if (existing !== undefined) {
      // Bez zapytania do dostawcy: punkt jest już na liście, najwyżej zmienia się domyślny.
      const point =
        input.isDefault === true ? await this.setDefault(userId, existing.id) : existing;
      return { point, created: false };
    }
    const { carrier, point } = await this.points.byId(input.carrierId, input.pointId);
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const again = await this.find(userId, provider, carrier.id, point.id, tx);
      if (again !== undefined) {
        return { point: again, created: false };
      }
      const [{ count, ofCarrier } = { count: 0, ofCarrier: 0 }] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          ofCarrier: sql<number>`count(*) filter (where ${savedPickupPoints.carrierId} = ${carrier.id})::int`,
        })
        .from(savedPickupPoints)
        .where(and(eq(savedPickupPoints.userId, userId), eq(savedPickupPoints.provider, provider)));
      if (count >= MAX_SAVED_PICKUP_POINTS) {
        throw new DomainError({ code: 'PICKUP_POINT_LIMIT_REACHED' });
      }
      const isDefault = ofCarrier === 0 || input.isDefault === true;
      if (isDefault) {
        await this.clearDefault(tx, userId, provider, carrier.id);
      }
      const [created] = await tx
        .insert(savedPickupPoints)
        .values({
          userId,
          provider,
          carrierId: carrier.id,
          pointId: point.id,
          name: point.name,
          address: point.address,
          openingHours: point.openingHours,
          isDefault,
        })
        .returning();
      if (created === undefined) {
        throw new Error('INSERT punktu odbioru nie zwrócił wiersza');
      }
      return { point: created, created: true };
    });
  }

  /** Punkt staje się domyślny dla swojej usługi; cudzy albo nieznany to 404. */
  setDefault(userId: string, id: string): Promise<SavedPickupPointRow> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, userId);
      const [row] = await tx
        .select()
        .from(savedPickupPoints)
        .where(and(eq(savedPickupPoints.id, id), eq(savedPickupPoints.userId, userId)));
      if (row === undefined) {
        throw notFound();
      }
      if (row.isDefault) {
        return row;
      }
      await this.clearDefault(tx, userId, row.provider, row.carrierId);
      const [updated] = await tx
        .update(savedPickupPoints)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(savedPickupPoints.id, id))
        .returning();
      if (updated === undefined) {
        throw notFound();
      }
      return updated;
    });
  }

  /** Usunięcie; usunięty domyślny nie wybiera nowego domyślnego. Cudzy albo nieznany: 404. */
  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.db
      .delete(savedPickupPoints)
      .where(and(eq(savedPickupPoints.id, id), eq(savedPickupPoints.userId, userId)))
      .returning({ id: savedPickupPoints.id });
    if (deleted.length === 0) {
      throw notFound();
    }
  }

  private provider(): ShippingProviderName {
    return this.points.provider;
  }

  private async find(
    userId: string,
    provider: ShippingProviderName,
    carrierId: string,
    pointId: string,
    tx: Database | Transaction = this.db,
  ): Promise<SavedPickupPointRow | undefined> {
    const [row] = await tx
      .select()
      .from(savedPickupPoints)
      .where(
        and(
          eq(savedPickupPoints.userId, userId),
          eq(savedPickupPoints.provider, provider),
          eq(savedPickupPoints.carrierId, carrierId),
          eq(savedPickupPoints.pointId, pointId),
        ),
      );
    return row;
  }

  /** Serializuje zmiany punktów jednego konta (limit i domyślność). */
  private async lock(tx: Transaction, userId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`saved-pickup-points:${userId}`}, 0))`,
    );
  }

  private async clearDefault(
    tx: Transaction,
    userId: string,
    provider: ShippingProviderName,
    carrierId: string,
  ): Promise<void> {
    await tx
      .update(savedPickupPoints)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(savedPickupPoints.userId, userId),
          eq(savedPickupPoints.provider, provider),
          eq(savedPickupPoints.carrierId, carrierId),
          eq(savedPickupPoints.isDefault, true),
        ),
      );
  }
}
