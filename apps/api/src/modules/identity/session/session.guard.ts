import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import { setUser } from '@sentry/nestjs';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';

import { DomainError } from '../../../infra/http/index.js';
import { BEARER_SECURITY, SESSION_COOKIE_SECURITY } from '../../../infra/openapi/index.js';
import type { Auth } from '../auth/auth.js';
import type { StaffRole, UserStatus } from '../db/identity.schema.js';
import {
  AUTH,
  AUTH_CONTEXT,
  type AuthenticatedRequestContext,
  type AuthenticatedUser,
  type RequestWithAuth,
} from './session.js';

const REQUIRE_VERIFIED_EMAIL = 'biddy:require-verified-email';

/** Odczyt sesji z nagłówków żądania (ciasteczko albo Bearer); null bez sesji. */
@Injectable()
export class SessionReader {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async read(
    request: Pick<FastifyRequest, 'headers'>,
  ): Promise<AuthenticatedRequestContext | null> {
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (result === null) {
      return null;
    }
    return {
      sessionId: result.session.id,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        emailVerified: result.user.emailVerified,
        status: (result.user.status ?? 'ACTIVE') as UserStatus,
        staffRole: (result.user.staffRole ?? null) as StaffRole | null,
        createdAt: new Date(result.user.createdAt),
      },
    };
  }
}

/**
 * Sesja z ciasteczka albo tokenu Bearer (Better Auth). Bez sesji 401 UNAUTHORIZED, konto
 * zablokowane 403 FORBIDDEN, a przy @RequireVerifiedEmail niepotwierdzony e-mail 403
 * EMAIL_NOT_VERIFIED. Stan konta czytamy z bazy przy każdym żądaniu, więc potwierdzenie e-maila
 * i wylogowanie ze wszystkich urządzeń działają od razu.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionReader,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & RequestWithAuth>();
    const session = await this.sessions.read(request);
    if (session === null) {
      throw new DomainError({ code: 'UNAUTHORIZED' });
    }
    const { user } = session;
    if (user.status === 'BANNED') {
      throw new DomainError({ code: 'FORBIDDEN', detail: 'Konto jest zablokowane.' });
    }
    const requireVerified = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_VERIFIED_EMAIL,
      [context.getHandler(), context.getClass()],
    );
    if (requireVerified === true && !user.emailVerified) {
      throw new DomainError({ code: 'EMAIL_NOT_VERIFIED' });
    }
    request[AUTH_CONTEXT] = session;
    // Sentry: tylko identyfikator, bez e-maila (RODO).
    setUser({ id: user.id });
    return true;
  }
}

/** Trasa wymaga zalogowania (ciasteczko sesji albo Bearer); opis w OpenAPI. */
export function RequireSession(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseGuards(SessionGuard),
    ApiCookieAuth(SESSION_COOKIE_SECURITY),
    ApiBearerAuth(BEARER_SECURITY),
  );
}

/**
 * Trasa wymaga zalogowania i potwierdzonego e-maila (licytowanie F-15, wystawianie F-14).
 * Niepotwierdzony e-mail: 403 EMAIL_NOT_VERIFIED.
 */
export function RequireVerifiedEmail(): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(REQUIRE_VERIFIED_EMAIL, true), RequireSession());
}

function authContext(context: ExecutionContext): AuthenticatedRequestContext {
  const auth = context.switchToHttp().getRequest<RequestWithAuth>()[AUTH_CONTEXT];
  if (auth === undefined) {
    throw new Error(
      '@CurrentUser() wymaga @RequireSession() albo @RequireVerifiedEmail() na trasie',
    );
  }
  return auth;
}

/** Zalogowany użytkownik (w trasie z @RequireSession). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => authContext(context).user,
);
