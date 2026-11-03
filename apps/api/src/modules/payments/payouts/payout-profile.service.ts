// Dane do wypłat sprzedającego (F-27, PROJECT.md §16.1, §17): dane osobowe do DAC7 i rachunek,
// niezależne od operatora. Oba bloki szyfrujemy (DataCipher) z kontekstem typu danych i ID
// użytkownika, a do wyświetlania trzymamy jawnie tylko maskę rachunku. Zmiana numeru rachunku
// wstrzymuje wypłaty na 48 h; każdy zapis rachunku wysyła powiadomienie (event
// PayoutAccountChanged w tej samej transakcji).
import {
  type IsoDate,
  maskIban,
  maskTaxId,
  PAYOUT_ACCOUNT_CHANGE_HOLD_HOURS,
  type TaxIdKind,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { DataCipher } from '../../../infra/crypto/index.js';
import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type SellerPayoutProfileRow, sellerPayoutProfiles } from '../db/payments.schema.js';
import { PayoutAccountChanged } from '../payments.events.js';

const HOUR_MS = 60 * 60_000;

/** Dane osobowe do DAC7: osoba prywatna z rezydencją podatkową w Polsce (MVP). */
export interface PersonalData {
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: IsoDate;
  readonly address: {
    readonly street: string;
    readonly postalCode: string;
    readonly city: string;
    readonly country: 'PL';
  };
  readonly taxId: { readonly kind: TaxIdKind; readonly value: string };
  readonly taxResidence: 'PL';
}

/** Rachunek do wypłat: polski IBAN bez spacji i właściciel. */
export interface BankAccount {
  readonly iban: string;
  readonly holderName: string;
}

/** Dane do wypłat do wyświetlenia właścicielowi: identyfikator i rachunek tylko maskowane. */
export interface PayoutProfile {
  readonly personalData:
    | (Omit<PersonalData, 'taxId'> & {
        readonly taxId: { readonly kind: TaxIdKind; readonly masked: string };
      })
    | null;
  readonly bankAccount: {
    readonly masked: string;
    readonly holderName: string;
    readonly changedAt: Date;
  } | null;
  readonly weeklyPayouts: boolean;
  /** Koniec blokady wypłat po zmianie rachunku (także już miniony). */
  readonly payoutsBlockedUntil: Date | null;
  /** Dane osobowe i rachunek zapisane: można zlecać wypłaty. */
  readonly complete: boolean;
}

const EMPTY_PROFILE: PayoutProfile = {
  personalData: null,
  bankAccount: null,
  weeklyPayouts: false,
  payoutsBlockedUntil: null,
  complete: false,
};

function personalDataContext(userId: string): string {
  return `seller-payout-profile:personal-data:${userId}`;
}

function bankAccountContext(userId: string): string {
  return `seller-payout-profile:bank-account:${userId}`;
}

/** Komplet danych do wypłat w wierszu (bez odszyfrowania). */
export function isProfileComplete(row: SellerPayoutProfileRow | undefined): boolean {
  return row !== undefined && row.personalData !== null && row.bankAccount !== null;
}

@Injectable()
export class PayoutProfileService {
  private readonly logger = new Logger(PayoutProfileService.name);
  private readonly cipher: DataCipher;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly outbox: Outbox,
  ) {
    this.cipher = new DataCipher(config.payments.dataEncryptionKey);
  }

  async get(userId: string, tx?: Transaction): Promise<PayoutProfile> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(sellerPayoutProfiles)
      .where(eq(sellerPayoutProfiles.userId, userId));
    return row === undefined ? EMPTY_PROFILE : this.toProfile(row);
  }

  /** Wiersz pod blokadą (`FOR UPDATE`): zlecenia wypłat jednego sprzedającego idą po kolei. */
  async lock(tx: Transaction, userId: string): Promise<SellerPayoutProfileRow | undefined> {
    const [row] = await tx
      .select()
      .from(sellerPayoutProfiles)
      .where(eq(sellerPayoutProfiles.userId, userId))
      .for('update');
    return row;
  }

  async setPersonalData(userId: string, data: PersonalData): Promise<PayoutProfile> {
    const now = new Date();
    const encrypted = this.cipher.encryptJson(data, personalDataContext(userId));
    const [row] = await this.db
      .insert(sellerPayoutProfiles)
      .values({ userId, personalData: encrypted, personalDataUpdatedAt: now })
      .onConflictDoUpdate({
        target: sellerPayoutProfiles.userId,
        set: { personalData: encrypted, personalDataUpdatedAt: now, updatedAt: now },
      })
      .returning();
    this.logger.log({ userId }, 'Zapisano dane osobowe do wypłat');
    return this.toProfile(required(row));
  }

  /**
   * Zapisuje rachunek. Zmiana numeru (nie pierwszy rachunek i nie sam właściciel) wstrzymuje
   * wypłaty na 48 h; powiadomienie idzie przy każdej zmianie numeru, także pierwszym zapisie.
   */
  async setBankAccount(userId: string, account: BankAccount): Promise<PayoutProfile> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const current = await this.lock(tx, userId);
      const previous =
        current === undefined || current.bankAccount === null
          ? undefined
          : this.cipher.decryptJson<BankAccount>(current.bankAccount, bankAccountContext(userId));
      const numberChanged = previous?.iban !== account.iban;
      const holdUntil =
        previous !== undefined && numberChanged
          ? new Date(now.getTime() + PAYOUT_ACCOUNT_CHANGE_HOLD_HOURS * HOUR_MS)
          : (current?.payoutsBlockedUntil ?? null);
      const values = {
        bankAccount: this.cipher.encryptJson(account, bankAccountContext(userId)),
        bankAccountMasked: maskIban(account.iban),
        bankAccountChangedAt: numberChanged ? now : (current?.bankAccountChangedAt ?? now),
        payoutsBlockedUntil: holdUntil,
        updatedAt: now,
      };
      const [row] = await tx
        .insert(sellerPayoutProfiles)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: sellerPayoutProfiles.userId, set: values })
        .returning();
      if (numberChanged) {
        await this.outbox.add(
          tx,
          PayoutAccountChanged.create({
            aggregateId: userId,
            payload: {
              userId,
              bankAccountMasked: values.bankAccountMasked,
              first: previous === undefined,
              payoutsBlockedUntil:
                previous === undefined ? null : (holdUntil?.toISOString() ?? null),
            },
          }),
        );
        this.logger.log(
          { userId, first: previous === undefined, payoutsBlockedUntil: holdUntil },
          'Zapisano rachunek do wypłat',
        );
      }
      return this.toProfile(required(row));
    });
  }

  async setWeeklyPayouts(userId: string, enabled: boolean): Promise<PayoutProfile> {
    const now = new Date();
    const [row] = await this.db
      .insert(sellerPayoutProfiles)
      .values({ userId, weeklyPayouts: enabled })
      .onConflictDoUpdate({
        target: sellerPayoutProfiles.userId,
        set: { weeklyPayouts: enabled, updatedAt: now },
      })
      .returning();
    return this.toProfile(required(row));
  }

  /** Sprzedający z włączoną wypłatą tygodniową, po ID (stronicowanie kursorem). */
  async weeklySellers(limit: number, after?: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: sellerPayoutProfiles.userId })
      .from(sellerPayoutProfiles)
      .where(
        and(
          eq(sellerPayoutProfiles.weeklyPayouts, true),
          after === undefined ? undefined : gt(sellerPayoutProfiles.userId, after),
        ),
      )
      .orderBy(asc(sellerPayoutProfiles.userId))
      .limit(limit);
    return rows.map((row) => row.userId);
  }

  private toProfile(row: SellerPayoutProfileRow): PayoutProfile {
    const personal =
      row.personalData === null
        ? null
        : this.cipher.decryptJson<PersonalData>(row.personalData, personalDataContext(row.userId));
    const bank =
      row.bankAccount === null
        ? null
        : this.cipher.decryptJson<BankAccount>(row.bankAccount, bankAccountContext(row.userId));
    return {
      personalData:
        personal === null
          ? null
          : {
              ...personal,
              taxId: { kind: personal.taxId.kind, masked: maskTaxId(personal.taxId.value) },
            },
      bankAccount:
        bank === null || row.bankAccountMasked === null || row.bankAccountChangedAt === null
          ? null
          : {
              masked: row.bankAccountMasked,
              holderName: bank.holderName,
              changedAt: row.bankAccountChangedAt,
            },
      weeklyPayouts: row.weeklyPayouts,
      payoutsBlockedUntil: row.payoutsBlockedUntil,
      complete: isProfileComplete(row),
    };
  }
}

function required(row: SellerPayoutProfileRow | undefined): SellerPayoutProfileRow {
  if (row === undefined) {
    throw new Error('Nie zapisano danych do wypłat');
  }
  return row;
}
