import { Global, Inject, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { type AbstractHttpAdapter, HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import { type Database, DRIZZLE } from '../../infra/db/index.js';
import { MailQueue } from '../../infra/mail/index.js';
import { REALTIME_AUTHENTICATOR } from '../../infra/realtime/index.js';
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
import { BuyerStandingService } from './buyer/buyer-standing.service.js';
import { SellerStandingService } from './seller/seller-standing.service.js';
import { UsersController } from './profile/users.controller.js';
import { SessionRealtimeAuthenticator } from './session/realtime-authenticator.js';
import { SessionGuard, SessionReader } from './session/session.guard.js';
import { AUTH } from './session/session.js';
import { TermsService } from './terms/terms.service.js';
import { FollowService } from './follows/follow.service.js';
import { FollowsController } from './follows/follows.controller.js';
import { AccountBlockService } from './standing/account-block.service.js';
import { AccountPolicyService } from './standing/account-policy.service.js';
import { AccountStandingService } from './standing/account-standing.service.js';
import { AdminStandingController } from './standing/admin-standing.controller.js';
import { StandingController } from './standing/standing.controller.js';
import { StrikeService } from './standing/strike.service.js';
import { TradeHistoryService } from './standing/trade-history.service.js';

export const TURNSTILE_VERIFIER = Symbol('TURNSTILE_VERIFIER');

/**
 * Moduł domenowy `identity` (PROJECT.md §10.3): konta, sesje (Better Auth), regulamin,
 * weryfikacja telefonu (F-08), profil i adresy (F-10), stan sprzedawcy (F-14) i kupującego (F-15),
 * limity, strike'i i blokady (F-61).
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
    FollowsController,
    StandingController,
    AdminStandingController,
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
    SellerStandingService,
    BuyerStandingService,
    FollowService,
    AccountPolicyService,
    TradeHistoryService,
    AccountBlockService,
    StrikeService,
    AccountStandingService,
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
    { provide: REALTIME_AUTHENTICATOR, useClass: SessionRealtimeAuthenticator },
  ],
  exports: [
    AUTH,
    REALTIME_AUTHENTICATOR,
    SessionReader,
    SessionGuard,
    TermsService,
    AddressService,
    ProfileService,
    SellerStandingService,
    BuyerStandingService,
    FollowService,
    AccountPolicyService,
    TradeHistoryService,
    AccountBlockService,
    StrikeService,
  ],
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
