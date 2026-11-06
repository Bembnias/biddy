// Wypłaty z salda sprzedającego (F-27, PROJECT.md §7.6–7.8):
// 1. zlecenie pod blokadą danych do wypłat: warunki (payoutBlocker), wiersz `payouts`,
//    księgowanie PAYOUT_REQUESTED i event PayoutRequested w jednej transakcji. Saldo zawsze
//    z ledgera (model SELLER_BALANCE: saldo u operatora ma też środki niezakończonych zamówień),
//    a ledger blokuje konto salda i nie pozwala zejść poniżej zera, także przy równoległych
//    żądaniach;
// 2. konsument PayoutRequested woła operatora z kluczem `payout:{id}`; odmowa operatora kończy
//    wypłatę od razu (środki wracają na saldo), a niedostępność ponawia outbox;
// 3. webhook PAYOUT_PAID: PAYOUT_COMPLETED i event PayoutPaid; PAYOUT_FAILED: PAYOUT_FAILED
//    (najpierw spłata należności) i event PayoutFailed.
// Wypłaty automatyczne: tygodniowa, saldo uśpione (90 dni bez sprzedaży) i zamknięcie konta.
import {
  DEFAULT_CURRENCY,
  DORMANT_BALANCE_DAYS,
  type Money,
  money,
  PAYOUT_MINIMUM,
  type PayoutTrigger,
  toWarsawDate,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type DomainEventContext,
  type DomainEventOf,
  OnDomainEvent,
  Outbox,
} from '../../../infra/outbox/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { AccountBlockService } from '../../identity/index.js';
import { LedgerError, LedgerService, type SellerBalances } from '../../ledger/index.js';
import * as paymentsTables from '../db/payments.schema.js';
import { type PayoutRow, payouts } from '../db/payments.schema.js';
import type { PayoutFailureReason } from '../domain/payment-values.js';
import { PayoutFailed, PayoutPaid, PayoutRequested } from '../payments.events.js';
import { isPaymentGatewayError } from '../ports/payment-gateway.port.js';
import { GatewayRegistry } from '../application/gateway-registry.js';
import { SellerAccountService } from '../application/seller-account.service.js';
import { payoutError } from './payout-errors.js';
import { isProfileComplete, PayoutProfileService } from './payout-profile.service.js';
import { type PayoutBlocker, isoWeekKey, payoutBlocker } from './payout-rules.js';

const DAY_MS = 24 * 60 * 60_000;
const BATCH = 200;

export interface RequestPayoutCommand {
  readonly sellerId: string;
  /** Kwota; domyślnie całe saldo dostępne. */
  readonly amount?: Money;
  readonly trigger: PayoutTrigger;
  /** Klucz zlecenia, np. `manual:{userId}:{Idempotency-Key}`; ponowienie zwraca tę samą wypłatę. */
  readonly idempotencyKey: string;
}

export type Payout = Pick<
  PayoutRow,
  | 'id'
  | 'sellerId'
  | 'currency'
  | 'amount'
  | 'trigger'
  | 'status'
  | 'failureReason'
  | 'bankAccountMasked'
  | 'createdAt'
  | 'paidAt'
  | 'failedAt'
>;

/** Stan wypłat sprzedającego do widoku salda. */
export interface PayoutOverview {
  readonly balances: SellerBalances;
  /** Powód, dla którego nie da się teraz wypłacić całego salda, albo undefined. */
  readonly blocker: PayoutBlocker | undefined;
  readonly profileComplete: boolean;
  readonly bankAccountMasked: string | null;
  readonly weeklyPayouts: boolean;
  readonly payoutsBlockedUntil: Date | null;
}

export interface PayoutJobReport {
  readonly requested: number;
  readonly skipped: number;
}

function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    sellerId: row.sellerId,
    currency: row.currency,
    amount: row.amount,
    trigger: row.trigger,
    status: row.status,
    failureReason: row.failureReason,
    bankAccountMasked: row.bankAccountMasked,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    failedAt: row.failedAt,
  };
}

/** Odmowy operatora, których ponowienie nic nie zmieni: wypłata kończy się od razu. */
const FINAL_GATEWAY_ERRORS = [
  'SELLER_NOT_VERIFIED',
  'INSUFFICIENT_BALANCE',
  'INVALID_REQUEST',
] as const;

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database<typeof paymentsTables>,
    private readonly profiles: PayoutProfileService,
    private readonly ledger: LedgerService,
    private readonly blocks: AccountBlockService,
    private readonly sellerAccounts: SellerAccountService,
    private readonly registry: GatewayRegistry,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Zleca wypłatę. Ponowienie z tym samym kluczem zwraca istniejącą wypłatę bez drugiego efektu.
   *
   * @throws {DomainError} PAYOUTS_BLOCKED, PAYOUT_PROFILE_INCOMPLETE, PAYOUTS_ON_HOLD,
   *   RECEIVABLE_OUTSTANDING, INSUFFICIENT_BALANCE, PAYOUT_BELOW_MINIMUM, SELLER_NOT_VERIFIED,
   *   CONFLICT (klucz innego sprzedającego)
   */
  async request(command: RequestPayoutCommand): Promise<{ payout: Payout; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const profile = await this.profiles.lock(tx, command.sellerId);
      const existing = await this.byKey(tx, command.idempotencyKey);
      if (existing !== undefined) {
        if (existing.sellerId !== command.sellerId) {
          throw new DomainError({ code: 'CONFLICT', detail: 'Klucz wypłaty jest już użyty.' });
        }
        return { payout: toPayout(existing), replayed: true };
      }
      const currency = command.amount?.currency ?? DEFAULT_CURRENCY;
      const block = await this.blocks.active(command.sellerId, 'PAYOUTS', tx);
      const account = await this.sellerAccounts.find(command.sellerId, undefined, tx);
      const balances = await this.ledger.sellerBalances(command.sellerId, currency, tx);
      const amount = command.amount?.amount ?? balances.available.amount;
      const blocker = payoutBlocker({
        profileComplete: isProfileComplete(profile),
        holdUntil: profile?.payoutsBlockedUntil ?? null,
        block,
        kycStatus: account?.kycStatus,
        available: balances.available.amount,
        receivable: balances.receivable.amount,
        amount,
        trigger: command.trigger,
        now: new Date(),
      });
      if (
        blocker !== undefined ||
        profile?.bankAccountMasked === undefined ||
        profile.bankAccountMasked === null ||
        account === undefined
      ) {
        throw payoutError(blocker ?? { code: 'PAYOUT_PROFILE_INCOMPLETE' });
      }
      const [created] = await tx
        .insert(payouts)
        .values({
          sellerId: command.sellerId,
          provider: account.provider,
          currency,
          amount,
          trigger: command.trigger,
          bankAccountMasked: profile.bankAccountMasked,
          idempotencyKey: command.idempotencyKey,
        })
        .returning();
      if (created === undefined) {
        throw new Error('Nie zapisano wypłaty');
      }
      try {
        await this.ledger.post(tx, {
          type: 'PAYOUT_REQUESTED',
          idempotencyKey: `payout:${created.id}:requested`,
          payoutId: created.id,
          sellerId: command.sellerId,
          amount: money(amount, currency),
        });
      } catch (error) {
        // Druga bariera: saldo w ledgerze nie może zejść poniżej zera (CHECK i blokada konta).
        if (error instanceof LedgerError && error.code === 'INSUFFICIENT_FUNDS') {
          throw payoutError({ code: 'INSUFFICIENT_BALANCE', available: balances.available.amount });
        }
        throw error;
      }
      await this.outbox.add(
        tx,
        PayoutRequested.create({
          aggregateId: created.id,
          payload: {
            sellerId: command.sellerId,
            amount: money(amount, currency),
            trigger: command.trigger,
          },
        }),
      );
      this.logger.log(
        { payoutId: created.id, sellerId: command.sellerId, amount, trigger: command.trigger },
        'Zlecono wypłatę',
      );
      return { payout: toPayout(created), replayed: false };
    });
  }

  /**
   * Zamknięcie konta (F-41): wypłata całego salda bez minimum. Bez salda niczego nie zleca.
   *
   * @throws {DomainError} jak `request`, poza minimum
   */
  async payOutOnClosure(sellerId: string): Promise<Payout | undefined> {
    const { available } = await this.ledger.sellerBalances(sellerId);
    if (available.amount === 0) {
      return undefined;
    }
    const { payout } = await this.request({
      sellerId,
      trigger: 'ACCOUNT_CLOSURE',
      idempotencyKey: `closure:${sellerId}`,
    });
    return payout;
  }

  /** Salda, powód blokady wypłaty całego salda i ustawienia (widok salda). */
  async overview(sellerId: string): Promise<PayoutOverview> {
    const [profile, block, account, balances] = await Promise.all([
      this.profiles.get(sellerId),
      this.blocks.active(sellerId, 'PAYOUTS'),
      this.sellerAccounts.find(sellerId),
      this.ledger.sellerBalances(sellerId),
    ]);
    return {
      balances,
      blocker: payoutBlocker({
        profileComplete: profile.complete,
        holdUntil: profile.payoutsBlockedUntil,
        block,
        kycStatus: account?.kycStatus,
        available: balances.available.amount,
        receivable: balances.receivable.amount,
        amount: balances.available.amount,
        trigger: 'MANUAL',
        now: new Date(),
      }),
      profileComplete: profile.complete,
      bankAccountMasked: profile.bankAccount?.masked ?? null,
      weeklyPayouts: profile.weeklyPayouts,
      payoutsBlockedUntil: profile.payoutsBlockedUntil,
    };
  }

  /** Wypłaty sprzedającego po ID (historia salda); obce i nieznane ID pomija. */
  async forSeller(sellerId: string, ids: readonly string[]): Promise<Payout[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.sellerId, sellerId), inArray(payouts.id, [...ids])));
    return rows.map(toPayout);
  }

  /** Wywołanie operatora dla zleconej wypłaty (klucz `payout:{id}`: ponowienie nie dubluje). */
  @OnDomainEvent(PayoutRequested, { consumer: 'payments.execute-payout' })
  async onPayoutRequested(
    event: DomainEventOf<typeof PayoutRequested>,
    { tx }: DomainEventContext,
  ): Promise<void> {
    const [payout] = await tx
      .select()
      .from(payouts)
      .where(eq(payouts.id, event.aggregateId))
      .for('update');
    if (payout === undefined || payout.providerPayoutId !== null || payout.status !== 'PENDING') {
      return;
    }
    const account = await this.sellerAccounts.find(payout.sellerId, payout.provider, tx);
    if (account === undefined) {
      await this.fail(tx, payout, 'SELLER_NOT_VERIFIED');
      return;
    }
    try {
      const result = await this.registry.get(payout.provider).createPayout({
        providerSellerId: account.providerAccountId,
        amount: money(payout.amount, payout.currency),
        idempotencyKey: `payout:${payout.id}`,
      });
      const saved = { ...payout, providerPayoutId: result.providerPayoutId };
      await tx
        .update(payouts)
        .set({ providerPayoutId: result.providerPayoutId, updatedAt: new Date() })
        .where(eq(payouts.id, payout.id));
      if (result.status === 'PAID') {
        await this.complete(tx, saved);
      } else if (result.status === 'FAILED') {
        await this.fail(tx, saved, 'REJECTED');
      }
    } catch (error) {
      const final = FINAL_GATEWAY_ERRORS.find((code) => isPaymentGatewayError(error, code));
      if (final === undefined) {
        throw error;
      }
      this.logger.warn(
        { payoutId: payout.id, sellerId: payout.sellerId, code: final },
        'Operator odrzucił wypłatę przy zleceniu',
      );
      await this.fail(tx, payout, final);
    }
  }

  /**
   * Webhook PAYOUT_PAID albo PAYOUT_FAILED w transakcji procesora zdarzeń. Zwraca false, gdy
   * wypłata jest nieznana (np. webhook przed zapisem ID operatora): operator ponowi webhook.
   */
  async applyProviderResult(
    tx: Transaction,
    provider: string,
    providerPayoutId: string,
    outcome: 'PAID' | 'FAILED',
    confirmed: Money,
  ): Promise<boolean> {
    const [payout] = await tx
      .select()
      .from(payouts)
      .where(and(eq(payouts.provider, provider), eq(payouts.providerPayoutId, providerPayoutId)))
      .for('update');
    if (payout === undefined) {
      return false;
    }
    if (payout.status !== 'PENDING') {
      return true;
    }
    if (confirmed.amount !== payout.amount || confirmed.currency !== payout.currency) {
      throw new Error(
        `Wypłata ${payout.id}: operator potwierdził ${confirmed.amount} ${confirmed.currency}, a oczekiwano ${payout.amount} ${payout.currency}`,
      );
    }
    if (outcome === 'PAID') {
      await this.complete(tx, payout);
    } else {
      await this.fail(tx, payout, 'REJECTED');
    }
    return true;
  }

  @ScheduledJob({ queue: 'payments', name: 'payments.weekly-payouts', pattern: '0 6 * * 1' })
  async runWeeklyPayouts(): Promise<PayoutJobReport> {
    return this.weeklyPayouts(new Date());
  }

  /** Wypłata tygodniowa: całe saldo ≥ 20 zł, najwyżej raz w tygodniu ISO (klucz z tygodniem). */
  async weeklyPayouts(now: Date): Promise<PayoutJobReport> {
    const week = isoWeekKey(toWarsawDate(now));
    let requested = 0;
    let skipped = 0;
    let after: string | undefined;
    for (;;) {
      const sellers = await this.profiles.weeklySellers(BATCH, after);
      for (const sellerId of sellers) {
        const { available } = await this.ledger.sellerBalances(sellerId);
        if (available.amount < PAYOUT_MINIMUM) {
          continue;
        }
        const done = await this.tryRequest({
          sellerId,
          trigger: 'WEEKLY',
          idempotencyKey: `weekly:${sellerId}:${week}`,
        });
        if (done) {
          requested += 1;
        } else {
          skipped += 1;
        }
      }
      if (sellers.length < BATCH) {
        break;
      }
      after = sellers.at(-1);
    }
    return { requested, skipped };
  }

  @ScheduledJob({ queue: 'payments', name: 'payments.dormant-balances', pattern: '0 4 * * *' })
  async runDormantBalances(): Promise<PayoutJobReport> {
    return this.dormantBalances(new Date());
  }

  /**
   * Saldo uśpione (§7.6): saldo poniżej minimum bez sprzedaży od 90 dni i bez otwartych zamówień
   * wypłacamy w całości. Klucz z datą: nieudana wypłata wróci następnego dnia.
   */
  async dormantBalances(now: Date): Promise<PayoutJobReport> {
    const day = toWarsawDate(now);
    const inactiveSince = new Date(now.getTime() - DORMANT_BALANCE_DAYS * DAY_MS);
    let requested = 0;
    let skipped = 0;
    let after: string | undefined;
    for (;;) {
      const sellers = await this.ledger.dormantSellerBalances({
        below: money(PAYOUT_MINIMUM),
        inactiveSince,
        limit: BATCH,
        ...(after === undefined ? {} : { after }),
      });
      for (const { sellerId } of sellers) {
        const done = await this.tryRequest({
          sellerId,
          trigger: 'DORMANT_BALANCE',
          idempotencyKey: `dormant:${sellerId}:${day}`,
        });
        if (done) {
          requested += 1;
        } else {
          skipped += 1;
        }
      }
      if (sellers.length < BATCH) {
        break;
      }
      after = sellers.at(-1)?.sellerId;
    }
    return { requested, skipped };
  }

  /** Wypłata automatyczna: warunek niespełniony (blokada, brak danych) to pominięcie, nie błąd. */
  private async tryRequest(command: RequestPayoutCommand): Promise<boolean> {
    try {
      const { replayed } = await this.request(command);
      return !replayed;
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
      this.logger.log(
        { sellerId: command.sellerId, trigger: command.trigger, code: error.code },
        'Pominięto wypłatę automatyczną',
      );
      return false;
    }
  }

  private async complete(tx: Transaction, payout: PayoutRow): Promise<void> {
    const now = new Date();
    const amount = money(payout.amount, payout.currency);
    await this.ledger.post(tx, {
      type: 'PAYOUT_COMPLETED',
      idempotencyKey: `payout:${payout.id}:completed`,
      payoutId: payout.id,
      sellerId: payout.sellerId,
      provider: payout.provider,
      amount,
    });
    await tx
      .update(payouts)
      .set({ status: 'PAID', paidAt: now, updatedAt: now })
      .where(eq(payouts.id, payout.id));
    await this.outbox.add(
      tx,
      PayoutPaid.create({
        aggregateId: payout.id,
        payload: {
          sellerId: payout.sellerId,
          amount,
          trigger: payout.trigger,
          bankAccountMasked: payout.bankAccountMasked,
        },
      }),
    );
    this.logger.log({ payoutId: payout.id, sellerId: payout.sellerId }, 'Wypłata wysłana');
  }

  private async fail(
    tx: Transaction,
    payout: PayoutRow,
    reason: PayoutFailureReason,
  ): Promise<void> {
    const now = new Date();
    const amount = money(payout.amount, payout.currency);
    await this.ledger.post(tx, {
      type: 'PAYOUT_FAILED',
      idempotencyKey: `payout:${payout.id}:failed`,
      payoutId: payout.id,
      sellerId: payout.sellerId,
      amount,
    });
    await tx
      .update(payouts)
      .set({ status: 'FAILED', failureReason: reason, failedAt: now, updatedAt: now })
      .where(eq(payouts.id, payout.id));
    await this.outbox.add(
      tx,
      PayoutFailed.create({
        aggregateId: payout.id,
        payload: { sellerId: payout.sellerId, amount, trigger: payout.trigger, reason },
      }),
    );
    this.logger.warn(
      { payoutId: payout.id, sellerId: payout.sellerId, reason },
      'Wypłata nieudana: środki wróciły na saldo',
    );
  }

  private async byKey(tx: Transaction, key: string): Promise<PayoutRow | undefined> {
    const [row] = await tx.select().from(payouts).where(eq(payouts.idempotencyKey, key));
    return row;
  }
}
