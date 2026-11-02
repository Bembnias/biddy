// Blokady kont (F-61, PROJECT.md §4.1): odczyt aktywnej blokady dla guardów licytowania,
// wystawiania i (od F-27) wypłat. Blokady tworzy i zdejmuje StrikeService.
import type { AccountBlockKind } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { type AccountBlockRow, accountBlocks } from '../db/standing.schema.js';
import { strongestActiveBlock } from './block-rules.js';

/** Aktywna blokada w guardzie: `until` null = bezterminowa. */
export interface ActiveBlock {
  readonly id: string;
  readonly kind: AccountBlockKind;
  readonly until: Date | null;
}

@Injectable()
export class AccountBlockService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Niezdjęte blokady użytkownika (aktywne, przyszłe i wygasłe). */
  async unlifted(userId: string, tx?: Transaction): Promise<AccountBlockRow[]> {
    return (tx ?? this.db)
      .select()
      .from(accountBlocks)
      .where(and(eq(accountBlocks.userId, userId), isNull(accountBlocks.liftedAt)));
  }

  /** Aktywna blokada danego rodzaju, która trwa najdłużej, albo undefined. */
  async active(
    userId: string,
    kind: AccountBlockKind,
    tx?: Transaction,
  ): Promise<ActiveBlock | undefined> {
    const blocks = await this.unlifted(userId, tx);
    return activeBlockOf(blocks, kind, new Date());
  }

  /** Czy użytkownik ma aktywną blokadę (np. wypłat w F-27). */
  async isBlocked(userId: string, kind: AccountBlockKind, tx?: Transaction): Promise<boolean> {
    return (await this.active(userId, kind, tx)) !== undefined;
  }
}

export function activeBlockOf(
  blocks: readonly AccountBlockRow[],
  kind: AccountBlockKind,
  now: Date,
): ActiveBlock | undefined {
  const block = strongestActiveBlock(blocks, kind, now);
  return block === undefined ? undefined : { id: block.id, kind, until: block.endsAt };
}
