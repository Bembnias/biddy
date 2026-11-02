// Konta sprzedawców u operatora płatności (F-23, PROJECT.md §7.6 decyzja 5). F-23 daje
// idempotentną rejestrację z minimalnym zestawem danych i aktualizację statusu z webhooka;
// moment rejestracji (pierwsze wystawienie), pełne KYC i dane do DAC7 dojdą w F-32.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type SellerAccountRow, sellerAccounts } from '../db/payments.schema.js';
import type { SellerAccountType, SellerStatus } from '../domain/payment-values.js';
import { SellerKycStatusChanged } from '../payments.events.js';
import { GatewayRegistry } from './gateway-registry.js';

export interface RegisterSellerCommand {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly type: SellerAccountType;
}

export interface SellerAccount {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly type: SellerAccountType;
  readonly kycStatus: SellerStatus;
}

function toAccount(row: SellerAccountRow): SellerAccount {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerAccountId: row.providerAccountId,
    type: row.type,
    kycStatus: row.kycStatus,
  };
}

@Injectable()
export class SellerAccountService {
  private readonly logger = new Logger(SellerAccountService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly outbox: Outbox,
  ) {}

  /** Konto sprzedawcy u operatora (domyślnie u operatora nowych płatności) albo undefined. */
  async find(
    userId: string,
    provider: string = this.registry.defaultProvider,
    tx?: Transaction,
  ): Promise<SellerAccount | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(sellerAccounts)
      .where(and(eq(sellerAccounts.userId, userId), eq(sellerAccounts.provider, provider)));
    return row === undefined ? undefined : toAccount(row);
  }

  /**
   * Rejestruje sprzedawcę u operatora domyślnego. Idempotentne: konto już zarejestrowane zwraca
   * bez wywołania operatora, a ponowienie po błędzie sieci wywołuje operatora z tym samym kluczem.
   */
  async register(command: RegisterSellerCommand): Promise<SellerAccount> {
    const provider = this.registry.defaultProvider;
    const existing = await this.find(command.userId, provider);
    if (existing !== undefined) {
      return existing;
    }
    const result = await this.registry.get(provider).registerSeller({
      sellerId: command.userId,
      idempotencyKey: `seller:${command.userId}:${provider}`,
      type: command.type,
      email: command.email,
      displayName: command.displayName,
    });
    const [created] = await this.db
      .insert(sellerAccounts)
      .values({
        userId: command.userId,
        provider,
        providerAccountId: result.providerSellerId,
        type: command.type,
        kycStatus: result.status,
      })
      .onConflictDoNothing({ target: [sellerAccounts.userId, sellerAccounts.provider] })
      .returning();
    const account =
      created === undefined ? await this.find(command.userId, provider) : toAccount(created);
    if (account === undefined) {
      throw new DomainError({ code: 'CONFLICT', detail: 'Nie zapisano konta sprzedawcy.' });
    }
    return account;
  }

  /**
   * Status weryfikacji z webhooka operatora (SELLER_STATUS_CHANGED) w transakcji handlera.
   * Zmiana zapisuje event SellerKycStatusChanged; ten sam status to no-op.
   *
   * @returns false, gdy nie znamy konta (webhook przed zapisem rejestracji: operator ponowi)
   */
  async applyStatus(
    tx: Transaction,
    provider: string,
    providerAccountId: string,
    status: SellerStatus,
  ): Promise<boolean> {
    const [account] = await tx
      .select()
      .from(sellerAccounts)
      .where(
        and(
          eq(sellerAccounts.provider, provider),
          eq(sellerAccounts.providerAccountId, providerAccountId),
        ),
      )
      .for('update');
    if (account === undefined) {
      return false;
    }
    if (account.kycStatus === status) {
      return true;
    }
    await tx
      .update(sellerAccounts)
      .set({ kycStatus: status, updatedAt: new Date() })
      .where(eq(sellerAccounts.id, account.id));
    await this.outbox.add(
      tx,
      SellerKycStatusChanged.create({
        aggregateId: account.id,
        payload: {
          userId: account.userId,
          provider,
          status,
          previousStatus: account.kycStatus,
        },
      }),
    );
    this.logger.log(
      { userId: account.userId, provider, status, previousStatus: account.kycStatus },
      'Zmiana statusu weryfikacji sprzedawcy u operatora',
    );
    return true;
  }
}
