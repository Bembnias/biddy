// Polityka kont (F-61, PROJECT.md §4.1): limity poziomów i reguły strike'ów w bazie, więc zmiana
// nie wymaga deployu. Obowiązuje najnowsza wersja z `account_policies`, a bez wersji
// DEFAULT_ACCOUNT_POLICY. Proces trzyma politykę w pamięci przez ACCOUNT_POLICY_CACHE_MS.
import { type AccountPolicy, accountPolicySchema, DEFAULT_ACCOUNT_POLICY } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { accountPolicies } from '../db/standing.schema.js';

/** Zmiana polityki działa w każdym procesie (API, worker) najpóźniej po tym czasie. */
export const ACCOUNT_POLICY_CACHE_MS = 30_000;

export interface AccountPolicyVersion {
  readonly policy: AccountPolicy;
  /** null = wartości domyślne (brak zapisanej wersji). */
  readonly id: string | null;
  readonly createdAt: Date | null;
  readonly createdBy: string | null;
  readonly note: string | null;
}

const DEFAULT_VERSION: AccountPolicyVersion = {
  policy: DEFAULT_ACCOUNT_POLICY,
  id: null,
  createdAt: null,
  createdBy: null,
  note: null,
};

@Injectable()
export class AccountPolicyService {
  private readonly logger = new Logger(AccountPolicyService.name);
  private cached: { readonly version: AccountPolicyVersion; readonly at: number } | undefined;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Obowiązująca polityka (z pamięci procesu, odświeżana co ACCOUNT_POLICY_CACHE_MS). */
  async current(): Promise<AccountPolicy> {
    return (await this.currentVersion()).policy;
  }

  async currentVersion(): Promise<AccountPolicyVersion> {
    if (this.cached !== undefined && Date.now() - this.cached.at < ACCOUNT_POLICY_CACHE_MS) {
      return this.cached.version;
    }
    const version = await this.load();
    this.cached = { version, at: Date.now() };
    return version;
  }

  /** Zapisuje nową wersję (walidacja schematem) i od razu używa jej w tym procesie. */
  async publish(
    policy: AccountPolicy,
    createdBy: string,
    note?: string,
  ): Promise<AccountPolicyVersion> {
    const [row] = await this.db
      .insert(accountPolicies)
      .values({ policy: accountPolicySchema.parse(policy), createdBy, note: note ?? null })
      .returning();
    if (row === undefined) {
      throw new Error('Nie zapisano polityki kont');
    }
    const version = toVersion(row);
    this.cached = { version, at: Date.now() };
    this.logger.log({ msg: 'Nowa polityka kont', policyId: row.id, createdBy });
    return version;
  }

  /** Zapomina politykę z pamięci (testy). */
  invalidate(): void {
    this.cached = undefined;
  }

  private async load(): Promise<AccountPolicyVersion> {
    const [row] = await this.db
      .select()
      .from(accountPolicies)
      .orderBy(desc(accountPolicies.createdAt), desc(accountPolicies.id))
      .limit(1);
    if (row === undefined) {
      return DEFAULT_VERSION;
    }
    const parsed = accountPolicySchema.safeParse(row.policy);
    if (!parsed.success) {
      // Zapis zawsze waliduje; zła wersja w bazie (ręczna zmiana) nie może zatrzymać licytowania.
      this.logger.error({
        msg: 'Niepoprawna polityka kont w bazie, używam domyślnej',
        policyId: row.id,
      });
      return DEFAULT_VERSION;
    }
    return toVersion({ ...row, policy: parsed.data });
  }
}

function toVersion(row: typeof accountPolicies.$inferSelect): AccountPolicyVersion {
  return {
    policy: row.policy,
    id: row.id,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    note: row.note,
  };
}
