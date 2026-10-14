// Profil użytkownika (F-10): zmiana imienia wyświetlanego i profil publiczny (bez danych
// kontaktowych: e-mail, telefon i adresy nigdy nie trafiają do profilu publicznego).
import { DISPLAY_NAME_MESSAGES, displayNameIssue, normalizeDisplayName } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { users } from '../db/identity.schema.js';

/** Pole imienia wyświetlanego w DTO: reguły z @biddy/shared i komunikat po polsku. */
export function displayNameField() {
  return z
    .string()
    .max(200)
    .superRefine((value, ctx) => {
      const issue = displayNameIssue(value);
      if (issue !== undefined) {
        ctx.addIssue({ code: 'custom', message: DISPLAY_NAME_MESSAGES[issue] });
      }
    })
    .describe('Imię wyświetlane (2–60 znaków, bez danych kontaktowych)');
}

export interface PublicProfile {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly memberSince: Date;
  readonly phoneVerified: boolean;
}

@Injectable()
export class ProfileService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Zmienia imię wyświetlane (po normalizacji); zwraca zapisane imię. */
  async rename(userId: string, name: string): Promise<string> {
    const normalized = normalizeDisplayName(name);
    await this.db
      .update(users)
      .set({ name: normalized, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return normalized;
  }

  /**
   * Ustawia albo usuwa zdjęcie profilowe (wywołuje moduł media po sprawdzeniu zdjęcia, F-12).
   * Zwraca identyfikator poprzedniego zdjęcia, żeby moduł media mógł je zwolnić.
   */
  async setAvatar(
    userId: string,
    avatar: { readonly mediaId: string; readonly url: string } | null,
  ): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ mediaId: users.avatarMediaId })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      await tx
        .update(users)
        .set({
          avatarMediaId: avatar?.mediaId ?? null,
          avatarUrl: avatar?.url ?? null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      return current?.mediaId ?? null;
    });
  }

  /** Profil publiczny albo undefined (nieznane albo zablokowane konto). */
  async publicProfile(userId: string): Promise<PublicProfile | undefined> {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        phoneNumberVerifiedAt: users.phoneNumberVerifiedAt,
      })
      .from(users)
      .where(and(eq(users.id, userId), ne(users.status, 'BANNED')));
    return row === undefined
      ? undefined
      : {
          id: row.id,
          name: row.name,
          avatarUrl: row.avatarUrl,
          memberSince: row.createdAt,
          phoneVerified: row.phoneNumberVerifiedAt !== null,
        };
  }
}
