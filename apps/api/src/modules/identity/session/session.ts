import type { StaffRole, UserStatus } from '../db/identity.schema.js';

/** Token DI instancji Better Auth (auth.ts). */
export const AUTH = Symbol('AUTH');

/** Zalogowany użytkownik widziany przez kontrolery (@CurrentUser). */
export interface AuthenticatedUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly status: UserStatus;
  readonly staffRole: StaffRole | null;
  readonly createdAt: Date;
}

export interface AuthenticatedRequestContext {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
}

/** Pole żądania, w którym SessionGuard zapisuje zalogowanego użytkownika. */
export const AUTH_CONTEXT = Symbol('biddy.auth');

export type RequestWithAuth = { [AUTH_CONTEXT]?: AuthenticatedRequestContext };
