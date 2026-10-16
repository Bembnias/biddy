// Obserwowani sprzedawcy (F-20): obserwujący dostają powiadomienie o nowej aukcji sprzedawcy
// (moduł notifications). Lista obserwujących nie jest publiczna.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { type Database, DRIZZLE, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { userFollows, users } from '../db/identity.schema.js';

/** Dane do powiadomień: adres e-mail tylko dla potwierdzonego i niezablokowanego konta. */
export interface NotificationContact {
  readonly id: string;
  readonly name: string;
  /** Adres do e-maili albo null (niepotwierdzony adres albo konto zablokowane). */
  readonly email: string | null;
}

@Injectable()
export class FollowService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Obserwowanie sprzedawcy (idempotentne). Siebie: 400; nieznany albo zablokowany: 404. */
  async follow(followerId: string, sellerId: string): Promise<void> {
    if (followerId === sellerId) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Nie możesz obserwować siebie.',
      });
    }
    const [seller] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, sellerId), ne(users.status, 'BANNED')));
    if (seller === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono użytkownika.' });
    }
    await this.db.insert(userFollows).values({ followerId, sellerId }).onConflictDoNothing();
  }

  async unfollow(followerId: string, sellerId: string): Promise<void> {
    await this.db
      .delete(userFollows)
      .where(and(eq(userFollows.followerId, followerId), eq(userFollows.sellerId, sellerId)));
  }

  async isFollowing(followerId: string, sellerId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ sellerId: userFollows.sellerId })
      .from(userFollows)
      .where(and(eq(userFollows.followerId, followerId), eq(userFollows.sellerId, sellerId)));
    return row !== undefined;
  }

  /** Obserwujący sprzedawcę (konta niezablokowane). */
  async followerIds(sellerId: string, tx?: Transaction): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ id: userFollows.followerId })
      .from(userFollows)
      .innerJoin(users, eq(users.id, userFollows.followerId))
      .where(and(eq(userFollows.sellerId, sellerId), ne(users.status, 'BANNED')));
    return rows.map((row) => row.id);
  }

  /** Imię i adres e-mail odbiorców powiadomień. */
  async contacts(userIds: readonly string[], tx?: Transaction): Promise<NotificationContact[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = await (tx ?? this.db)
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        status: users.status,
      })
      .from(users)
      .where(inArray(users.id, [...new Set(userIds)]));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.emailVerified && row.status !== 'BANNED' ? row.email : null,
    }));
  }
}
