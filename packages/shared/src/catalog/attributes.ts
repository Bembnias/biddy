// Atrybuty kategorii (F-11): definicje w formacie Biddy, dziedziczenie po ścieżce w drzewie,
// walidacja wartości przedmiotu, JSON Schema i wyświetlanie. Wspólne dla API (walidacja przy
// zapisie przedmiotu) i web (formularz generowany z definicji), więc obie strony liczą to samo.
//
// Format zamiast dowolnego JSON Schema: formularz potrzebuje etykiet, kolejności, jednostek
// i etykiet opcji, a zamknięta lista typów daje przewidywalny formularz i walidację.
import { z } from 'zod';

/** Typy atrybutów: pole tekstowe, liczba, lista wyboru, pole wyboru (tak/nie). */
export const ATTRIBUTE_TYPES = ['text', 'number', 'select', 'boolean'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** Domyślny limit długości wartości tekstowej. */
export const ATTRIBUTE_TEXT_MAX_LENGTH = 200;

const commonFields = {
  /** Klucz w wartościach przedmiotu (camelCase), np. `rozmiarEu`. */
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/u, 'klucz w camelCase, do 40 znaków'),
  /** Etykieta pola, np. „Rozmiar”. */
  label: z.string().min(1).max(60),
  required: z.boolean().optional(),
  /** Podpowiedź pod polem. */
  hint: z.string().min(1).max(200).optional(),
};

const optionSchema = z
  .object({
    value: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,39}$/u, 'wartość opcji: małe litery, cyfry, myślnik'),
    label: z.string().min(1).max(60),
  })
  .strict();

export const attributeDefinitionSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...commonFields,
      type: z.literal('text'),
      maxLength: z.int().min(1).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      ...commonFields,
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
      integer: z.boolean().optional(),
      /** Jednostka w etykiecie, np. `EU`, `cm`, `%`. */
      unit: z.string().min(1).max(10).optional(),
    })
    .strict()
    .refine((definition) => (definition.min ?? -Infinity) <= (definition.max ?? Infinity), {
      message: 'min nie może być większe niż max',
    }),
  z
    .object({
      ...commonFields,
      type: z.literal('select'),
      options: z
        .array(optionSchema)
        .min(1)
        .max(100)
        .refine(
          (options) => new Set(options.map((option) => option.value)).size === options.length,
          'wartości opcji muszą być unikalne',
        ),
    })
    .strict(),
  z.object({ ...commonFields, type: z.literal('boolean') }).strict(),
]);

export type AttributeDefinition = z.output<typeof attributeDefinitionSchema>;

/** Lista definicji jednej kategorii (klucze unikalne). */
export const attributeDefinitionsSchema = z
  .array(attributeDefinitionSchema)
  .max(50)
  .refine(
    (definitions) =>
      new Set(definitions.map((definition) => definition.key)).size === definitions.length,
    'klucze atrybutów muszą być unikalne',
  );

/** Wartości atrybutów przedmiotu (JSONB). */
export type AttributeValues = Readonly<Record<string, string | number | boolean>>;

/**
 * Atrybuty obowiązujące w kategorii: definicje ze ścieżki od korzenia. Atrybut potomka o tym
 * samym kluczu zastępuje atrybut przodka, ale zostaje na jego miejscu na liście.
 */
export function inheritAttributes(
  chain: readonly (readonly AttributeDefinition[])[],
): AttributeDefinition[] {
  const byKey = new Map<string, AttributeDefinition>();
  for (const level of chain) {
    for (const definition of level) {
      byKey.set(definition.key, definition);
    }
  }
  return [...byKey.values()];
}

export interface AttributeIssue {
  /** Klucz atrybutu ('' = całość). */
  readonly key: string;
  readonly message: string;
}

export type AttributeValidation =
  | { readonly success: true; readonly values: AttributeValues }
  | { readonly success: false; readonly issues: readonly AttributeIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Brak wartości: undefined, null, pusty tekst albo NaN (puste pole liczbowe w formularzu). */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value === 'number' && Number.isNaN(value))
  );
}

const numberFormat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

function rangeMessage(definition: Extract<AttributeDefinition, { type: 'number' }>): string {
  const { min, max } = definition;
  const kind = definition.integer === true ? 'liczbą całkowitą' : 'liczbą';
  if (min !== undefined && max !== undefined) {
    return `Pole „${definition.label}” musi być ${kind} od ${numberFormat.format(min)} do ${numberFormat.format(max)}.`;
  }
  if (min !== undefined) {
    return `Pole „${definition.label}” musi być ${kind} nie mniejszą niż ${numberFormat.format(min)}.`;
  }
  if (max !== undefined) {
    return `Pole „${definition.label}” musi być ${kind} nie większą niż ${numberFormat.format(max)}.`;
  }
  return `Pole „${definition.label}” musi być ${kind}.`;
}

/** Wartość jednego atrybutu: znormalizowana wartość, brak (`undefined`) albo komunikat błędu. */
function checkValue(
  definition: AttributeDefinition,
  raw: unknown,
): { value?: string | number | boolean; issue?: string } {
  if (definition.type === 'boolean') {
    if (raw === undefined || raw === null) {
      return { value: false };
    }
    return typeof raw === 'boolean'
      ? { value: raw }
      : { issue: `Pole „${definition.label}” musi mieć wartość tak albo nie.` };
  }
  if (isEmpty(raw)) {
    return definition.required === true
      ? { issue: `Pole „${definition.label}” jest wymagane.` }
      : {};
  }
  switch (definition.type) {
    case 'text': {
      if (typeof raw !== 'string') {
        return { issue: `Pole „${definition.label}” musi być tekstem.` };
      }
      const text = raw.trim().replace(/\s+/gu, ' ');
      const maxLength = definition.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH;
      return [...text].length > maxLength
        ? { issue: `Pole „${definition.label}” może mieć najwyżej ${maxLength} znaków.` }
        : { value: text };
    }
    case 'number': {
      const valid =
        typeof raw === 'number' &&
        Number.isFinite(raw) &&
        (definition.integer !== true || Number.isInteger(raw)) &&
        raw >= (definition.min ?? -Infinity) &&
        raw <= (definition.max ?? Infinity);
      return valid ? { value: raw } : { issue: rangeMessage(definition) };
    }
    case 'select':
      return typeof raw === 'string' && definition.options.some((option) => option.value === raw)
        ? { value: raw }
        : { issue: `Wybierz jedną z opcji pola „${definition.label}”.` };
  }
}

/**
 * Sprawdza wartości atrybutów przedmiotu z definicjami kategorii. Zwraca wartości do zapisu
 * (tekst przycięty, brakujące `boolean` jako `false`, puste pola opcjonalne pominięte) albo
 * listę błędów po polsku, po jednym na atrybut.
 */
export function validateAttributes(
  definitions: readonly AttributeDefinition[],
  input: unknown,
): AttributeValidation {
  const source = input ?? {};
  if (!isPlainObject(source)) {
    return { success: false, issues: [{ key: '', message: 'Atrybuty muszą być obiektem.' }] };
  }
  const issues: AttributeIssue[] = [];
  const values: Record<string, string | number | boolean> = {};
  const known = new Set(definitions.map((definition) => definition.key));
  for (const key of Object.keys(source)) {
    if (!known.has(key)) {
      issues.push({ key, message: 'Nieznany atrybut w tej kategorii.' });
    }
  }
  for (const definition of definitions) {
    const { value, issue } = checkValue(definition, source[definition.key]);
    if (issue !== undefined) {
      issues.push({ key: definition.key, message: issue });
    } else if (value !== undefined) {
      values[definition.key] = value;
    }
  }
  return issues.length === 0 ? { success: true, values } : { success: false, issues };
}

/** JSON Schema (draft 2020-12) wartości atrybutów, np. dla wyszukiwarki i asystenta AI. */
export function attributesJsonSchema(
  definitions: readonly AttributeDefinition[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const definition of definitions) {
    const common = {
      title: definition.label,
      ...(definition.hint === undefined ? {} : { description: definition.hint }),
    };
    switch (definition.type) {
      case 'text':
        properties[definition.key] = {
          ...common,
          type: 'string',
          ...(definition.required === true ? { minLength: 1 } : {}),
          maxLength: definition.maxLength ?? ATTRIBUTE_TEXT_MAX_LENGTH,
        };
        break;
      case 'number':
        properties[definition.key] = {
          ...common,
          type: definition.integer === true ? 'integer' : 'number',
          ...(definition.min === undefined ? {} : { minimum: definition.min }),
          ...(definition.max === undefined ? {} : { maximum: definition.max }),
          ...(definition.unit === undefined ? {} : { 'x-unit': definition.unit }),
        };
        break;
      case 'select':
        properties[definition.key] = {
          ...common,
          type: 'string',
          oneOf: definition.options.map((option) => ({ const: option.value, title: option.label })),
        };
        break;
      case 'boolean':
        properties[definition.key] = { ...common, type: 'boolean', default: false };
        break;
    }
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties,
    required: definitions
      .filter((definition) => definition.required === true || definition.type === 'boolean')
      .map((definition) => definition.key),
  };
}

export interface DescribedAttribute {
  readonly key: string;
  readonly label: string;
  /** Wartość do wyświetlenia, np. „42 EU”, „Tak”, etykieta opcji. */
  readonly value: string;
}

/**
 * Wartości zapisanego przedmiotu do wyświetlenia według aktualnych definicji. Odporne na zmiany
 * schematu kategorii: atrybuty usunięte z kategorii są pomijane, wartość spoza aktualnych opcji
 * pokazujemy tak, jak ją zapisano, a nowe atrybuty bez wartości po prostu nie występują.
 */
export function describeAttributes(
  definitions: readonly AttributeDefinition[],
  stored: unknown,
): DescribedAttribute[] {
  if (!isPlainObject(stored)) {
    return [];
  }
  const described: DescribedAttribute[] = [];
  for (const definition of definitions) {
    const raw = stored[definition.key];
    if (isEmpty(raw) || (typeof raw === 'object' && raw !== null)) {
      continue;
    }
    let value: string;
    if (definition.type === 'select') {
      value = definition.options.find((option) => option.value === raw)?.label ?? String(raw);
    } else if (definition.type === 'boolean') {
      value = raw === true ? 'Tak' : 'Nie';
    } else if (definition.type === 'number' && typeof raw === 'number') {
      value = `${numberFormat.format(raw)}${definition.unit === undefined ? '' : ` ${definition.unit}`}`;
    } else {
      value = String(raw);
    }
    described.push({ key: definition.key, label: definition.label, value });
  }
  return described;
}
