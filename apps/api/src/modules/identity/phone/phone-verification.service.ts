// Weryfikacja numeru telefonu kodem SMS (F-08, PROJECT.md §4): wysyłka kodu z limitami
// i potwierdzenie. Jeden numer = jedno konto (unikalny indeks users_phone_number_key).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE, newId } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { ScheduledJob } from '../../../infra/queues/index.js';
import { SMS_SENDER, type SmsSender } from '../../../infra/sms/index.js';
import { phoneVerifications, users } from '../db/identity.schema.js';
import type { AuthenticatedUser } from '../session/session.js';
import { generatePhoneCode, hashPhoneCode, phoneCodeMatches, phoneCodeSms } from './phone-code.js';
import {
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_TTL_MS,
  PHONE_RESEND_COOLDOWN_MS,
  PHONE_SEND_HISTORY_MS,
  phoneSendWaitMs,
} from './phone-limits.js';
import { normalizePhoneNumber } from './phone-number.js';

/** Niepotwierdzone weryfikacje znikają po dobie (limity patrzą najwyżej dobę wstecz). */
const UNVERIFIED_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface StartedPhoneVerification {
  readonly phoneNumber: string;
  readonly expiresAt: Date;
  readonly resendAvailableAt: Date;
}

export interface VerifiedPhone {
  readonly phoneNumber: string;
  readonly verifiedAt: Date;
}

/** Naruszenie unikalnego indeksu Postgres (kod 23505), także opakowane przez Drizzle. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === '23505' && pg.constraint === constraint) {
      return true;
    }
  }
  return false;
}

function phoneTaken(): DomainError {
  return new DomainError({ code: 'PHONE_NUMBER_TAKEN' });
}

@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Wysyła kod SMS na numer (polski komórkowy, dowolny zapis). Numer innego konta: 409
   * PHONE_NUMBER_TAKEN bez SMS-a. Limity: 429 RATE_LIMITED z Retry-After.
   */
  async start(
    user: AuthenticatedUser,
    input: string,
    ip: string | undefined,
    now = new Date(),
  ): Promise<StartedPhoneVerification> {
    const phoneNumber = normalizePhoneNumber(input);
    if (phoneNumber === undefined) {
      // DTO odrzuca zły numer wcześniej; to zabezpieczenie dla wywołań z kodu.
      throw new DomainError({ code: 'VALIDATION_FAILED' });
    }
    if (user.phoneNumber === phoneNumber) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Ten numer jest już zweryfikowany na Twoim koncie.',
      });
    }
    const [owner] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phoneNumber, phoneNumber), ne(users.id, user.id)))
      .limit(1);
    if (owner !== undefined) {
      throw phoneTaken();
    }

    const waitMs = await this.sendWaitMs(user.id, phoneNumber, ip, now);
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1_000);
      throw new DomainError({
        code: 'RATE_LIMITED',
        detail:
          seconds <= 60
            ? `Kolejny SMS możesz wysłać za ${seconds} s.`
            : `Wysłaliśmy już kilka SMS-ów. Spróbuj ponownie za ${Math.ceil(seconds / 60)} min.`,
        headers: { 'retry-after': String(seconds) },
        extensions: { retryAfterSeconds: seconds },
      });
    }

    const id = newId();
    const code = generatePhoneCode();
    const expiresAt = new Date(now.getTime() + PHONE_CODE_TTL_MS);
    await this.db.insert(phoneVerifications).values({
      id,
      userId: user.id,
      phoneNumber,
      codeHash: hashPhoneCode(this.config.auth.secret, id, code),
      ip: ip ?? null,
      expiresAt,
      createdAt: now,
    });
    try {
      await this.sms.send({ to: phoneNumber, text: phoneCodeSms(code, this.config.auth.webUrl) });
    } catch (error) {
      // Nieudana wysyłka nie liczy się do limitów: użytkownik może od razu spróbować ponownie.
      await this.db.delete(phoneVerifications).where(eq(phoneVerifications.id, id));
      this.logger.error(error, 'Nie udało się wysłać SMS-a z kodem');
      throw new DomainError({
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Nie udało się wysłać SMS-a. Spróbuj ponownie za chwilę.',
        cause: error,
      });
    }
    return {
      phoneNumber,
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + PHONE_RESEND_COOLDOWN_MS),
    };
  }

  /**
   * Potwierdza ostatnio wysłany kod. Próba jest liczona atomowo przed porównaniem, więc
   * równoległe żądania nie dają więcej niż {@link PHONE_CODE_MAX_ATTEMPTS} prób.
   */
  async confirm(user: AuthenticatedUser, code: string, now = new Date()): Promise<VerifiedPhone> {
    const [latest] = await this.db
      .select({ id: phoneVerifications.id })
      .from(phoneVerifications)
      .where(eq(phoneVerifications.userId, user.id))
      .orderBy(desc(phoneVerifications.createdAt), desc(phoneVerifications.id))
      .limit(1);
    const [attempt] =
      latest === undefined
        ? []
        : await this.db
            .update(phoneVerifications)
            .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
            .where(
              and(
                eq(phoneVerifications.id, latest.id),
                isNull(phoneVerifications.verifiedAt),
                gt(phoneVerifications.expiresAt, now),
                lt(phoneVerifications.attempts, PHONE_CODE_MAX_ATTEMPTS),
              ),
            )
            .returning();
    if (attempt === undefined) {
      throw new DomainError({ code: 'PHONE_CODE_EXPIRED' });
    }
    if (!phoneCodeMatches(this.config.auth.secret, attempt.id, code, attempt.codeHash)) {
      const remainingAttempts = PHONE_CODE_MAX_ATTEMPTS - attempt.attempts;
      throw new DomainError({
        code: 'PHONE_CODE_INVALID',
        detail:
          remainingAttempts > 0
            ? `Nieprawidłowy kod. Pozostałe próby: ${remainingAttempts}.`
            : 'Nieprawidłowy kod. Wykorzystano limit prób, wyślij nowy kod.',
        extensions: { remainingAttempts },
      });
    }

    try {
      await this.db.transaction(async (tx) => {
        const verified = await tx
          .update(phoneVerifications)
          .set({ verifiedAt: now })
          .where(and(eq(phoneVerifications.id, attempt.id), isNull(phoneVerifications.verifiedAt)))
          .returning({ id: phoneVerifications.id });
        if (verified.length === 0) {
          // Równoległe potwierdzenie tego samego kodu już się udało.
          throw new DomainError({ code: 'PHONE_CODE_EXPIRED' });
        }
        await tx
          .update(users)
          .set({ phoneNumber: attempt.phoneNumber, phoneNumberVerifiedAt: now, updatedAt: now })
          .where(eq(users.id, user.id));
      });
    } catch (error) {
      if (isUniqueViolation(error, 'users_phone_number_key')) {
        throw phoneTaken();
      }
      throw error;
    }
    return { phoneNumber: attempt.phoneNumber, verifiedAt: now };
  }

  private async sendWaitMs(
    userId: string,
    phoneNumber: string,
    ip: string | undefined,
    now: Date,
  ): Promise<number> {
    const rows = await this.db
      .select({
        userId: phoneVerifications.userId,
        phoneNumber: phoneVerifications.phoneNumber,
        ip: phoneVerifications.ip,
        createdAt: phoneVerifications.createdAt,
      })
      .from(phoneVerifications)
      .where(
        and(
          gte(phoneVerifications.createdAt, new Date(now.getTime() - PHONE_SEND_HISTORY_MS)),
          or(
            eq(phoneVerifications.userId, userId),
            eq(phoneVerifications.phoneNumber, phoneNumber),
            ...(ip === undefined ? [] : [eq(phoneVerifications.ip, ip)]),
          ),
        ),
      );
    return phoneSendWaitMs(
      {
        byUser: rows.filter((row) => row.userId === userId).map((row) => row.createdAt),
        byPhoneNumber: rows
          .filter((row) => row.phoneNumber === phoneNumber)
          .map((row) => row.createdAt),
        byIp:
          ip === undefined ? [] : rows.filter((row) => row.ip === ip).map((row) => row.createdAt),
      },
      now,
    );
  }

  @ScheduledJob({
    queue: 'maintenance',
    name: 'identity.phone-verifications-cleanup',
    every: 60 * 60 * 1_000,
  })
  async cleanup(): Promise<number> {
    const deleted = await this.db
      .delete(phoneVerifications)
      .where(
        and(
          isNull(phoneVerifications.verifiedAt),
          lt(phoneVerifications.createdAt, new Date(Date.now() - UNVERIFIED_RETENTION_MS)),
        ),
      )
      .returning({ id: phoneVerifications.id });
    return deleted.length;
  }
}
