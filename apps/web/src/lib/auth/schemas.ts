// Walidacja formularzy kont (react-hook-form + Zod, PROJECT.md §11.3). Komunikaty z next-intl,
// reguły jak w API (hasło 10–128 znaków, e-mail, regulamin i 18+, telefon i kod SMS).
import { z } from 'zod';

/** Tłumaczenie z sekcji `auth.validation` komunikatów. */
export type ValidationMessages = (
  key:
    | 'email'
    | 'passwordMin'
    | 'passwordMax'
    | 'name'
    | 'terms'
    | 'adult'
    | 'passwordsDiffer'
    | 'phone'
    | 'code',
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

export function signInSchema(t: ValidationMessages) {
  return z.object({ email: email(t), password: z.string().min(1, t('passwordMin')) });
}

export function signUpSchema(t: ValidationMessages) {
  return z.object({
    name: z.string().trim().min(2, t('name')).max(60, t('name')),
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
