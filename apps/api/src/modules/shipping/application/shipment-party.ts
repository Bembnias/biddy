// Dane stron przesyłki (F-24): nadawca z „Nadaj” i odbiorca z checkoutu. Schematy Zod służą
// kontrolerom (walidacja i OpenAPI), a normalizacja zapisuje telefon w E.164 i kod pocztowy
// jako NN-NNN, jak adresy w koncie (F-10). Przewoźnicy wymagają polskiego numeru komórkowego.
import { POSTAL_CODE_MESSAGE, normalizePostalCode, type ProblemFieldError } from '@biddy/shared';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { PHONE_NUMBER_HINT, normalizePhoneNumber } from '../../identity/index.js';
import type { PostalAddress, ShipmentParty } from '../db/shipping.schema.js';

function text(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min, `${label}: co najmniej ${min} znaki.`)
    .max(max, `${label}: najwyżej ${max} znaków.`);
}

export const postalAddressSchema = z.object({
  street: text('Ulica', 2, 100).describe('Ulica z numerem domu i lokalu'),
  postalCode: z
    .string()
    .max(10)
    .refine((value) => normalizePostalCode(value) !== undefined, POSTAL_CODE_MESSAGE)
    .describe('Kod pocztowy NN-NNN (przyjmuje też NNNNN)'),
  city: text('Miejscowość', 2, 60),
});

export const shipmentPartySchema = z.object({
  name: text('Imię i nazwisko', 3, 100).describe('Imię i nazwisko albo nazwa firmy'),
  phone: z
    .string()
    .max(32)
    .refine((value) => normalizePhoneNumber(value) !== undefined, PHONE_NUMBER_HINT)
    .describe('Polski numer komórkowy (dla przewoźnika)'),
  email: z.email('Podaj poprawny adres e-mail.').max(254).nullable().optional(),
});

/** Nadawca: osoba z adresem (dane na etykiecie, §8.3). */
export const senderSchema = shipmentPartySchema.extend({ address: postalAddressSchema });

export type PartyInput = z.input<typeof shipmentPartySchema> & {
  readonly address?: z.input<typeof postalAddressSchema> | null;
};

function invalid(errors: ProblemFieldError[]): DomainError {
  return new DomainError({ code: 'VALIDATION_FAILED', errors });
}

/**
 * Strona przesyłki w zapisie Biddy (telefon E.164, kod NN-NNN, adres w Polsce). Rzuca
 * VALIDATION_FAILED z błędami pól, gdy dane są złe albo brakuje wymaganego adresu.
 */
export function normalizeParty(
  input: PartyInput,
  options: { readonly path: string; readonly requireAddress: boolean },
): ShipmentParty {
  const parsed = shipmentPartySchema.safeParse(input);
  const address =
    input.address === undefined || input.address === null
      ? undefined
      : postalAddressSchema.safeParse(input.address);
  const errors: ProblemFieldError[] = [
    ...(parsed.success ? [] : parsed.error.issues),
    ...(address === undefined || address.success
      ? []
      : address.error.issues.map((issue) => ({ ...issue, path: ['address', ...issue.path] }))),
  ].map((issue) => ({
    path: [options.path, ...issue.path.map(String)].join('.'),
    code: issue.code,
    message: issue.message,
  }));
  if (options.requireAddress && address === undefined) {
    errors.push({
      path: `${options.path}.address`,
      code: 'invalid_type',
      message: 'Podaj adres.',
    });
  }
  if (!parsed.success || errors.length > 0) {
    throw invalid(errors);
  }
  const normalizedAddress: PostalAddress | null =
    address?.success === true
      ? {
          street: address.data.street,
          postalCode: normalizePostalCode(address.data.postalCode) ?? address.data.postalCode,
          city: address.data.city,
          countryCode: 'PL',
        }
      : null;
  return {
    name: parsed.data.name,
    phone: normalizePhoneNumber(parsed.data.phone) ?? parsed.data.phone,
    email: parsed.data.email ?? null,
    address: normalizedAddress,
  };
}
