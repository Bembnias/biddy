// Formularz kreatora aukcji (F-14): wartości pól (teksty, jak w inputach), zamiana na zmianę
// szkicu (PATCH /v1/auctions/{id}) i na dane do `validateListing` z @biddy/shared, kroki
// kreatora i przypisanie błędów pól do kroków.
import type { ListingDto, ListingPatchDto } from '@biddy/api-client';
import {
  type ListingInput,
  type ListingIssue,
  listingStepOfPath,
  MoneyParseError,
  parseMoney,
  toDecimalString,
} from '@biddy/shared';

/**
 * Kroki kreatora: identyfikator w adresie (`?krok=`). Kolejność i pola kroków 1–5 są w
 * `LISTING_STEP_FIELDS` z @biddy/shared (te same w API przy postępie szkicu, F-63).
 */
export const LISTING_STEPS = [
  { id: 'zdjecia' },
  { id: 'kategoria' },
  { id: 'opis' },
  { id: 'dostawa' },
  { id: 'cena' },
  { id: 'podglad' },
] as const;

export type ListingStepId = (typeof LISTING_STEPS)[number]['id'];

export function isListingStep(value: string | null | undefined): value is ListingStepId {
  return LISTING_STEPS.some((step) => step.id === value);
}

/** Wartości formularza: pola tekstowe jak w inputach ('' = puste). */
export interface ListingFormValues {
  mediaIds: string[];
  categoryId: string;
  attributes: Record<string, unknown>;
  brand: string;
  title: string;
  description: string;
  condition: string;
  packageSize: string;
  weightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  allowedCarriers: string[];
  startPrice: string;
  reservePrice: string;
  buyNowPrice: string;
  durationDays: string;
}

export type ListingFormField = keyof ListingFormValues | 'kycNoticeAccepted';

/** Ścieżka błędu z API albo `validateListing` → pole formularza (waga: gramy → kilogramy). */
export function formPath(path: string): string {
  return path === 'weightGrams' ? 'weightKg' : path;
}

/** Krok, na którym jest pole (np. `attributes.rozmiarEu` → `kategoria`). */
export function stepOfPath(path: string): ListingStepId {
  // Pole wagi w formularzu jest w kilogramach, a w API i `validateListing` w gramach.
  const field = path === 'weightKg' ? 'weightGrams' : path;
  return LISTING_STEPS[listingStepOfPath(field) - 1]?.id ?? 'podglad';
}

/** Kwota w groszach do pola tekstowego: „20” albo „12,50”. */
export function priceText(amount: number | null): string {
  if (amount === null) {
    return '';
  }
  return amount % 100 === 0
    ? String(amount / 100)
    : toDecimalString({ amount, currency: 'PLN' }).replace('.', ',');
}

/** Gramy do pola w kilogramach: „1,25”. */
function kilogramsText(grams: number | null): string {
  if (grams === null) {
    return '';
  }
  return String(grams / 1000).replace('.', ',');
}

export function formValuesFrom(listing: ListingDto): ListingFormValues {
  return {
    mediaIds: listing.photos.filter((photo) => photo.status === 'READY').map((photo) => photo.id),
    categoryId: listing.categoryId ?? '',
    attributes: { ...listing.attributes },
    brand: listing.brand ?? '',
    title: listing.title ?? '',
    description: listing.description ?? '',
    condition: listing.condition ?? '',
    packageSize: listing.packageSize ?? '',
    weightKg: kilogramsText(listing.weightGrams),
    lengthCm: listing.lengthCm === null ? '' : String(listing.lengthCm),
    widthCm: listing.widthCm === null ? '' : String(listing.widthCm),
    heightCm: listing.heightCm === null ? '' : String(listing.heightCm),
    allowedCarriers: [...listing.allowedCarriers],
    startPrice: priceText(listing.startPrice),
    reservePrice: priceText(listing.reservePrice),
    buyNowPrice: priceText(listing.buyNowPrice),
    durationDays: listing.durationDays === null ? '' : String(listing.durationDays),
  };
}

type Parsed = number | null | 'invalid';

/** Cena w złotych („12,50”, „1 200 zł”) → grosze; pusta → null. */
export function parsePrice(text: string): Parsed {
  if (text.trim() === '') {
    return null;
  }
  try {
    const parsed = parseMoney(text);
    return parsed.amount < 0 ? 'invalid' : parsed.amount;
  } catch (error) {
    if (error instanceof MoneyParseError) {
      return 'invalid';
    }
    throw error;
  }
}

/** Liczba całkowita (np. centymetry). */
export function parseInteger(text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  return /^\d{1,6}$/u.test(trimmed) ? Number(trimmed) : 'invalid';
}

/** Kilogramy („1,25”, do 3 miejsc po przecinku) → gramy. */
export function parseKilograms(text: string): Parsed {
  const trimmed = text.trim().replace(/\s*kg$/iu, '');
  if (trimmed === '') {
    return null;
  }
  const match = /^(\d{1,4})(?:[.,](\d{1,3}))?$/u.exec(trimmed);
  if (match === null) {
    return 'invalid';
  }
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}

const FORMAT_MESSAGES = {
  price: 'Podaj kwotę w złotych, np. 12,50.',
  integer: 'Podaj liczbę całkowitą centymetrów.',
  weight: 'Podaj wagę w kilogramach, np. 1,5.',
} as const;

/** Atrybuty do zapisu: bez pustych pól (NaN z pustego pola liczbowego, pusty tekst). */
function cleanAttributes(
  values: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      clean[key] = value;
    } else if (typeof value === 'string' && value.trim() !== '') {
      clean[key] = value;
    }
  }
  return clean;
}

const text = (value: string) => (value.trim() === '' ? null : value);

interface Converted {
  /** Zmiana szkicu (pola z błędnym formatem są pominięte). */
  readonly patch: Required<ListingPatchDto>;
  /** Liczby po parsowaniu (błędny format = null) do `validateListing`. */
  readonly input: ListingInput;
  /** Błędy formatu (np. „12,5x zł”), na ścieżkach formularza. */
  readonly formatIssues: ListingIssue[];
}

/** Wartości formularza → PATCH i dane do walidacji. */
export function convert(values: ListingFormValues): Converted {
  const formatIssues: ListingIssue[] = [];
  const number = (
    field: keyof ListingFormValues,
    parsed: Parsed,
    kind: keyof typeof FORMAT_MESSAGES,
  ) => {
    if (parsed === 'invalid') {
      formatIssues.push({ path: field, message: FORMAT_MESSAGES[kind] });
      return null;
    }
    return parsed;
  };
  const xl = values.packageSize === 'XL';
  const startPrice = number('startPrice', parsePrice(values.startPrice), 'price');
  const reservePrice = number('reservePrice', parsePrice(values.reservePrice), 'price');
  const buyNowPrice = number('buyNowPrice', parsePrice(values.buyNowPrice), 'price');
  const weightGrams = xl ? number('weightKg', parseKilograms(values.weightKg), 'weight') : null;
  const lengthCm = xl ? number('lengthCm', parseInteger(values.lengthCm), 'integer') : null;
  const widthCm = xl ? number('widthCm', parseInteger(values.widthCm), 'integer') : null;
  const heightCm = xl ? number('heightCm', parseInteger(values.heightCm), 'integer') : null;
  const durationDays = values.durationDays === '' ? null : Number(values.durationDays);
  const attributes = cleanAttributes(values.attributes);
  const condition = values.condition === '' ? null : (values.condition as ListingDto['condition']);
  const packageSize =
    values.packageSize === '' ? null : (values.packageSize as ListingDto['packageSize']);

  const patch: Required<ListingPatchDto> = {
    mediaIds: [...values.mediaIds],
    categoryId: values.categoryId === '' ? null : values.categoryId,
    attributes,
    brand: text(values.brand),
    title: text(values.title),
    description: text(values.description),
    condition,
    packageSize,
    weightGrams,
    lengthCm,
    widthCm,
    heightCm,
    allowedCarriers: [...values.allowedCarriers],
    startPrice,
    reservePrice,
    buyNowPrice,
    durationDays,
  };
  const input: ListingInput = {
    photoCount: values.mediaIds.length,
    categoryId: patch.categoryId,
    attributes: values.attributes,
    title: patch.title,
    description: patch.description,
    condition,
    brand: patch.brand,
    packageSize,
    weightGrams,
    lengthCm,
    widthCm,
    heightCm,
    allowedCarriers: values.allowedCarriers,
    startPrice,
    reservePrice,
    buyNowPrice,
    durationDays,
  };
  return { patch, input, formatIssues };
}

/** Pola, które zmieniły się względem ostatnio zapisanego stanu (autozapis wysyła tylko je). */
export function changedFields(
  patch: Required<ListingPatchDto>,
  saved: Partial<Record<keyof ListingPatchDto, string>>,
): ListingPatchDto {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (saved[key as keyof ListingPatchDto] !== JSON.stringify(value)) {
      changed[key] = value;
    }
  }
  return changed;
}

/** Odcisk zapisanego stanu: pole → JSON wartości. */
export function snapshot(patch: ListingPatchDto): Partial<Record<keyof ListingPatchDto, string>> {
  return Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, JSON.stringify(value)]),
  );
}

/** Błędy formatu mają pierwszeństwo przed regułami tego samego pola („podaj cenę” → „zły zapis”). */
export function mergeIssues(
  formatIssues: readonly ListingIssue[],
  ruleIssues: readonly ListingIssue[],
): ListingIssue[] {
  const formatPaths = new Set(formatIssues.map((issue) => issue.path));
  return [
    ...formatIssues,
    ...ruleIssues
      .map((issue) => ({ ...issue, path: formPath(issue.path) }))
      .filter((issue) => !formatPaths.has(issue.path)),
  ];
}
