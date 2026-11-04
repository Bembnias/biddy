// Blokady między użytkownikami (F-29, decyzja nr 137): gdy jedna strona zablokowała drugą, żadna
// nie pisze w ich rozmowach ani nie zaczyna nowych. Zamówień, sporów i licytowania blokada nie
// dotyczy. Lista zablokowanych jest prywatna.
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, or } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { ProfileService } from '../../identity/index.js';
import { userBlocks } from '../db/messaging.schema.js';

/** Blokada między dwiema osobami z perspektywy pierwszej. */
export interface BlockState {
  readonly byMe: boolean;
  readonly byThem: boolean;
}

export interface BlockedUser {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly blockedAt: Date;
}

@Injectable()
export class BlockService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  /** Blokada (idempotentna). Siebie: 400; nieznane konto: 404. */
  async block(blockerId: string, blockedId: string, tx?: Transaction): Promise<void> {
    if (blockerId === blockedId) {
      throw new DomainError({ code: 'VALIDATION_FAILED', detail: 'Nie możesz zablokować siebie.' });
    }
    if (!(await this.profiles.chatProfiles([blockedId], tx)).has(blockedId)) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono użytkownika.' });
    }
    await (tx ?? this.db).insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
  }

  /** Zablokowani przez użytkownika, od najnowszej blokady. */
  async list(blockerId: string): Promise<BlockedUser[]> {
    const rows = await this.db
      .select()
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, blockerId))
      .orderBy(desc(userBlocks.createdAt));
    const profiles = await this.profiles.chatProfiles(rows.map((row) => row.blockedId));
    return rows.map((row) => {
      const profile = profiles.get(row.blockedId);
      return {
        userId: row.blockedId,
        name: profile?.name ?? '',
        avatarUrl: profile?.avatarUrl ?? null,
        blockedAt: row.createdAt,
      };
    });
  }

  /** Blokady między `userId` a `otherId` w obie strony. */
  async between(userId: string, otherId: string, tx?: Transaction): Promise<BlockState> {
    const rows = await (tx ?? this.db)
      .select({ blockerId: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, otherId)),
          and(eq(userBlocks.blockerId, otherId), eq(userBlocks.blockedId, userId)),
        ),
      );
    return {
      byMe: rows.some((row) => row.blockerId === userId),
      byThem: rows.some((row) => row.blockerId === otherId),
    };
  }
}
