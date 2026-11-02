// Walidacja formularzy kont (react-hook-form + Zod, PROJECT.md §11.3). Komunikaty z next-intl,
// reguły jak w API (hasło 10–128 znaków, e-mail, imię wyświetlane i kod pocztowy z
// @biddy/shared, regulamin i 18+, telefon i kod SMS).
import { type DisplayNameIssue, displayNameIssue, normalizePostalCode } from '@biddy/shared';
import { z } from 'zod';

/** Tłumaczenie z sekcji `auth.validation` komunikatów. */
export type ValidationMessages = (
  key:
    | 'email'
    | 'passwordMin'
    | 'passwordMax'
    | 'nameLength'
    | 'nameCharacters'
    | 'nameContact'
    | 'terms'
    | 'adult'
    | 'passwordsDiffer'
    | 'phone'
    | 'code'
    | 'recipientName'
    | 'street'
    | 'postalCode'
    | 'city',
) => string;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function email(t: ValidationMessages) {
  return z
    .string()
    .trim()
    .pipe(z.email(t('email')));
}

function password(t: ValidationMessages) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, t('passwordMin'))
    .max(PASSWORD_MAX_LENGTH, t('passwordMax'));
}

const NAME_MESSAGE_KEYS: Readonly<Record<DisplayNameIssue, Parameters<ValidationMessages>[0]>> = {
  length: 'nameLength',
  characters: 'nameCharacters',
  contact: 'nameContact',
};

/** Imię wyświetlane: reguły z @biddy/shared (te same w API), komunikat z next-intl. */
function displayName(t: ValidationMessages) {
  return z.string().superRefine((value, ctx) => {
    const issue = displayNameIssue(value);
    if (issue !== undefined) {
      ctx.addIssue({ code: 'custom', message: t(NAME_MESSAGE_KEYS[issue]) });
    }
  });
}

export function profileSchema(t: ValidationMessages) {
  return z.object({ name: displayName(t) });
}

export function signInSchema(t: ValidationMessages) {
  return z.object({ email: email(t), password: z.string().min(1, t('passwordMin')) });
}

export function signUpSchema(t: ValidationMessages) {
  return z.object({
    name: displayName(t),
    email: email(t),
    password: password(t),
    acceptTerms: z.boolean().refine((accepted) => accepted, t('terms')),
    adultDeclaration: z.boolean().refine((declared) => declared, t('adult')),
  });
}

export function consentSchema(t: ValidationMessages) {
  return z.object({
    acceptTerms: z.boolean().refine((accepted) => accepted, t('terms')),
    adultDeclaration: z.boolean().refine((declared) => declared, t('adult')),
  });
}

export function emailOnlySchema(t: ValidationMessages) {
  return z.object({ email: email(t) });
}

export function newPasswordSchema(t: ValidationMessages) {
  return z
    .object({ password: password(t), confirmPassword: z.string() })
    .refine((value) => value.password === value.confirmPassword, {
      message: t('passwordsDiffer'),
      path: ['confirmPassword'],
    });
}

/**
 * 9 cyfr polskiego numeru z dowolnego zapisu (spacje, myślniki, nawiasy, `+48`, `0048`) albo
 * `undefined`. Czy to numer komórkowy, sprawdza API (VALIDATION_FAILED z błędem pola).
 */
export function polishPhoneDigits(value: string): string | undefined {
  const compact = value.replace(/[\s\-()]/g, '');
  return /^(?:\+48|0048)?(\d{9})$/.exec(compact)?.[1];
}

export function phoneNumberSchema(t: ValidationMessages) {
  return z.object({
    phoneNumber: z.string().refine((value) => polishPhoneDigits(value) !== undefined, t('phone')),
  });
}

export const PHONE_CODE_LENGTH = 6;

export function phoneCodeSchema(t: ValidationMessages) {
  return z.object({
    code: z
      .string()
      .trim()
      .regex(new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`), t('code')),
  });
}

/** Adres dostawy albo nadania (reguły jak w API: POST /v1/me/addresses). */
export function addressSchema(t: ValidationMessages) {
  return z.object({
    recipientName: z.string().trim().min(2, t('recipientName')).max(100, t('recipientName')),
    street: z.string().trim().min(2, t('street')).max(100, t('street')),
    postalCode: z
      .string()
      .refine((value) => normalizePostalCode(value) !== undefined, t('postalCode')),
    city: z.string().trim().min(2, t('city')).max(60, t('city')),
    phone: z.string().refine((value) => polishPhoneDigits(value) !== undefined, t('phone')),
  });
}
