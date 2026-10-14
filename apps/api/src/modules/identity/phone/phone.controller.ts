import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CurrentUser, RequireVerifiedEmail } from '../session/session.guard.js';
import type { AuthenticatedUser } from '../session/session.js';
import { PHONE_CODE_LENGTH } from './phone-code.js';
import { PHONE_NUMBER_HINT, normalizePhoneNumber } from './phone-number.js';
import { PhoneVerificationService } from './phone-verification.service.js';

export class StartPhoneVerificationDto extends createZodDto(
  z.object({
    phoneNumber: z
      .string()
      .max(32)
      .refine((value) => normalizePhoneNumber(value) !== undefined, PHONE_NUMBER_HINT)
      .describe('Polski numer komórkowy w dowolnym zapisie, np. `500 600 700` albo `+48500600700`'),
  }),
) {}

export class PhoneVerificationDto extends createZodDto(
  z.object({
    phoneNumber: z.e164().describe('Numer w formacie E.164, na który wysłano kod'),
    expiresAt: z.iso.datetime().describe('Do kiedy kod jest ważny'),
    resendAvailableAt: z.iso.datetime().describe('Od kiedy można wysłać kolejny kod'),
  }),
) {}

export class ConfirmPhoneVerificationDto extends createZodDto(
  z.object({
    code: z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`), `Kod ma ${PHONE_CODE_LENGTH} cyfr.`)
      .describe('Kod z SMS-a'),
  }),
) {}

export class VerifiedPhoneDto extends createZodDto(
  z.object({
    phoneNumber: z.e164().describe('Zweryfikowany numer (E.164)'),
    verifiedAt: z.iso.datetime(),
  }),
) {}

/**
 * Weryfikacja numeru telefonu kodem SMS (F-08). Wymaga potwierdzonego e-maila: to dodatkowa
 * bariera dla botów przed wysłaniem płatnego SMS-a.
 */
@ApiTags('me')
@Controller('me/phone-verification')
export class PhoneVerificationController {
  constructor(private readonly verifications: PhoneVerificationService) {}

  @Post()
  @RequireVerifiedEmail()
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Wysłanie kodu SMS na numer telefonu',
    description:
      'Polskie numery komórkowe. Kod ważny 5 minut. Limity: kolejny SMS po 60 s, 3 na numer na godzinę, ' +
      '10 z adresu IP na godzinę, 10 na konto na dobę (429 RATE_LIMITED z Retry-After). ' +
      'Numer innego konta: 409 PHONE_NUMBER_TAKEN (bez SMS-a).',
  })
  @ZodResponse({ status: 201, description: 'Kod wysłany', type: PhoneVerificationDto })
  async startPhoneVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: StartPhoneVerificationDto,
    @Req() request: FastifyRequest,
  ): Promise<PhoneVerificationDto> {
    const started = await this.verifications.start(user, body.phoneNumber, request.ip);
    return {
      phoneNumber: started.phoneNumber,
      expiresAt: started.expiresAt.toISOString(),
      resendAvailableAt: started.resendAvailableAt.toISOString(),
    };
  }

  @Post('confirm')
  @RequireVerifiedEmail()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Potwierdzenie numeru kodem z SMS-a',
    description:
      'Maks. 5 prób na kod: zły kod to 400 PHONE_CODE_INVALID z `remainingAttempts`, brak aktywnego ' +
      'kodu (wygasł, limit prób, wysłano nowszy) to 400 PHONE_CODE_EXPIRED. Nowy numer zastępuje ' +
      'poprzedni.',
  })
  @ZodResponse({ status: 200, description: 'Numer zweryfikowany', type: VerifiedPhoneDto })
  async confirmPhoneVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmPhoneVerificationDto,
  ): Promise<VerifiedPhoneDto> {
    const verified = await this.verifications.confirm(user, body.code);
    return { phoneNumber: verified.phoneNumber, verifiedAt: verified.verifiedAt.toISOString() };
  }
}
