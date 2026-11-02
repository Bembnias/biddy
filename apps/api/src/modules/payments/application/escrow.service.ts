// Środki zamówienia po stronie Biddy (F-26, PROJECT.md §7.2, §7.7, §7.9): zwolnienie dla
// sprzedającego po zakończeniu zamówienia oraz rekompensata za zaginioną paczkę z rozliczeniem
// reklamacji u przewoźnika. Moduł orders woła te metody w transakcji przejścia zamówienia.
// - release: księgowanie ORDER_COMPLETED od razu (ledger jest źródłem prawdy dla wypłat), wiersz
//   `fund_releases` i event FundsReleaseRequested; operatora woła konsument z kluczem
//   `release:{id}`, więc ponowienie nie zwalnia drugi raz.
// - compensateLostParcel / settleCarrierClaim: tylko ledger (PARCEL_COMPENSATION_PAID,
//   CARRIER_CLAIM_SETTLED), z kluczami zamówienia i reklamacji.
import type { Money } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { type CompensationChannel, LedgerService, type OrderAmounts } from '../../ledger/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type FundReleaseRow, fundReleases, payments } from '../db/payments.schema.js';
import { FundsReleaseRequested } from '../payments.events.js';
import { GatewayRegistry } from './gateway-registry.js';
import { SellerAccountService } from './seller-account.service.js';

export interface ReleaseFundsCommand {
  readonly orderId: string;
  /** Płatność, która opłaciła zamówienie (`orders.payment_id`). */
  readonly paymentId: string;
  readonly sellerId: string;
  readonly amounts: OrderAmounts;
}

export interface CompensateLostParcelCommand {
  readonly orderId: string;
  readonly sellerId: string;
  /** Operator płatności zamówienia: od jego `internalTransfers` zależy kanał wypłaty. */
  readonly provider: string;
  readonly amount: Money;
}

export interface SettleCarrierClaimCommand {
  readonly orderId: string;
  readonly claimId: string;
  readonly recovered: Money;
  readonly unrecovered: Money;
}

@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly registry: GatewayRegistry,
    private readonly sellers: SellerAccountService,
    private readonly ledger: LedgerService,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Zwolnienie środków zakończonego zamówienia w transakcji wywołującego: cena na saldo dostępne
   * sprzedającego (najpierw spłata należności), POK i dostawa jako przychody Biddy. Idempotentne.
   */
  async release(tx: Transaction, command: ReleaseFundsCommand): Promise<FundReleaseRow> {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, command.paymentId));
    if (payment?.status !== 'SUCCEEDED' || payment.orderId !== command.orderId) {
      throw new Error(
        `Zamówienie ${command.orderId}: płatność ${command.paymentId} nie opłaciła zamówienia`,
      );
    }
    await this.ledger.post(tx, {
      type: 'ORDER_COMPLETED',
      idempotencyKey: `order:${command.orderId}:completed`,
      orderId: command.orderId,
      sellerId: command.sellerId,
      amounts: command.amounts,
    });
    const [created] = await tx
      .insert(fundReleases)
      .values({
        orderId: command.orderId,
        paymentId: payment.id,
        provider: payment.provider,
        currency: command.amounts.itemsTotal.currency,
        amount: command.amounts.itemsTotal.amount,
      })
      .onConflictDoNothing({ target: fundReleases.orderId })
      .returning();
    if (created === undefined) {
      const [existing] = await tx
        .select()
        .from(fundReleases)
        .where(eq(fundReleases.orderId, command.orderId));
      if (existing === undefined) {
        throw new Error(`Zamówienie ${command.orderId}: brak zwolnienia środków`);
      }
      return existing;
    }
    await this.outbox.add(
      tx,
      FundsReleaseRequested.create({
        aggregateId: created.id,
        payload: {
          orderId: command.orderId,
          paymentId: payment.id,
          amount: command.amounts.itemsTotal,
        },
      }),
    );
    return created;
  }

  /** Zwolnienie środków zamówienia albo undefined (widok zamówienia, testy). */
  async releaseForOrder(orderId: string): Promise<FundReleaseRow | undefined> {
    const [release] = await this.db
      .select()
      .from(fundReleases)
      .where(eq(fundReleases.orderId, orderId));
    return release;
  }

  /** Wywołanie operatora dla zleconego zwolnienia (klucz `release:{id}`). */
  @OnDomainEvent(FundsReleaseRequested, { consumer: 'payments.release-funds' })
  async onFundsReleaseRequested(
    event: DomainEventOf<typeof FundsReleaseRequested>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const [release] = await tx
      .select()
      .from(fundReleases)
      .where(eq(fundReleases.id, event.aggregateId))
      .for('update');
    if (release?.status !== 'PENDING') {
      return;
    }
    const [payment] = await tx.select().from(payments).where(eq(payments.id, release.paymentId));
    if (payment?.providerPaymentId === null || payment === undefined) {
      throw new Error(`Zwolnienie ${release.id}: płatność bez ID operatora`);
    }
    const account = await this.sellers.find(payment.sellerId, release.provider, tx);
    if (account === undefined) {
      throw new Error(`Zwolnienie ${release.id}: sprzedawca bez konta u operatora`);
    }
    const result = await this.registry.get(release.provider).releaseFunds({
      providerPaymentId: payment.providerPaymentId,
      providerSellerId: account.providerAccountId,
      sellerAmount: { amount: release.amount, currency: release.currency },
      idempotencyKey: `release:${release.id}`,
    });
    const now = new Date();
    await tx
      .update(fundReleases)
      .set({
        status: result.status,
        providerTransferId: result.status === 'SUCCEEDED' ? result.providerTransferId : null,
        releasedAt: now,
        updatedAt: now,
      })
      .where(eq(fundReleases.id, release.id));
    this.logger.log(
      { releaseId: release.id, orderId: release.orderId, status: result.status },
      'Zwolniono środki sprzedającego u operatora',
    );
  }

  /**
   * Rekompensata za zaginioną paczkę (§7.9): na saldo sprzedającego, gdy operator pozwala na
   * transfery z salda platformy, inaczej przelewem działu finansów. Idempotentna po zamówieniu.
   */
  async compensateLostParcel(
    tx: Transaction,
    command: CompensateLostParcelCommand,
  ): Promise<CompensationChannel> {
    const channel: CompensationChannel =
      this.registry.find(command.provider)?.capabilities.internalTransfers === true
        ? 'SELLER_BALANCE'
        : 'EXTERNAL_TRANSFER';
    await this.ledger.post(tx, {
      type: 'PARCEL_COMPENSATION_PAID',
      idempotencyKey: `order:${command.orderId}:parcel-compensation`,
      orderId: command.orderId,
      sellerId: command.sellerId,
      amount: command.amount,
      channel,
    });
    if (channel === 'EXTERNAL_TRANSFER') {
      this.logger.warn(
        { orderId: command.orderId, sellerId: command.sellerId, amount: command.amount },
        'Rekompensata za zaginioną paczkę do wypłaty przelewem przez dział finansów',
      );
    }
    return channel;
  }

  /** Rozliczenie reklamacji: odszkodowanie przewoźnika i nieodzyskana reszta (strata Biddy). */
  async settleCarrierClaim(tx: Transaction, command: SettleCarrierClaimCommand): Promise<void> {
    if (command.recovered.amount + command.unrecovered.amount === 0) {
      return;
    }
    await this.ledger.post(tx, {
      type: 'CARRIER_CLAIM_SETTLED',
      idempotencyKey: `carrier-claim:${command.claimId}:settled`,
      orderId: command.orderId,
      recovered: command.recovered,
      unrecovered: command.unrecovered,
    });
  }
}
