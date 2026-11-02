// Tokeny OAuth Furgonetki (F-24) w bazie, wspólne dla API i workera. Refresh token jest
// jednorazowy, a udane odświeżenie od razu unieważnia stary token dostępu, więc odświeżamy pod
// blokadą doradczą: proces, który czekał, dostaje token odświeżony przez pierwszy. Logowanie
// hasłem robimy raz na instalację (limit 20 sesji na aplikację i konto). Tokeny szyfrujemy
// (AES-256-GCM) kluczem wyprowadzonym z BETTER_AUTH_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig, derivedSecret } from '../../../../infra/config/index.js';
import { type Database, DRIZZLE } from '../../../../infra/db/index.js';
import { furgonetkaTokens } from '../../db/shipping.schema.js';

export interface FurgonetkaTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}

export interface FurgonetkaTokenStore {
  /** Zapisane tokeny albo undefined przed pierwszym logowaniem. */
  current(): Promise<FurgonetkaTokens | undefined>;
  /**
   * Pod blokadą: gdy zapisany token dostępu jest nadal `stale` (albo go nie ma), wywołuje
   * `obtain` i zapisuje wynik; gdy inny proces już go zmienił, zwraca nowy bez wywołania.
   */
  rotate(
    stale: string | undefined,
    obtain: (current: FurgonetkaTokens | undefined) => Promise<FurgonetkaTokens>,
  ): Promise<FurgonetkaTokens>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Szyfrowanie tokenów: iv | tag | szyfrogram. */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(value: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }

  decrypt(value: Buffer): string {
    const iv = value.subarray(0, IV_BYTES);
    const tag = value.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(value.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}

@Injectable()
export class DbFurgonetkaTokenStore implements FurgonetkaTokenStore {
  private readonly cipher: TokenCipher;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.cipher = new TokenCipher(derivedSecret(config.auth.secret, 'biddy:furgonetka-tokens'));
  }

  async current(): Promise<FurgonetkaTokens | undefined> {
    const [row] = await this.db.select().from(furgonetkaTokens).where(eq(furgonetkaTokens.id, 1));
    return row === undefined ? undefined : this.decode(row);
  }

  async rotate(
    stale: string | undefined,
    obtain: (current: FurgonetkaTokens | undefined) => Promise<FurgonetkaTokens>,
  ): Promise<FurgonetkaTokens> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('biddy:furgonetka-tokens'))`);
      const [row] = await tx.select().from(furgonetkaTokens).where(eq(furgonetkaTokens.id, 1));
      const current = row === undefined ? undefined : this.decode(row);
      if (current !== undefined && current.accessToken !== stale) {
        return current;
      }
      const tokens = await obtain(current);
      const values = {
        accessToken: this.cipher.encrypt(tokens.accessToken),
        refreshToken:
          tokens.refreshToken === null ? null : this.cipher.encrypt(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      };
      await tx
        .insert(furgonetkaTokens)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: furgonetkaTokens.id, set: values });
      return tokens;
    });
  }

  private decode(row: typeof furgonetkaTokens.$inferSelect): FurgonetkaTokens {
    return {
      accessToken: this.cipher.decrypt(row.accessToken),
      refreshToken: row.refreshToken === null ? null : this.cipher.decrypt(row.refreshToken),
      expiresAt: row.expiresAt,
    };
  }
}
