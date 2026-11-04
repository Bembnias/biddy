// Reputacja (F-30): średnia i liczba widocznych ocen konta (łącznie i według ról) oraz publiczna
// lista ocen z zanonimizowanym autorem. Liczone przy odczycie (decyzja nr 145): ocen jednego konta
// jest niewiele, a indeks (target_id, created_at) wystarcza. Konto nieznane albo zablokowane: 404.
import { anonymizeName, type ReviewRole } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, avg, count, desc, eq, lte, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { ProfileService } from '../../identity/index.js';
import { type ReviewRow, reviews } from '../db/reviews.schema.js';

/** Ocen na stronie listy. */
export const REVIEWS_PAGE = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface RatingStats {
  /** Średnia z dwoma miejscami po przecinku; null bez ocen. */
  readonly average: number | null;
  readonly count: number;
}

export interface UserRating extends RatingStats {
  readonly userId: string;
  /** Oceny od kupujących. */
  readonly asSeller: RatingStats;
  /** Oceny od sprzedających. */
  readonly asBuyer: RatingStats;
}

/** Ocena na profilu: autor zanonimizowany, bez numeru zamówienia i kwot. */
export interface PublicReview {
  readonly review: ReviewRow;
  readonly authorName: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

function stats(rows: readonly { count: number; sum: number }[]): RatingStats {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const points = rows.reduce((sum, row) => sum + row.sum, 0);
  return { count: total, average: total === 0 ? null : round(points / total) };
}

@Injectable()
export class ReputationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  /** Średnie i liczby widocznych ocen konta. */
  async rating(userId: string, now = new Date()): Promise<UserRating> {
    await this.requireProfile(userId);
    const rows = await this.db
      .select({
        role: reviews.role,
        count: count(),
        average: avg(reviews.rating),
      })
      .from(reviews)
      .where(and(eq(reviews.targetId, userId), lte(reviews.visibleAt, now)))
      .groupBy(reviews.role);
    const byRole = (role: ReviewRole) =>
      rows
        .filter((row) => row.role === role)
        .map((row) => ({ count: row.count, sum: Number(row.average ?? 0) * row.count }));
    const fromBuyers = byRole('BUYER');
    const fromSellers = byRole('SELLER');
    return {
      userId,
      ...stats([...fromBuyers, ...fromSellers]),
      asSeller: stats(fromBuyers),
      asBuyer: stats(fromSellers),
    };
  }

  /** Widoczne oceny konta, najnowsze pierwsze; `before` to ID ostatniej z poprzedniej strony. */
  async list(
    userId: string,
    before?: string,
    now = new Date(),
  ): Promise<{ readonly items: PublicReview[]; readonly nextBefore: string | null }> {
    await this.requireProfile(userId);
    const [cursor] =
      before === undefined
        ? []
        : await this.db
            .select({ id: reviews.id, createdAt: reviews.createdAt })
            .from(reviews)
            .where(and(eq(reviews.id, before), eq(reviews.targetId, userId)));
    const rows = await this.db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.targetId, userId),
          lte(reviews.visibleAt, now),
          cursor === undefined
            ? undefined
            : sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.createdAt}, ${cursor.id})`,
        ),
      )
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(REVIEWS_PAGE + 1);
    const page = rows.slice(0, REVIEWS_PAGE);
    const names = await this.profiles.displayNames(page.map((review) => review.authorId));
    return {
      items: page.map((review) => ({
        review,
        authorName: anonymizeName(names.get(review.authorId) ?? ''),
      })),
      nextBefore: rows.length > REVIEWS_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async requireProfile(userId: string): Promise<void> {
    const profile = UUID.test(userId) ? await this.profiles.publicProfile(userId) : undefined;
    if (profile === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono profilu.' });
    }
  }
}
