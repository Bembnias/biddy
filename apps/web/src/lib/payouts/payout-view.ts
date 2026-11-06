// Saldo i wypłaty (F-27) bez Reacta: kwota z pola wypłaty, etykieta pozycji historii i walidacja
// formularzy danych do wypłat z tymi samymi regułami co API (@biddy/shared: PESEL, NIP, IBAN,
// kod pocztowy, 18+).
import type { BalanceHistoryDto } from '@biddy/api-client';
import {
  ageInYears,
  isValidNip,
  MoneyParseError,
  normalizeIban,
  normalizePostalCode,
  normalizeTaxId,
  PAYOUT_MIN_AGE_YEARS,
  parseMoney,
  peselBirthDate,
  TAX_ID_KINDS,
  toWarsawDate,
} from '@biddy/shared';
import { z } from 'zod';

export type HistoryItem = BalanceHistoryDto['items'][number];

/** Kwota z pola wypłaty („25”, „25,50”, „1 200 zł”) w groszach albo błąd. */
export function parsePayoutAmount(text: string): number | 'empty' | 'invalid' {
  if (text.trim() === '') {
    return 'empty';
  }
  try {
    const { amount } = parseMoney(text);
    return amount > 0 ? amount : 'invalid';
  } catch (error) {
    if (error instanceof MoneyParseError) {
      return 'invalid';
    }
    throw error;
  }
}

/** Kwota w polu wypłaty do edycji: „123,45” (bez waluty i grup tysięcy). */
export function amountInputValue(amount: number): string {
  const zloty = Math.trunc(amount / 100);
  const grosze = amount % 100;
  return grosze === 0 ? String(zloty) : `${String(zloty)},${String(grosze).padStart(2, '0')}`;
}

/** Klucz etykiety pozycji historii (`balance.history.types`). */
export const HISTORY_LABELS = [
  'ORDER_COMPLETED',
  'ORDER_PARTIALLY_REFUNDED',
  'PAYOUT_REQUESTED',
  'PAYOUT_FAILED',
  'DISPUTE_COSTS_CHARGED',
  'CHARGEBACK_CHARGED_TO_SELLER',
  'PARCEL_COMPENSATION_PAID',
  'RECEIVABLE_WRITTEN_OFF',
  'REVERSAL',
] as const satisfies readonly HistoryItem['type'][];

export type HistoryLabel = (typeof HISTORY_LABELS)[number] | 'OTHER';

export function historyLabel(type: HistoryItem['type']): HistoryLabel {
  return (HISTORY_LABELS as readonly string[]).includes(type) ? (type as HistoryLabel) : 'OTHER';
}

/** Komunikaty walidacji (`payoutProfile.validation`). */
export type PayoutValidationMessages = (
  key:
    | 'firstName'
    | 'lastName'
    | 'birthDate'
    | 'adult'
    | 'PESEL'
    | 'NIP'
    | 'peselBirthDate'
    | 'street'
    | 'postalCode'
    | 'city'
    | 'iban'
    | 'holderName',
) => string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Dane osobowe do DAC7: reguły jak `PersonalDataInputDto` w API. Wiek liczymy na dzień walidacji
 * (`today` tylko w testach).
 */
export function personalDataSchema(t: PayoutValidationMessages, today?: string) {
  return z
    .object({
      firstName: z.string().trim().min(1, t('firstName')).max(100, t('firstName')),
      lastName: z.string().trim().min(1, t('lastName')).max(100, t('lastName')),
      birthDate: z.string().regex(ISO_DATE, t('birthDate')),
      taxIdKind: z.enum(TAX_ID_KINDS),
      taxId: z.string(),
      street: z.string().trim().min(2, t('street')).max(100, t('street')),
      postalCode: z
        .string()
        .refine((value) => normalizePostalCode(value) !== undefined, t('postalCode')),
      city: z.string().trim().min(2, t('city')).max(60, t('city')),
    })
    .superRefine((value, context) => {
      const taxId = normalizeTaxId(value.taxId);
      if (value.taxIdKind === 'PESEL') {
        const birthDate = peselBirthDate(taxId);
        if (birthDate === undefined) {
          context.addIssue({ code: 'custom', path: ['taxId'], message: t('PESEL') });
        } else if (ISO_DATE.test(value.birthDate) && birthDate !== value.birthDate) {
          context.addIssue({ code: 'custom', path: ['birthDate'], message: t('peselBirthDate') });
        }
      } else if (!isValidNip(taxId)) {
        context.addIssue({ code: 'custom', path: ['taxId'], message: t('NIP') });
      }
      if (
        ISO_DATE.test(value.birthDate) &&
        ageInYears(value.birthDate, today ?? toWarsawDate(new Date())) < PAYOUT_MIN_AGE_YEARS
      ) {
        context.addIssue({ code: 'custom', path: ['birthDate'], message: t('adult') });
      }
    });
}

/** Rachunek: polski IBAN z sumą kontrolną i właściciel. */
export function bankAccountSchema(t: PayoutValidationMessages) {
  return z.object({
    iban: z.string().refine((value) => normalizeIban(value) !== undefined, t('iban')),
    holderName: z.string().trim().min(2, t('holderName')).max(100, t('holderName')),
  });
}
