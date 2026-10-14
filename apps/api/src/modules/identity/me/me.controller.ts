import { Body, Controller, Get, Header, HttpCode, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { PASSWORD_MIN_LENGTH } from '../auth/auth.js';
import { STAFF_ROLES } from '../db/identity.schema.js';
import { ProfileService, displayNameField } from '../profile/profile.service.js';
import { CurrentUser, RequireSession, SessionReader } from '../session/session.guard.js';
import type { AuthenticatedUser } from '../session/session.js';
import { TermsService } from '../terms/terms.service.js';

export class MeDto extends createZodDto(
  z.object({
    id: z.uuid(),
    name: z.string().describe('Imię wyświetlane'),
    avatarUrl: z.url().nullable().describe('Zdjęcie profilowe (WebP 256 px) albo null'),
    email: z.email(),
    emailVerified: z
      .boolean()
      .describe('Czy adres e-mail jest potwierdzony (wymagane do licytowania i wystawiania)'),
    termsAccepted: z
      .boolean()
      .describe('Czy użytkownik zaakceptował aktualne wersje regulaminu i polityki prywatności'),
    phoneNumber: z.e164().nullable().describe('Zweryfikowany numer telefonu (E.164) albo null'),
    phoneVerified: z
      .boolean()
      .describe('Czy numer telefonu jest zweryfikowany (wymagane do licytowania i wystawiania)'),
    staffRole: z
      .enum(STAFF_ROLES)
      .nullable()
      .describe('Rola wewnętrzna (panel administracyjny) albo null'),
    createdAt: z.iso.datetime(),
  }),
) {}

export class AcceptTermsDto extends createZodDto(
  z.object({
    adultDeclaration: z
      .literal(true, { error: 'Potwierdź, że masz ukończone 18 lat.' })
      .describe('Oświadczenie, że użytkownik ma ukończone 18 lat'),
  }),
) {}

export class UpdateMeDto extends createZodDto(z.object({ name: displayNameField() })) {}

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(
    private readonly terms: TermsService,
    private readonly profiles: ProfileService,
  ) {}

  @Get()
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Zalogowany użytkownik' })
  @ZodResponse({ status: 200, description: 'Zalogowany użytkownik', type: MeDto })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.toMeDto(user);
  }

  @Patch()
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Zmiana profilu (imię wyświetlane)' })
  @ZodResponse({ status: 200, description: 'Zalogowany użytkownik po zmianie', type: MeDto })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateMeDto,
  ): Promise<MeDto> {
    const name = await this.profiles.rename(user.id, body.name);
    return this.toMeDto({ ...user, name });
  }

  private async toMeDto(user: AuthenticatedUser): Promise<MeDto> {
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      email: user.email,
      emailVerified: user.emailVerified,
      termsAccepted: await this.terms.hasAcceptedCurrent(user.id),
      phoneNumber: user.phoneNumber,
      phoneVerified: user.phoneNumber !== null,
      staffRole: user.staffRole,
      createdAt: user.createdAt.toISOString(),
    };
  }

  @Post('terms-acceptances')
  @RequireSession()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Akceptacja aktualnych wersji regulaminu i polityki prywatności z oświadczeniem 18+',
    description: 'Np. po pierwszym logowaniu przez Google lub Apple albo po zmianie regulaminu.',
  })
  @ApiNoContentResponse({ description: 'Zapisano akceptację' })
  async acceptTerms(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _body: AcceptTermsDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.terms.acceptCurrent(user.id, request.ip);
    await this.terms.declareAdult(user.id);
  }
}

export class AuthOptionsDto extends createZodDto(
  z.object({
    socialProviders: z
      .array(z.enum(['google', 'apple']))
      .describe('Włączone logowanie przez dostawców (przyciski w formularzu)'),
    turnstileSiteKey: z.string().describe('Klucz witryny Cloudflare Turnstile dla widżetu'),
    passwordMinLength: z.int().describe('Minimalna długość hasła'),
  }),
) {}

@ApiTags('auth')
@Controller('auth-options')
export class AuthOptionsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  @Header('cache-control', 'public, max-age=300')
  @ApiOperation({ summary: 'Metody logowania i konfiguracja formularzy' })
  @ZodResponse({ status: 200, description: 'Metody logowania', type: AuthOptionsDto })
  getAuthOptions(): AuthOptionsDto {
    return {
      socialProviders: [
        ...(this.config.auth.google === undefined ? [] : (['google'] as const)),
        ...(this.config.auth.apple === undefined ? [] : (['apple'] as const)),
      ],
      turnstileSiteKey: this.config.auth.turnstile.siteKey,
      passwordMinLength: PASSWORD_MIN_LENGTH,
    };
  }
}

export class SessionUserDto extends createZodDto(
  z.object({
    id: z.uuid(),
    name: z.string(),
    avatarUrl: z.url().nullable(),
    emailVerified: z.boolean(),
    termsAccepted: z.boolean(),
    phoneVerified: z.boolean(),
  }),
) {}

export class SessionDto extends createZodDto(
  z.object({
    user: SessionUserDto.schema.nullable().describe('Zalogowany użytkownik albo null (gość)'),
  }),
) {}

/**
 * Stan sesji dla nagłówka strony: zawsze 200, gość dostaje `user: null`. Dzięki temu web nie
 * zapisuje błędu 401 w konsoli przy każdym wejściu niezalogowanego (dane konta: GET /v1/me).
 */
@ApiTags('me')
@Controller('session')
export class SessionController {
  constructor(
    private readonly sessions: SessionReader,
    private readonly terms: TermsService,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Stan sesji (zalogowany użytkownik albo null)' })
  @ZodResponse({ status: 200, description: 'Stan sesji', type: SessionDto })
  async getSession(@Req() request: FastifyRequest): Promise<SessionDto> {
    const session = await this.sessions.read(request);
    if (session === null) {
      return { user: null };
    }
    const { user } = session;
    return {
      user: {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        emailVerified: user.emailVerified,
        termsAccepted: await this.terms.hasAcceptedCurrent(user.id),
        phoneVerified: user.phoneNumber !== null,
      },
    };
  }
}
