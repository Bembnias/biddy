// Nieudane logowania (PROJECT.md §16.1, §22 nr 28): od 5. porażki na konto (albo 20. z jednego
// IP) logowanie wymaga Turnstile i odczekania rosnącej przerwy. Bez twardej blokady konta, bo
// pozwalałaby każdemu zablokować cudze konto, wpisując celowo złe hasło. Próg IP jest wyższy, bo
// jeden adres mają często setki osób (NAT w firmie, sieci komórkowe).
import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, lt, sql } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { loginFailures } from '../db/identity.schema.js';

/** Od tylu porażek na konto wymagany jest Turnstile i przerwa między próbami. */
export const LOGIN_FAILURE_THRESHOLD = 5;

/** Od tylu porażek z jednego IP (na różne konta) obowiązuje to samo. */
export const IP_FAILURE_THRESHOLD = 20;

/** Porażki starsze niż doba się nie liczą (licznik startuje od nowa). */
export const LOGIN_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const MAX_LOGIN_BACKOFF_MS = 5 * 60 * 1_000;

/** Przerwa po `failures` porażkach: 0 poniżej progu, potem 2 s, 4 s, 8 s… do 5 minut. */
export function loginBackoffMs(failures: number, threshold = LOGIN_FAILURE_THRESHOLD): number {
  if (failures < threshold) {
    return 0;
  }
  return Math.min(2 ** (failures - threshold + 1) * 1_000, MAX_LOGIN_BACKOFF_MS);
}

export interface FailureRecord {
  /** `email:<adres>` albo `ip:<adres>`. */
  readonly key: string;
  readonly failures: number;
  readonly lastFailureAt: Date;
}

function thresholdFor(key: string): number {
  return key.startsWith('ip:') ? IP_FAILURE_THRESHOLD : LOGIN_FAILURE_THRESHOLD;
}

export interface ThrottleDecision {
  readonly captchaRequired: boolean;
  /** Ile jeszcze trzeba poczekać przed kolejną próbą (0 = można próbować). */
  readonly retryAfterMs: number;
}

/**
 * Decyzja dla rekordów konta i IP: Turnstile, gdy którykolwiek klucz przekroczył swój próg;
 * obowiązuje dłuższa z przerw.
 */
export function throttleDecision(records: readonly FailureRecord[], now: Date): ThrottleDecision {
  let captchaRequired = false;
  let retryAfterMs = 0;
  for (const record of records) {
    const age = now.getTime() - record.lastFailureAt.getTime();
    if (age >= LOGIN_FAILURE_WINDOW_MS) {
      continue;
    }
    const threshold = thresholdFor(record.key);
    captchaRequired ||= record.failures >= threshold;
    retryAfterMs = Math.max(retryAfterMs, loginBackoffMs(record.failures, threshold) - age);
  }
  return { captchaRequired, retryAfterMs };
}

export function throttleKeys(email: string | undefined, ip: string | undefined): string[] {
  return [
    ...(email === undefined || email === '' ? [] : [`email:${email.trim().toLowerCase()}`]),
    ...(ip === undefined || ip === '' ? [] : [`ip:${ip}`]),
  ];
}

@Injectable()
export class LoginThrottle {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async check(email: string | undefined, ip: string | undefined, now = new Date()) {
    const keys = throttleKeys(email, ip);
    if (keys.length === 0) {
      return throttleDecision([], now);
    }
    const rows = await this.db.select().from(loginFailures).where(inArray(loginFailures.key, keys));
    return throttleDecision(rows, now);
  }

  /** Porażka: +1 dla konta i IP (licznik spoza okna startuje od 1). */
  async recordFailure(email: string | undefined, ip: string | undefined, now = new Date()) {
    const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
    for (const key of throttleKeys(email, ip)) {
      await this.db
        .insert(loginFailures)
        .values({ key, failures: 1, lastFailureAt: now })
        .onConflictDoUpdate({
          target: loginFailures.key,
          set: {
            failures: sql`case when ${loginFailures.lastFailureAt} < ${windowStart} then 1 else ${loginFailures.failures} + 1 end`,
            lastFailureAt: now,
          },
        });
    }
  }

  /** Udane logowanie zeruje licznik konta; licznik IP zostaje (wiele kont z jednego IP). */
  async recordSuccess(email: string | undefined): Promise<void> {
    const [key] = throttleKeys(email, undefined);
    if (key !== undefined) {
      await this.db.delete(loginFailures).where(eq(loginFailures.key, key));
    }
  }

  @ScheduledJob({
    queue: 'maintenance',
    name: 'identity.login-failures-cleanup',
    every: 60 * 60 * 1_000,
  })
  async cleanup(): Promise<number> {
    const deleted = await this.db
      .delete(loginFailures)
      .where(lt(loginFailures.lastFailureAt, new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS)))
      .returning({ key: loginFailures.key });
    return deleted.length;
  }
}
