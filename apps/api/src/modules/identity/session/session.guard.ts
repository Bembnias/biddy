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

/** Co trasa wymaga od konta poza sesją (metadane ustawiane przez dekoratory niżej). */
type AccountRequirement = 'verified-email' | 'verified-phone';
const ACCOUNT_REQUIREMENT = 'biddy:account-requirement';
/** Role personelu dopuszczone do trasy (@RequireStaff). */
const STAFF_ROLES_METADATA = 'biddy:staff-roles';

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
        adultDeclared: (result.user.isAdultDeclaredAt ?? null) !== null,
        phoneNumber:
          (result.user.phoneNumberVerifiedAt ?? null) === null
            ? null
            : (result.user.phoneNumber ?? null),
        avatarUrl: result.user.avatarUrl ?? null,
        status: (result.user.status ?? 'ACTIVE') as UserStatus,
        staffRole: (result.user.staffRole ?? null) as StaffRole | null,
        createdAt: new Date(result.user.createdAt),
      },
    };
  }
}

/**
 * Sesja z ciasteczka albo tokenu Bearer (Better Auth). Bez sesji 401 UNAUTHORIZED, konto
 * zablokowane 403 FORBIDDEN. @RequireVerifiedEmail: niepotwierdzony e-mail 403
 * EMAIL_NOT_VERIFIED. @RequireVerifiedPhone: dodatkowo brak oświadczenia 18+ 403
 * TERMS_NOT_ACCEPTED i niezweryfikowany telefon 403 PHONE_NOT_VERIFIED. Stan konta czytamy
 * z bazy przy każdym żądaniu, więc weryfikacje i wylogowanie ze wszystkich urządzeń działają
 * od razu.
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
    const requirement = this.reflector.getAllAndOverride<AccountRequirement | undefined>(
      ACCOUNT_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    if (requirement !== undefined && !user.emailVerified) {
      throw new DomainError({ code: 'EMAIL_NOT_VERIFIED' });
    }
    if (requirement === 'verified-phone') {
      if (!user.adultDeclared) {
        throw new DomainError({
          code: 'TERMS_NOT_ACCEPTED',
          status: 403,
          detail: 'Zaakceptuj regulamin i potwierdź, że masz ukończone 18 lat.',
        });
      }
      if (user.phoneNumber === null) {
        throw new DomainError({ code: 'PHONE_NOT_VERIFIED' });
      }
    }
    const staffRoles = this.reflector.getAllAndOverride<readonly StaffRole[] | undefined>(
      STAFF_ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (
      staffRoles !== undefined &&
      (user.staffRole === null || !staffRoles.includes(user.staffRole))
    ) {
      throw new DomainError({
        code: 'FORBIDDEN',
        detail: 'Ta operacja wymaga uprawnień personelu.',
      });
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
 * Trasa wymaga zalogowania i potwierdzonego e-maila (np. wysłanie kodu SMS).
 * Niepotwierdzony e-mail: 403 EMAIL_NOT_VERIFIED.
 */
export function RequireVerifiedEmail(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(ACCOUNT_REQUIREMENT, 'verified-email' satisfies AccountRequirement),
    RequireSession(),
  );
}

/**
 * Trasa wymaga konta gotowego do handlu: potwierdzony e-mail, oświadczenie 18+ i zweryfikowany
 * telefon (licytowanie F-15, wystawianie F-14; PROJECT.md §4). Kolejno 403 EMAIL_NOT_VERIFIED,
 * TERMS_NOT_ACCEPTED, PHONE_NOT_VERIFIED.
 */
export function RequireVerifiedPhone(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(ACCOUNT_REQUIREMENT, 'verified-phone' satisfies AccountRequirement),
    RequireSession(),
  );
}

function authContext(context: ExecutionContext): AuthenticatedRequestContext {
  const auth = context.switchToHttp().getRequest<RequestWithAuth>()[AUTH_CONTEXT];
  if (auth === undefined) {
    throw new Error(
      '@CurrentUser() wymaga @RequireSession(), @RequireVerifiedEmail() albo @RequireVerifiedPhone() na trasie',
    );
  }
  return auth;
}

/** Zalogowany użytkownik (w trasie z @RequireSession). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => authContext(context).user,
);

/**
 * Trasa tylko dla personelu z jedną z ról (np. unieważnienie oferty, F-15). Inni: 403 FORBIDDEN.
 * Do czasu osobnej sesji panelu admina (F-34, §11.5) rola pochodzi ze zwykłej sesji konta.
 */
export function RequireStaff(...roles: readonly StaffRole[]): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(STAFF_ROLES_METADATA, roles), RequireVerifiedEmail());
}
