import { Global, Inject, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { type AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import { type Database, DRIZZLE } from '../../infra/db/index.js';
import { MailQueue } from '../../infra/mail/index.js';
import { type Auth, createAuth } from './auth/auth.js';
import { registerAuthRoutes } from './auth/auth-routes.js';
import { LoginThrottle } from './auth/login-throttle.js';
import { CloudflareTurnstile, type TurnstileVerifier } from './auth/turnstile.js';
import { AddressService } from './addresses/address.service.js';
import { AddressesController } from './addresses/addresses.controller.js';
import { AuthOptionsController, MeController, SessionController } from './me/me.controller.js';
import { PhoneVerificationController } from './phone/phone.controller.js';
import { PhoneVerificationService } from './phone/phone-verification.service.js';
import { ProfileService } from './profile/profile.service.js';
import { UsersController } from './profile/users.controller.js';
import { SessionGuard, SessionReader } from './session/session.guard.js';
import { AUTH } from './session/session.js';
import { TermsService } from './terms/terms.service.js';

export const TURNSTILE_VERIFIER = Symbol('TURNSTILE_VERIFIER');

/**
 * Moduł domenowy `identity` (PROJECT.md §10.3): konta, sesje (Better Auth), regulamin,
 * weryfikacja telefonu (F-08), profil i adresy (F-10).
 * Globalny, bo guardy sesji (@RequireSession, @RequireVerifiedEmail) używają go w innych
 * modułach. Trasy /v1/auth/* rejestruje tylko w procesie HTTP (w workerze nie ma serwera).
 */
@Global()
@Module({
  controllers: [
    MeController,
    SessionController,
    AuthOptionsController,
    PhoneVerificationController,
    AddressesController,
    UsersController,
  ],
  providers: [
    {
      provide: TURNSTILE_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new CloudflareTurnstile(config.auth.turnstile.secretKey),
    },
    LoginThrottle,
    TermsService,
    PhoneVerificationService,
    ProfileService,
    AddressService,
    {
      provide: AUTH,
      inject: [APP_CONFIG, DRIZZLE, MailQueue, TURNSTILE_VERIFIER, LoginThrottle, TermsService],
      useFactory: (
        config: AppConfig,
        db: Database,
        mail: MailQueue,
        turnstile: TurnstileVerifier,
        throttle: LoginThrottle,
        terms: TermsService,
      ): Auth => createAuth({ config, db, mail, turnstile, throttle, terms }),
    },
    SessionReader,
    SessionGuard,
  ],
  exports: [AUTH, SessionReader, SessionGuard, TermsService, AddressService],
})
export class IdentityModule implements OnModuleInit {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    // W workerze (createApplicationContext) HttpAdapterHost istnieje, ale bez adaptera (null).
    const adapter = this.adapterHost?.httpAdapter as AbstractHttpAdapter | null | undefined;
    if (adapter === null || adapter === undefined) {
      return;
    }
    await registerAuthRoutes(adapter.getInstance<FastifyInstance>(), this.auth, this.config);
  }
}
