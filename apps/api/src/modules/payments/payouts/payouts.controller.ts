// Dane do wypłat i wypłata na żądanie (F-27). Widok salda z historią jest w module orders
// (GET /v1/me/balance), bo łączy ledger, wypłaty i tytuły zamówień.
import {
  ageInYears,
  IBAN_MESSAGE,
  isValidNip,
  normalizeIban,
  normalizePostalCode,
  normalizeTaxId,
  PAYOUT_MIN_AGE_YEARS,
  PAYOUT_STATUSES,
  PAYOUT_TRIGGERS,
  peselBirthDate,
  POSTAL_CODE_MESSAGE,
  TAX_ID_KINDS,
  TAX_ID_MESSAGES,
  toWarsawDate,
  type IsoDate,
} from '@biddy/shared';
import { Body, Controller, Get, Header, Headers, Patch, Post, Put, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { PAYOUT_FAILURE_REASONS } from '../domain/payment-values.js';
import { type PayoutProfile, PayoutProfileService } from './payout-profile.service.js';
import { type Payout, PayoutService } from './payout.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,100}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function text(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${label}: co najmniej ${min} ${min === 1 ? 'znak' : 'znaki'}.`)
    .max(max, `${label}: najwyżej ${max} znaków.`);
}

export class PersonalDataInputDto extends createZodDto(
  z
    .object({
      firstName: text('Imię', 1, 100),
      lastName: text('Nazwisko', 1, 100),
      birthDate: z
        .string()
        .regex(ISO_DATE, 'Podaj datę urodzenia w formacie RRRR-MM-DD.')
        .describe('Data urodzenia RRRR-MM-DD'),
      street: text('Ulica', 2, 100).describe('Ulica z numerem domu i lokalu'),
      postalCode: z
        .string()
        .max(10)
        .refine((value) => normalizePostalCode(value) !== undefined, POSTAL_CODE_MESSAGE)
        .describe('Kod pocztowy NN-NNN'),
      city: text('Miejscowość', 2, 60),
      taxIdKind: z.enum(TAX_ID_KINDS).describe('PESEL (osoba prywatna) albo NIP (działalność)'),
      taxId: z.string().max(20).describe('PESEL (11 cyfr) albo NIP (10 cyfr)'),
    })
    .superRefine((value, context) => {
      const taxId = normalizeTaxId(value.taxId);
      if (value.taxIdKind === 'PESEL') {
        const birthDate = peselBirthDate(taxId);
        if (birthDate === undefined) {
          context.addIssue({ code: 'custom', path: ['taxId'], message: TAX_ID_MESSAGES.PESEL });
        } else if (birthDate !== value.birthDate) {
          context.addIssue({
            code: 'custom',
            path: ['birthDate'],
            message: TAX_ID_MESSAGES.PESEL_BIRTH_DATE,
          });
        }
      } else if (!isValidNip(taxId)) {
        context.addIssue({ code: 'custom', path: ['taxId'], message: TAX_ID_MESSAGES.NIP });
      }
      if (
        ISO_DATE.test(value.birthDate) &&
        ageInYears(value.birthDate, toWarsawDate(new Date())) < PAYOUT_MIN_AGE_YEARS
      ) {
        context.addIssue({
          code: 'custom',
          path: ['birthDate'],
          message: `Wypłaty są dostępne od ${PAYOUT_MIN_AGE_YEARS} lat.`,
        });
      }
    }),
) {}

export class BankAccountInputDto extends createZodDto(
  z.object({
    iban: z
      .string()
      .max(40)
      .refine((value) => normalizeIban(value) !== undefined, IBAN_MESSAGE)
      .describe('Polski numer rachunku (26 cyfr, z PL albo bez, spacje dozwolone)'),
    holderName: text('Właściciel rachunku', 2, 100),
  }),
) {}

export class PayoutSettingsInputDto extends createZodDto(
  z.object({
    weeklyPayouts: z.boolean().describe('Wypłata całego salda w każdy poniedziałek (min. 20 zł)'),
  }),
) {}

export class RequestPayoutDto extends createZodDto(
  z.object({
    amount: z
      .int()
      .min(1)
      .max(100_000_000_000)
      .optional()
      .describe('Kwota w groszach; domyślnie całe saldo do wypłaty'),
  }),
) {}

export class PayoutProfileDto extends createZodDto(
  z.object({
    personalData: z
      .object({
        firstName: z.string(),
        lastName: z.string(),
        birthDate: z.string(),
        street: z.string(),
        postalCode: z.string(),
        city: z.string(),
        taxIdKind: z.enum(TAX_ID_KINDS),
        taxIdMasked: z.string().describe('Identyfikator bez większości cyfr, np. •••••••1359'),
      })
      .nullable(),
    bankAccount: z
      .object({
        masked: z.string().describe('Rachunek bez pełnego numeru, np. •••• 2874'),
        holderName: z.string(),
        changedAt: z.iso.datetime(),
      })
      .nullable(),
    weeklyPayouts: z.boolean(),
    payoutsBlockedUntil: z.iso
      .datetime()
      .nullable()
      .describe('Koniec blokady wypłat po zmianie rachunku (null albo już miniony = brak)'),
    complete: z.boolean().describe('Dane osobowe i rachunek zapisane'),
  }),
) {}

export class PayoutDto extends createZodDto(
  z.object({
    id: z.uuid(),
    currency: z.string(),
    amount: z.int(),
    trigger: z.enum(PAYOUT_TRIGGERS),
    status: z.enum(PAYOUT_STATUSES),
    failureReason: z.enum(PAYOUT_FAILURE_REASONS).nullable(),
    bankAccountMasked: z.string(),
    createdAt: z.iso.datetime(),
    paidAt: z.iso.datetime().nullable(),
    failedAt: z.iso.datetime().nullable(),
  }),
) {}

export function payoutProfileDto(profile: PayoutProfile): PayoutProfileDto {
  const personal = profile.personalData;
  return {
    personalData:
      personal === null
        ? null
        : {
            firstName: personal.firstName,
            lastName: personal.lastName,
            birthDate: personal.birthDate,
            street: personal.address.street,
            postalCode: personal.address.postalCode,
            city: personal.address.city,
            taxIdKind: personal.taxId.kind,
            taxIdMasked: personal.taxId.masked,
          },
    bankAccount:
      profile.bankAccount === null
        ? null
        : {
            masked: profile.bankAccount.masked,
            holderName: profile.bankAccount.holderName,
            changedAt: profile.bankAccount.changedAt.toISOString(),
          },
    weeklyPayouts: profile.weeklyPayouts,
    payoutsBlockedUntil: profile.payoutsBlockedUntil?.toISOString() ?? null,
    complete: profile.complete,
  };
}

export function payoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    currency: payout.currency,
    amount: payout.amount,
    trigger: payout.trigger,
    status: payout.status,
    failureReason: payout.failureReason,
    bankAccountMasked: payout.bankAccountMasked,
    createdAt: payout.createdAt.toISOString(),
    paidAt: payout.paidAt?.toISOString() ?? null,
    failedAt: payout.failedAt?.toISOString() ?? null,
  };
}

function idempotencyKeyOf(value: string | undefined): string {
  if (value === undefined || !IDEMPOTENCY_KEY.test(value)) {
    throw new DomainError({
      code: 'VALIDATION_FAILED',
      detail: 'Brak albo błędny nagłówek Idempotency-Key.',
      errors: [
        {
          path: 'Idempotency-Key',
          code: 'custom',
          message: 'Podaj nagłówek Idempotency-Key: 1–100 znaków (litery, cyfry, _ i -).',
        },
      ],
    });
  }
  return value;
}

@ApiTags('me')
@Controller('me')
@RequireSession()
export class PayoutsController {
  constructor(
    private readonly profiles: PayoutProfileService,
    private readonly payouts: PayoutService,
  ) {}

  @Get('payout-profile')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Dane do wypłat (DAC7 i rachunek)',
    description: 'Identyfikator podatkowy i rachunek tylko zamaskowane.',
  })
  @ZodResponse({ status: 200, description: 'Dane do wypłat', type: PayoutProfileDto })
  async getPayoutProfile(@CurrentUser() user: AuthenticatedUser): Promise<PayoutProfileDto> {
    return payoutProfileDto(await this.profiles.get(user.id));
  }

  @Put('payout-profile/personal-data')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Zapis danych osobowych do wypłat (DAC7)',
    description: 'PESEL musi zgadzać się z datą urodzenia; wypłaty od 18 lat. Dane są szyfrowane.',
  })
  @ZodResponse({ status: 200, description: 'Dane do wypłat', type: PayoutProfileDto })
  async putPersonalData(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PersonalDataInputDto,
  ): Promise<PayoutProfileDto> {
    const postalCode = normalizePostalCode(body.postalCode);
    if (postalCode === undefined) {
      throw new DomainError({ code: 'VALIDATION_FAILED', detail: POSTAL_CODE_MESSAGE });
    }
    return payoutProfileDto(
      await this.profiles.setPersonalData(user.id, {
        firstName: body.firstName,
        lastName: body.lastName,
        birthDate: body.birthDate as IsoDate,
        address: { street: body.street, postalCode, city: body.city, country: 'PL' },
        taxId: { kind: body.taxIdKind, value: normalizeTaxId(body.taxId) },
        taxResidence: 'PL',
      }),
    );
  }

  @Put('payout-profile/bank-account')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Zapis rachunku do wypłat',
    description:
      'Zmiana numeru wstrzymuje wypłaty na 48 h; każdy nowy numer wysyła powiadomienie (§16.1).',
  })
  @ZodResponse({ status: 200, description: 'Dane do wypłat', type: PayoutProfileDto })
  async putBankAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BankAccountInputDto,
  ): Promise<PayoutProfileDto> {
    const iban = normalizeIban(body.iban);
    if (iban === undefined) {
      throw new DomainError({ code: 'VALIDATION_FAILED', detail: IBAN_MESSAGE });
    }
    return payoutProfileDto(
      await this.profiles.setBankAccount(user.id, { iban, holderName: body.holderName }),
    );
  }

  @Patch('payout-settings')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({ summary: 'Ustawienia wypłat: wypłata tygodniowa' })
  @ZodResponse({ status: 200, description: 'Dane do wypłat', type: PayoutProfileDto })
  async patchPayoutSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: PayoutSettingsInputDto,
  ): Promise<PayoutProfileDto> {
    return payoutProfileDto(await this.profiles.setWeeklyPayouts(user.id, body.weeklyPayouts));
  }

  @Post('payouts')
  @Header('cache-control', 'private, no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Unikalny klucz żądania (np. UUID). Ponowienie z tym samym kluczem zwraca tę samą wypłatę.',
  })
  @ApiOperation({
    summary: 'Wypłata salda na rachunek (minimum 20 zł)',
    description:
      'Kwota domyślnie = całe saldo do wypłaty. 409 z kodem przyczyny: PAYOUT_PROFILE_INCOMPLETE, PAYOUTS_ON_HOLD, PAYOUTS_BLOCKED, RECEIVABLE_OUTSTANDING, INSUFFICIENT_BALANCE, PAYOUT_BELOW_MINIMUM, SELLER_NOT_VERIFIED.',
  })
  @ZodResponse({ status: 201, description: 'Wypłata zlecona', type: PayoutDto })
  async requestPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RequestPayoutDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PayoutDto> {
    const { payout, replayed } = await this.payouts.request({
      sellerId: user.id,
      ...(body.amount === undefined ? {} : { amount: { amount: body.amount, currency: 'PLN' } }),
      trigger: 'MANUAL',
      idempotencyKey: `manual:${user.id}:${idempotencyKeyOf(idempotencyKey)}`,
    });
    if (replayed) {
      void reply.header('idempotent-replayed', 'true');
    }
    return payoutDto(payout);
  }
}
