// Adresy użytkownika (F-10): dostawy i nadania. Każda zmiana blokuje wiersz użytkownika
// (SELECT … FOR UPDATE), więc limit adresów i flagi domyślności są spójne także przy
// równoległych żądaniach; indeksy unikalne częściowe są drugą linią obrony.
import { normalizePostalCode } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { type Address, addresses, users } from '../db/identity.schema.js';
import { normalizePhoneNumber } from '../phone/phone-number.js';

/** Najwięcej zapisanych adresów na konto. */
export const MAX_ADDRESSES = 10;

export interface AddressInput {
  readonly recipientName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly phone: string;
}

export interface AddressChanges extends Partial<AddressInput> {
  /** Ustawia adres jako domyślny do dostawy (flagę zdejmuje się tylko ustawieniem innego). */
  readonly isDefault?: true;
  /** Ustawia adres jako domyślny do nadania. */
  readonly isSenderDefault?: true;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono adresu.' });
}

/** Pola w postaci zapisywanej w bazie (DTO waliduje je wcześniej). */
function normalized(input: Partial<AddressInput>): Partial<AddressInput> {
  const clean = (value: string | undefined) => value?.trim().replace(/\s+/gu, ' ');
  return Object.fromEntries(
    Object.entries({
      recipientName: clean(input.recipientName),
      street: clean(input.street),
      city: clean(input.city),
      postalCode:
        input.postalCode === undefined ? undefined : normalizePostalCode(input.postalCode),
      phone: input.phone === undefined ? undefined : normalizePhoneNumber(input.phone),
    }).filter(([, value]) => value !== undefined),
  );
}

@Injectable()
export class AddressService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Adresy konta: najpierw domyślny adres dostawy, potem od najnowszego. */
  list(userId: string): Promise<Address[]> {
    return this.db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, userId))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt), desc(addresses.id));
  }

  /** Domyślny adres nadania (dla modułu shipping, F-24) albo undefined. */
  async defaultSenderAddress(userId: string): Promise<Address | undefined> {
    const [address] = await this.db
      .select()
      .from(addresses)
      .where(and(eq(addresses.userId, userId), eq(addresses.isSenderDefault, true)));
    return address;
  }

  /** Nowy adres; pierwszy adres konta staje się domyślny do dostawy i nadania. */
  create(
    userId: string,
    input: AddressInput & { readonly isDefault?: boolean; readonly isSenderDefault?: boolean },
  ): Promise<Address> {
    return this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(addresses)
        .where(eq(addresses.userId, userId));
      if (count >= MAX_ADDRESSES) {
        throw new DomainError({ code: 'ADDRESS_LIMIT_REACHED' });
      }
      const first = count === 0;
      const isDefault = first || input.isDefault === true;
      const isSenderDefault = first || input.isSenderDefault === true;
      await this.clearDefaults(tx, userId, { isDefault, isSenderDefault });
      const [created] = await tx
        .insert(addresses)
        .values({ ...(normalized(input) as AddressInput), userId, isDefault, isSenderDefault })
        .returning();
      if (created === undefined) {
        throw new Error('INSERT adresu nie zwrócił wiersza');
      }
      return created;
    });
  }

  /** Zmiana pól i ustawienie flag domyślności; cudzy albo nieistniejący adres to 404. */
  update(userId: string, addressId: string, changes: AddressChanges): Promise<Address> {
    return this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const [existing] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
      if (existing === undefined) {
        throw notFound();
      }
      const isDefault = changes.isDefault === true;
      const isSenderDefault = changes.isSenderDefault === true;
      await this.clearDefaults(tx, userId, { isDefault, isSenderDefault });
      const [updated] = await tx
        .update(addresses)
        .set({
          ...normalized(changes),
          ...(isDefault ? { isDefault: true } : {}),
          ...(isSenderDefault ? { isSenderDefault: true } : {}),
          updatedAt: new Date(),
        })
        .where(eq(addresses.id, addressId))
        .returning();
      if (updated === undefined) {
        throw notFound();
      }
      return updated;
    });
  }

  async delete(userId: string, addressId: string): Promise<void> {
    const deleted = await this.db
      .delete(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning({ id: addresses.id });
    if (deleted.length === 0) {
      throw notFound();
    }
  }

  /** Serializuje zmiany adresów jednego konta (limit i flagi domyślności). */
  private async lockUser(tx: Transaction, userId: string): Promise<void> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  }

  /** Zdejmuje flagi z pozostałych adresów przed ustawieniem nowego domyślnego. */
  private async clearDefaults(
    tx: Transaction,
    userId: string,
    flags: { readonly isDefault: boolean; readonly isSenderDefault: boolean },
  ): Promise<void> {
    if (flags.isDefault) {
      await tx
        .update(addresses)
        .set({ isDefault: false })
        .where(and(eq(addresses.userId, userId), eq(addresses.isDefault, true)));
    }
    if (flags.isSenderDefault) {
      await tx
        .update(addresses)
        .set({ isSenderDefault: false })
        .where(and(eq(addresses.userId, userId), eq(addresses.isSenderDefault, true)));
    }
  }
}
