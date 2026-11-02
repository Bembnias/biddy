// Walidacja atrybutów w formularzu (react-hook-form + Zod): ta sama funkcja co w API
// (validateAttributes z @biddy/shared), więc komunikaty i reguły są identyczne.
import { type AttributeDefinition, type AttributeValues, validateAttributes } from '@biddy/shared';
import { z } from 'zod';

/**
 * Schemat pola `attributes` formularza: błędy przypisane do pól (`attributes.<klucz>`),
 * a po walidacji wartości gotowe do wysłania (bez pustych pól, tekst przycięty).
 */
export function attributesSchema(definitions: readonly AttributeDefinition[]) {
  return z
    .record(z.string(), z.unknown())
    .superRefine((values, ctx) => {
      const result = validateAttributes(definitions, values);
      if (!result.success) {
        for (const issue of result.issues) {
          ctx.addIssue({
            code: 'custom',
            path: issue.key === '' ? [] : [issue.key],
            message: issue.message,
          });
        }
      }
    })
    .transform((values): AttributeValues => {
      const result = validateAttributes(definitions, values);
      return result.success ? result.values : {};
    });
}
