// Better Auth (PROJECT.md §11.2): konta e-mail i hasło, Google i Apple, sesje (ciasteczko dla
// web, token Bearer dla mobile), weryfikacja e-maila i reset hasła. Trasy pod /v1/auth/*
// (auth-routes.ts). Reguły Biddy dokładamy hookami: regulamin i 18+ przy rejestracji,
// Turnstile, licznik nieudanych logowań (§16.1).
import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';

import type { AppConfig } from '../../../infra/config/index.js';
import { type Database, newId } from '../../../infra/db/index.js';
import { AUTH_COOKIE_PREFIX, CLIENT_IP_HEADER } from '../../../infra/http/index.js';
import type { MailQueue } from '../../../infra/mail/index.js';
import { accounts, rateLimits, sessions, users, verifications } from '../db/identity.schema.js';
import type { TermsService } from '../terms/terms.service.js';
import { resetPasswordEmail, verificationEmail } from './auth-emails.js';
import type { LoginThrottle } from './login-throttle.js';
import { TURNSTILE_TOKEN_HEADER, type TurnstileVerifier } from './turnstile.js';

const DAY_SECONDS = 24 * 60 * 60;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface AuthDependencies {
  readonly config: AppConfig;
  readonly db: Database;
  readonly mail: MailQueue;
  readonly turnstile: TurnstileVerifier;
  readonly throttle: LoginThrottle;
  readonly terms: TermsService;
}

/** Ciało błędu z hooka: kod domenowy Biddy (@biddy/shared) i komunikat dla użytkownika. */
function authError(
  status: 'BAD_REQUEST' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS',
  code: string,
  message: string,
  headers?: Record<string, string>,
): APIError {
  return new APIError(status, { code, message }, headers);
}

interface HookContext {
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Headers | undefined;
  readonly request?: Request | undefined;
}

function bodyField(ctx: HookContext, field: string): unknown {
  return typeof ctx.body === 'object' && ctx.body !== null
    ? (ctx.body as Record<string, unknown>)[field]
    : undefined;
}

function clientIp(ctx: HookContext): string | undefined {
  return ctx.headers?.get(CLIENT_IP_HEADER) ?? undefined;
}

export function createAuth(deps: AuthDependencies) {
  const { config, db, mail, turnstile, throttle, terms } = deps;
  const logger = new Logger('Auth');

  async function requireCaptcha(ctx: HookContext, missingCode = 'CAPTCHA_REQUIRED'): Promise<void> {
    const token = ctx.headers?.get(TURNSTILE_TOKEN_HEADER);
    if (token === null || token === undefined || token === '') {
      throw authError(
        'FORBIDDEN',
        missingCode,
        'Potwierdź, że nie jesteś robotem, i spróbuj ponownie.',
      );
    }
    if (!(await turnstile.verify(token, clientIp(ctx)))) {
      throw authError(
        'FORBIDDEN',
        'CAPTCHA_FAILED',
        'Weryfikacja nie powiodła się albo wygasła. Spróbuj ponownie.',
      );
    }
  }

  return betterAuth({
    appName: 'Biddy',
    baseURL: config.auth.apiUrl,
    basePath: '/v1/auth',
    secret: config.auth.secret,
    trustedOrigins: [...new Set([...config.http.corsOrigins, config.auth.webUrl])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { users, sessions, accounts, verifications, rateLimits },
    }),
    user: {
      modelName: 'users',
      additionalFields: {
        isAdultDeclaredAt: { type: 'date', required: false, input: false },
        // Telefon ustawia tylko weryfikacja kodem SMS (PhoneVerificationService, F-08).
        phoneNumber: { type: 'string', required: false, input: false },
        phoneNumberVerifiedAt: { type: 'date', required: false, input: false },
        status: { type: 'string', required: false, input: false, defaultValue: 'ACTIVE' },
        staffRole: { type: 'string', required: false, input: false },
      },
    },
    session: {
      modelName: 'sessions',
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
    },
    account: {
      modelName: 'accounts',
      // Logowanie Google/Apple na adres istniejącego konta łączy konta (dostawcy potwierdzają e-mail).
      accountLinking: { enabled: true, trustedProviders: ['google', 'apple'] },
    },
    verification: { modelName: 'verifications' },
    rateLimit: {
      // Limity per IP na trasach wysyłających e-maile; w testach wyłączone (wiele kont z 127.0.0.1).
      enabled: config.env !== 'test',
      storage: 'database',
      modelName: 'rateLimits',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Zalogowany bez potwierdzonego e-maila może przeglądać i obserwować; licytowanie
      // i wystawianie blokuje @RequireVerifiedEmail().
      requireEmailVerification: false,
      autoSignIn: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mail.enqueue(resetPasswordEmail(user, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY_SECONDS,
      sendVerificationEmail: async ({ user, url }) => {
        await mail.enqueue(verificationEmail(user, url));
      },
    },
    socialProviders: {
      ...(config.auth.google === undefined ? {} : { google: config.auth.google }),
      ...(config.auth.apple === undefined
        ? {}
        : {
            apple: {
              clientId: config.auth.apple.clientId,
              clientSecret: config.auth.apple.clientSecret,
              ...(config.auth.apple.appBundleId === undefined
                ? {}
                : { appBundleIdentifier: config.auth.apple.appBundleId }),
            },
          }),
    },
    advanced: {
      database: { generateId: () => newId() },
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: config.auth.secureCookies,
      ...(config.auth.cookieDomain === undefined
        ? {}
        : { crossSubDomainCookies: { enabled: true, domain: config.auth.cookieDomain } }),
      // Adres klienta ustala Fastify (TRUST_PROXY) i przekazuje w tym nagłówku (auth-routes.ts).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user, ctx) => {
            if (ctx?.path === '/sign-up/email') {
              return Promise.resolve({ data: { ...user, isAdultDeclaredAt: new Date() } });
            }
            return Promise.resolve();
          },
          after: async (user, ctx) => {
            // Konta z Google/Apple akceptują regulamin przy pierwszym wejściu (POST /v1/me/terms-acceptances).
            if (ctx?.path === '/sign-up/email') {
              await terms.acceptCurrent(user.id, ctx.headers?.get(CLIENT_IP_HEADER) ?? undefined);
            }
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Wywołania z kodu serwera (bez żądania HTTP, np. seed) pomijają Turnstile i limity.
        if (ctx.request === undefined) {
          return;
        }
        if (ctx.path === '/sign-up/email') {
          if (
            bodyField(ctx, 'acceptTerms') !== true ||
            bodyField(ctx, 'adultDeclaration') !== true
          ) {
            throw authError(
              'BAD_REQUEST',
              'TERMS_NOT_ACCEPTED',
              'Zaakceptuj regulamin i politykę prywatności oraz potwierdź, że masz ukończone 18 lat.',
            );
          }
          await requireCaptcha(ctx);
        } else if (ctx.path === '/request-password-reset') {
          await requireCaptcha(ctx);
        } else if (ctx.path === '/sign-in/email') {
          const email = bodyField(ctx, 'email');
          const decision = await throttle.check(
            typeof email === 'string' ? email : undefined,
            clientIp(ctx),
          );
          if (decision.retryAfterMs > 0) {
            const seconds = Math.ceil(decision.retryAfterMs / 1_000);
            throw authError(
              'TOO_MANY_REQUESTS',
              'RATE_LIMITED',
              `Za dużo nieudanych prób logowania. Spróbuj ponownie za ${seconds} s.`,
              { 'retry-after': String(seconds) },
            );
          }
          if (decision.captchaRequired) {
            await requireCaptcha(ctx);
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email' || ctx.request === undefined) {
          return;
        }
        const email = bodyField(ctx, 'email');
        const address = typeof email === 'string' ? email : undefined;
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          // 401: złe hasło albo nieznany e-mail (Better Auth nie rozróżnia ich w odpowiedzi).
          if (returned.statusCode === 401) {
            await throttle.recordFailure(address, clientIp(ctx));
          }
          return;
        }
        await throttle.recordSuccess(address);
      }),
    },
    plugins: [bearer()],
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log: (level, message, ...args) => {
        const text = `${message}${args.length > 0 ? ` ${JSON.stringify(args)}` : ''}`;
        if (level === 'error') {
          logger.error(text);
        } else {
          logger.warn(text);
        }
      },
    },
    onAPIError: {
      // Błąd w przepływie z przekierowaniem (np. callback OAuth): wracamy na ekran logowania web.
      errorURL: `${config.auth.webUrl}/logowanie`,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
