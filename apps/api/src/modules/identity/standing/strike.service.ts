// Strike'i i blokady (F-61, PROJECT.md §4.1): nadanie (system albo personel), cofnięcie, zdjęcie
// blokady i odwołania (DSA). Każda zmiana działa pod blokadą wiersza użytkownika, więc dwa
// strike'i naraz nie dadzą dwóch blokad, a ocena progu widzi wszystkie wcześniejsze zmiany.
import {
  type AppealDecision,
  type StaffStrikeReason,
  type StrikeReason,
  type StrikeRole,
  strikeRoleOf,
} from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, arrayContains, asc, desc, eq, gt, isNull } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import { users } from '../db/identity.schema.js';
import {
  type AccountBlockRow,
  accountBlocks,
  type StrikeRow,
  strikes,
} from '../db/standing.schema.js';
import {
  AccountBlocked,
  AccountBlockLifted,
  AppealResolved,
  StrikeIssued,
  StrikeRevoked,
} from '../identity.events.js';
import { AccountPolicyService } from './account-policy.service.js';
import { type BlockDecision, blockDecision, counterfeitBlocks } from './block-rules.js';
import {
  counterfeitBlockStatement,
  type StrikeContext,
  strikeStatement,
  STRIKE_REVOKED_LIFT_NOTE,
  strikesBlockStatement,
} from './statements.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Strike'i i blokady w widokach użytkownika: ostatnie 2 lata. */
const HISTORY_DAYS = 730;

export interface IssueStrikeInput {
  readonly userId: string;
  readonly reason: StrikeReason;
  /** Rola przy `OTHER`; przy innych powodach wynika z powodu. */
  readonly role?: StrikeRole;
  /** Klucz idempotencji źródła systemowego, np. `UNPAID:{orderId}`. */
  readonly sourceKey?: string;
  readonly orderId?: string;
  readonly auctionId?: string;
  readonly context?: StrikeContext;
  /** Personel, który nadaje strike; brak = system. */
  readonly issuedBy?: string;
  /** Notatka personelu: dopisana do uzasadnienia przy `OTHER` i `COUNTERFEIT`. */
  readonly note?: string;
}

export interface IssuedStrike {
  readonly strike: StrikeRow;
  readonly blocks: readonly AccountBlockRow[];
}

/** Kto zmienia stan: personel (uuid) albo system (null). */
type Actor = string | null;

function strikeNotFound(): DomainError {
  return new DomainError({ code: 'STRIKE_NOT_FOUND' });
}

function blockNotFound(): DomainError {
  return new DomainError({ code: 'ACCOUNT_BLOCK_NOT_FOUND' });
}

@Injectable()
export class StrikeService {
  private readonly logger = new Logger(StrikeService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AccountPolicyService) private readonly policies: AccountPolicyService,
    private readonly outbox: Outbox,
  ) {}

  /**
   * Nadaje strike w transakcji wywołującego i ocenia blokadę. Ten sam `sourceKey` drugi raz
   * niczego nie zmienia (undefined).
   */
  async issue(tx: Transaction, input: IssueStrikeInput): Promise<IssuedStrike | undefined> {
    await this.lockUser(tx, input.userId);
    const policy = await this.policies.current();
    const now = new Date();
    const role = strikeRoleOf(input.reason, input.role);
    const expiresAt = new Date(now.getTime() + policy.strikes.windowDays * DAY_MS);
    const [strike] = await tx
      .insert(strikes)
      .values({
        userId: input.userId,
        role,
        reason: input.reason,
        sourceKey: input.sourceKey ?? null,
        orderId: input.orderId ?? null,
        auctionId: input.auctionId ?? null,
        issuedBy: input.issuedBy ?? null,
        statement: strikeStatement({
          reason: input.reason,
          role,
          context: input.context ?? {},
          ...(input.note === undefined ? {} : { note: input.note }),
          expiresAt,
          policy,
        }),
        note: input.note ?? null,
        expiresAt,
        createdAt: now,
      })
      .onConflictDoNothing({ target: strikes.sourceKey })
      .returning();
    if (strike === undefined) {
      return undefined;
    }
    await this.outbox.add(
      tx,
      StrikeIssued.create({
        aggregateId: strike.id,
        payload: {
          userId: strike.userId,
          role,
          reason: strike.reason,
          orderId: strike.orderId,
          auctionId: strike.auctionId,
          expiresAt: expiresAt.toISOString(),
        },
      }),
    );
    const existing = await tx
      .select()
      .from(accountBlocks)
      .where(eq(accountBlocks.userId, input.userId));
    let decisions: BlockDecision[];
    if (input.reason === 'COUNTERFEIT') {
      decisions = counterfeitBlocks(strike.id, existing, now);
    } else {
      const windowStart = new Date(now.getTime() - policy.strikes.windowDays * DAY_MS);
      const recent = await tx
        .select()
        .from(strikes)
        .where(
          and(
            eq(strikes.userId, input.userId),
            eq(strikes.role, role),
            isNull(strikes.revokedAt),
            gt(strikes.createdAt, windowStart),
          ),
        );
      const decision = blockDecision(role, recent, existing, policy, now);
      decisions = decision === undefined ? [] : [decision];
    }
    const blocks: AccountBlockRow[] = [];
    for (const decision of decisions) {
      blocks.push(
        await this.createBlock(tx, input.userId, decision, () =>
          decision.cause === 'COUNTERFEIT'
            ? counterfeitBlockStatement(decision.kind)
            : strikesBlockStatement({
                kind: decision.kind,
                strikeCount: decision.strikeIds.length,
                endsAt: decision.endsAt,
                policy,
              }),
        ),
      );
    }
    this.logger.log({
      msg: 'Nadano strike',
      strikeId: strike.id,
      userId: strike.userId,
      reason: strike.reason,
      blocks: blocks.map((block) => block.kind),
    });
    return { strike, blocks };
  }

  /** Strike personelu (`POST /admin/strikes`) we własnej transakcji. */
  async issueByStaff(
    staffId: string,
    input: {
      readonly userId: string;
      readonly reason: StaffStrikeReason;
      readonly role?: StrikeRole;
      readonly note: string;
      readonly orderId?: string;
      readonly auctionId?: string;
    },
  ): Promise<IssuedStrike> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId));
      if (user === undefined) {
        throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono użytkownika.' });
      }
      const issued = await this.issue(tx, { ...input, issuedBy: staffId });
      if (issued === undefined) {
        throw new Error('Strike personelu bez klucza źródła nie może być duplikatem');
      }
      return issued;
    });
  }

  /**
   * Cofa strike w transakcji wywołującego i zdejmuje blokady, które wywołał. Cofnięty strike
   * zwraca bez zmian (idempotentne).
   */
  async revoke(tx: Transaction, strikeId: string, actor: Actor, note: string): Promise<StrikeRow> {
    const strike = await this.strikeForUpdate(tx, strikeId);
    if (strike.revokedAt !== null) {
      return strike;
    }
    const now = new Date();
    const [revoked] = await tx
      .update(strikes)
      .set({ revokedAt: now, revokedBy: actor, revokeNote: note })
      .where(eq(strikes.id, strikeId))
      .returning();
    if (revoked === undefined) {
      throw strikeNotFound();
    }
    await this.outbox.add(
      tx,
      StrikeRevoked.create({
        aggregateId: strike.id,
        payload: {
          userId: strike.userId,
          role: strike.role,
          reason: strike.reason,
          bySystem: actor === null,
        },
      }),
    );
    const caused = await tx
      .select()
      .from(accountBlocks)
      .where(
        and(
          eq(accountBlocks.userId, strike.userId),
          isNull(accountBlocks.liftedAt),
          arrayContains(accountBlocks.strikeIds, [strike.id]),
        ),
      );
    for (const block of caused) {
      await this.lift(tx, block, actor, STRIKE_REVOKED_LIFT_NOTE, now);
    }
    this.logger.log({ msg: 'Cofnięto strike', strikeId, by: actor ?? 'system' });
    return revoked;
  }

  /**
   * Cofa strike źródła systemowego (np. `UNPAID:{orderId}` po spóźnionej płatności). Brak
   * strike'a to no-op: zamówienie mogło nie dostać strike'a (np. sprzed F-61).
   */
  async revokeBySource(tx: Transaction, sourceKey: string, note: string): Promise<void> {
    const [strike] = await tx
      .select({ id: strikes.id })
      .from(strikes)
      .where(eq(strikes.sourceKey, sourceKey));
    if (strike !== undefined) {
      await this.revoke(tx, strike.id, null, note);
    }
  }

  /** Cofnięcie przez personel (`POST /admin/strikes/:id/revoke`). */
  async revokeByStaff(staffId: string, strikeId: string, note: string): Promise<StrikeRow> {
    return this.db.transaction((tx) => this.revoke(tx, strikeId, staffId, note));
  }

  /** Zdjęcie blokady przez moderatora (`POST /admin/account-blocks/:id/lift`). */
  async liftByStaff(staffId: string, blockId: string, note: string): Promise<AccountBlockRow> {
    return this.db.transaction(async (tx) => {
      const block = await this.blockForUpdate(tx, blockId);
      if (block.liftedAt !== null) {
        return block;
      }
      return this.lift(tx, block, staffId, note, new Date());
    });
  }

  /** Odwołanie użytkownika od własnego strike'a. */
  async appealStrike(userId: string, strikeId: string, message: string): Promise<StrikeRow> {
    return this.db.transaction(async (tx) => {
      const strike = await this.strikeForUpdate(tx, strikeId);
      if (strike.userId !== userId) {
        throw strikeNotFound();
      }
      await this.assertAppealable(strike, strike.revokedAt === null);
      const [updated] = await tx
        .update(strikes)
        .set({ appealStatus: 'PENDING', appealMessage: message, appealedAt: new Date() })
        .where(eq(strikes.id, strikeId))
        .returning();
      return updated ?? strike;
    });
  }

  /** Odwołanie użytkownika od własnej blokady. */
  async appealBlock(userId: string, blockId: string, message: string): Promise<AccountBlockRow> {
    return this.db.transaction(async (tx) => {
      const block = await this.blockForUpdate(tx, blockId);
      if (block.userId !== userId) {
        throw blockNotFound();
      }
      const now = new Date();
      await this.assertAppealable(
        { appealStatus: block.appealStatus, createdAt: block.createdAt },
        block.liftedAt === null && (block.endsAt === null || block.endsAt > now),
      );
      const [updated] = await tx
        .update(accountBlocks)
        .set({ appealStatus: 'PENDING', appealMessage: message, appealedAt: now })
        .where(eq(accountBlocks.id, blockId))
        .returning();
      return updated ?? block;
    });
  }

  /** Decyzja personelu w odwołaniu od strike'a; uwzględnione cofa strike razem z blokadami. */
  async decideStrikeAppeal(
    staffId: string,
    strikeId: string,
    decision: AppealDecision,
    note: string,
  ): Promise<StrikeRow> {
    return this.db.transaction(async (tx) => {
      const strike = await this.strikeForUpdate(tx, strikeId);
      if (strike.appealStatus !== 'PENDING') {
        throw new DomainError({ code: 'APPEAL_NOT_PENDING' });
      }
      if (decision === 'ACCEPTED') {
        await this.revoke(tx, strikeId, staffId, note);
      }
      const [updated] = await tx
        .update(strikes)
        .set({
          appealStatus: decision,
          appealResolvedAt: new Date(),
          appealResolvedBy: staffId,
          appealNote: note,
        })
        .where(eq(strikes.id, strikeId))
        .returning();
      await this.appealResolved(tx, strike.userId, 'STRIKE', strikeId, decision);
      return updated ?? strike;
    });
  }

  /** Decyzja personelu w odwołaniu od blokady; uwzględnione zdejmuje blokadę (strike'i zostają). */
  async decideBlockAppeal(
    staffId: string,
    blockId: string,
    decision: AppealDecision,
    note: string,
  ): Promise<AccountBlockRow> {
    return this.db.transaction(async (tx) => {
      const block = await this.blockForUpdate(tx, blockId);
      if (block.appealStatus !== 'PENDING') {
        throw new DomainError({ code: 'APPEAL_NOT_PENDING' });
      }
      if (decision === 'ACCEPTED' && block.liftedAt === null) {
        await this.lift(tx, block, staffId, note, new Date());
      }
      const [updated] = await tx
        .update(accountBlocks)
        .set({
          appealStatus: decision,
          appealResolvedAt: new Date(),
          appealResolvedBy: staffId,
          appealNote: note,
        })
        .where(eq(accountBlocks.id, blockId))
        .returning();
      await this.appealResolved(tx, block.userId, 'BLOCK', blockId, decision);
      return updated ?? block;
    });
  }

  /** Strike'i i blokady użytkownika z ostatnich 2 lat, najnowsze pierwsze. */
  async history(
    userId: string,
    tx?: Transaction,
  ): Promise<{ readonly strikes: StrikeRow[]; readonly blocks: AccountBlockRow[] }> {
    const db = tx ?? this.db;
    const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
    // Po kolei: z `tx` oba zapytania idą jednym połączeniem.
    const strikeRows = await db
      .select()
      .from(strikes)
      .where(and(eq(strikes.userId, userId), gt(strikes.createdAt, since)))
      .orderBy(desc(strikes.createdAt), desc(strikes.id));
    const blockRows = await db
      .select()
      .from(accountBlocks)
      .where(and(eq(accountBlocks.userId, userId), gt(accountBlocks.createdAt, since)))
      .orderBy(desc(accountBlocks.createdAt), desc(accountBlocks.id));
    return { strikes: strikeRows, blocks: blockRows };
  }

  /** Strike po identyfikatorze (np. treść powiadomienia) albo undefined. */
  async strikeById(id: string, tx?: Transaction): Promise<StrikeRow | undefined> {
    const [row] = await (tx ?? this.db).select().from(strikes).where(eq(strikes.id, id));
    return row;
  }

  /** Blokada po identyfikatorze albo undefined. */
  async blockById(id: string, tx?: Transaction): Promise<AccountBlockRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(accountBlocks)
      .where(eq(accountBlocks.id, id));
    return row;
  }

  /** Odwołania w toku, najstarsze pierwsze (do panelu admina, F-34). */
  async pendingAppeals(limit = 100): Promise<{
    readonly strikes: StrikeRow[];
    readonly blocks: AccountBlockRow[];
  }> {
    const [strikeRows, blockRows] = await Promise.all([
      this.db
        .select()
        .from(strikes)
        .where(eq(strikes.appealStatus, 'PENDING'))
        .orderBy(asc(strikes.appealedAt))
        .limit(limit),
      this.db
        .select()
        .from(accountBlocks)
        .where(eq(accountBlocks.appealStatus, 'PENDING'))
        .orderBy(asc(accountBlocks.appealedAt))
        .limit(limit),
    ]);
    return { strikes: strikeRows, blocks: blockRows };
  }

  /** Czy od strike'a albo blokady można się jeszcze odwołać (jedno odwołanie, w terminie). */
  async canAppeal(
    subject: { readonly appealStatus: string; readonly createdAt: Date },
    open: boolean,
  ): Promise<boolean> {
    const policy = await this.policies.current();
    return appealOpen(subject, open, policy.strikes.appealWindowDays, new Date());
  }

  private async assertAppealable(
    subject: { readonly appealStatus: string; readonly createdAt: Date },
    open: boolean,
  ): Promise<void> {
    if (!(await this.canAppeal(subject, open))) {
      throw new DomainError({ code: 'APPEAL_NOT_ALLOWED' });
    }
  }

  private async createBlock(
    tx: Transaction,
    userId: string,
    decision: BlockDecision,
    statement: () => string,
  ): Promise<AccountBlockRow> {
    const [block] = await tx
      .insert(accountBlocks)
      .values({
        userId,
        kind: decision.kind,
        cause: decision.cause,
        strikeIds: [...decision.strikeIds],
        startsAt: decision.startsAt,
        endsAt: decision.endsAt,
        statement: statement(),
        createdAt: decision.startsAt,
      })
      .returning();
    if (block === undefined) {
      throw new Error('Nie zapisano blokady');
    }
    await this.outbox.add(
      tx,
      AccountBlocked.create({
        aggregateId: block.id,
        payload: {
          userId,
          kind: block.kind,
          cause: block.cause,
          until: block.endsAt?.toISOString() ?? null,
        },
      }),
    );
    return block;
  }

  private async lift(
    tx: Transaction,
    block: AccountBlockRow,
    actor: Actor,
    note: string,
    now: Date,
  ): Promise<AccountBlockRow> {
    const [lifted] = await tx
      .update(accountBlocks)
      .set({ liftedAt: now, liftedBy: actor, liftNote: note })
      .where(and(eq(accountBlocks.id, block.id), isNull(accountBlocks.liftedAt)))
      .returning();
    if (lifted === undefined) {
      return block;
    }
    // Wygasła blokada też dostaje lifted_at (nie liczy się do eskalacji), ale bez powiadomienia.
    if (block.startsAt <= now && (block.endsAt === null || block.endsAt > now)) {
      await this.outbox.add(
        tx,
        AccountBlockLifted.create({
          aggregateId: block.id,
          payload: { userId: block.userId, kind: block.kind },
        }),
      );
    }
    return lifted;
  }

  private async appealResolved(
    tx: Transaction,
    userId: string,
    subject: 'STRIKE' | 'BLOCK',
    subjectId: string,
    decision: AppealDecision,
  ): Promise<void> {
    await this.outbox.add(
      tx,
      AppealResolved.create({
        aggregateId: subjectId,
        payload: { userId, subject, subjectId, decision },
      }),
    );
  }

  private async lockUser(tx: Transaction, userId: string): Promise<void> {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for('no key update');
    if (user === undefined) {
      throw new Error(`Nie ma użytkownika ${userId}`);
    }
  }

  /**
   * Strike pod blokadą: najpierw wiersz właściciela (ta sama kolejność co przy nadaniu, więc bez
   * zakleszczeń), potem wiersz strike'a.
   */
  private async strikeForUpdate(tx: Transaction, strikeId: string): Promise<StrikeRow> {
    const [owner] = await tx
      .select({ userId: strikes.userId })
      .from(strikes)
      .where(eq(strikes.id, strikeId));
    if (owner === undefined) {
      throw strikeNotFound();
    }
    await this.lockUser(tx, owner.userId);
    const [strike] = await tx.select().from(strikes).where(eq(strikes.id, strikeId)).for('update');
    if (strike === undefined) {
      throw strikeNotFound();
    }
    return strike;
  }

  /** Blokada pod blokadą: najpierw wiersz właściciela, potem wiersz blokady. */
  private async blockForUpdate(tx: Transaction, blockId: string): Promise<AccountBlockRow> {
    const [owner] = await tx
      .select({ userId: accountBlocks.userId })
      .from(accountBlocks)
      .where(eq(accountBlocks.id, blockId));
    if (owner === undefined) {
      throw blockNotFound();
    }
    await this.lockUser(tx, owner.userId);
    const [block] = await tx
      .select()
      .from(accountBlocks)
      .where(eq(accountBlocks.id, blockId))
      .for('update');
    if (block === undefined) {
      throw blockNotFound();
    }
    return block;
  }
}

/** Odwołanie możliwe: decyzja nadal obowiązuje, nie było odwołania i nie minął termin. */
export function appealOpen(
  subject: { readonly appealStatus: string; readonly createdAt: Date },
  open: boolean,
  appealWindowDays: number,
  now: Date,
): boolean {
  return (
    open &&
    subject.appealStatus === 'NONE' &&
    now.getTime() - subject.createdAt.getTime() <= appealWindowDays * DAY_MS
  );
}
