// Reguły wystawiania (F-14, PROJECT.md §4.1, §6.2, §8.2): stałe, wartość aukcji i sprawdzenie
// kompletności przed publikacją. Ta sama funkcja działa w kreatorze (podpowiedzi przy krokach)
// i w API (autorytatywnie), więc komunikaty są identyczne.
import { type AttributeDefinition, validateAttributes } from '../catalog/attributes.js';
import { formatMoney } from '../money/format.js';
import { money } from '../money/money.js';
import { BASIS_POINTS_SCALE, divideRoundHalfUp } from '../money/rounding.js';

/** Stan przedmiotu. */
export const ITEM_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'VERY_GOOD',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

/** Gabaryt paczki (§8.2): S, M, L jak w paczkomacie, XL z wymiarami i wagą (tylko kurier). */
export const PACKAGE_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];

/** Czas trwania aukcji w dniach (§6.1). */
export const AUCTION_DURATIONS_DAYS = [1, 3, 5, 7, 10] as const;
export type AuctionDurationDays = (typeof AUCTION_DURATIONS_DAYS)[number];

/** Limity pól oferty. Kwoty w groszach, waga w gramach. */
export const LISTING_RULES = {
  titleMin: 10,
  titleMax: 80,
  descriptionMin: 30,
  descriptionMax: 5000,
  brandMax: 60,
  photosMin: 1,
  photosMax: 20,
  /** Kategorie narażone na podróbki: więcej zdjęć, w tym metki i kody (F-11, §16.2). */
  brandSensitivePhotosMin: 4,
  /** Gabaryty S–L: limit wagi paczkomatu. */
  standardMaxWeightGrams: 25_000,
  xlMaxWeightGrams: 100_000,
  dimensionMaxCm: 300,
  /** Cena wywoławcza: min. 1 zł (§6.2). */
  minStartPrice: 100,
  /** Kup teraz ≥ 130% ceny wywoławczej (§6.2). */
  buyNowMinRatioBp: 13_000,
  /** Górna granica każdej ceny (10 mln zł): ochrona przed pomyłką o kilka zer. */
  maxPrice: 1_000_000_000,
} as const;

/** Poziom sprzedawcy (§4.1). Liczenie z historii zamówień i nadpisania to F-61. */
export const SELLER_LEVELS = ['NEW', 'VERIFIED', 'KYC'] as const;
export type SellerLevel = (typeof SELLER_LEVELS)[number];

export interface SellerLevelLimits {
  readonly maxActiveAuctions: number;
  /** Maks. wartość aukcji w groszach albo null (bez limitu). */
  readonly maxAuctionValue: number | null;
}

/** Wartości startowe limitów sprzedawcy z §4.1. */
export const SELLER_LIMITS: Readonly<Record<SellerLevel, SellerLevelLimits>> = {
  NEW: { maxActiveAuctions: 5, maxAuctionValue: 50_000 },
  VERIFIED: { maxActiveAuctions: 20, maxAuctionValue: 100_000 },
  KYC: { maxActiveAuctions: 50, maxAuctionValue: null },
};

/** Aukcja o wartości powyżej tej kwoty wymaga pozytywnego KYC (§4.1, §7.6). */
export const KYC_REQUIRED_ABOVE = 100_000;

export interface ListingPrices {
  readonly startPrice: number | null;
  readonly reservePrice: number | null;
  readonly buyNowPrice: number | null;
}

/**
 * Wartość aukcji na potrzeby limitów i progu KYC (§4.1): najwyższa z ceny wywoławczej,
 * minimalnej i Kup teraz (grosze); 0, gdy żadnej nie podano.
 */
export function auctionValue(prices: ListingPrices): number {
  return Math.max(0, prices.startPrice ?? 0, prices.reservePrice ?? 0, prices.buyNowPrice ?? 0);
}

/** Najniższa cena Kup teraz dla ceny wywoławczej: 130%, zaokrąglone half-up do grosza. */
export function minimumBuyNowPrice(startPrice: number): number {
  return Number(
    divideRoundHalfUp(
      BigInt(startPrice) * BigInt(LISTING_RULES.buyNowMinRatioBp),
      BigInt(BASIS_POINTS_SCALE),
    ),
  );
}

/** Oferta do sprawdzenia (szkic albo aukcja). Pola puste w szkicu to null. */
export interface ListingInput extends ListingPrices {
  readonly photoCount: number;
  readonly categoryId: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly title: string | null;
  readonly description: string | null;
  readonly condition: string | null;
  readonly brand: string | null;
  readonly packageSize: string | null;
  readonly weightGrams: number | null;
  readonly lengthCm: number | null;
  readonly widthCm: number | null;
  readonly heightCm: number | null;
  readonly allowedCarriers: readonly string[];
  readonly durationDays: number | null;
}

export interface ListingCategory {
  readonly isLeaf: boolean;
  readonly isBrandSensitive: boolean;
  /** Obowiązujące atrybuty kategorii (także dziedziczone). */
  readonly attributes: readonly AttributeDefinition[];
}

export interface ListingCarrier {
  readonly id: string;
  readonly name: string;
  readonly packageSizes: readonly string[];
}

export interface ListingSellerLimits {
  /** Maks. wartość aukcji w groszach albo null (bez limitu). */
  readonly maxAuctionValue: number | null;
  readonly kycVerified: boolean;
}

export interface ListingContext {
  /** Kategoria szkicu; undefined, gdy nie istnieje albo jest nieaktywna. */
  readonly category: ListingCategory | undefined;
  /** Aktywni przewoźnicy. */
  readonly carriers: readonly ListingCarrier[];
  /** Limity sprzedawcy; bez nich (np. w podglądzie bez danych konta) limity są pomijane. */
  readonly limits?: ListingSellerLimits | undefined;
}

/** Błąd pola: ścieżka jak w API (np. `title`, `attributes.rozmiarEu`) i komunikat po polsku. */
export interface ListingIssue {
  readonly path: string;
  readonly message: string;
}

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/** Długość tekstu w znakach (nie jednostkach UTF-16) po przycięciu; 0 dla null. */
function textLength(value: string | null): number {
  return value === null ? 0 : [...value.trim()].length;
}

function checkText(
  issues: ListingIssue[],
  path: string,
  value: string | null,
  { min, max, missing, label }: { min: number; max: number; missing: string; label: string },
): void {
  const length = textLength(value);
  if (length === 0) {
    issues.push({ path, message: missing });
  } else if (length < min) {
    issues.push({ path, message: `${label} musi mieć co najmniej ${String(min)} znaków.` });
  } else if (length > max) {
    issues.push({ path, message: `${label} może mieć najwyżej ${String(max)} znaków.` });
  }
}

function checkPhotos(issues: ListingIssue[], input: ListingInput, context: ListingContext): void {
  const min =
    context.category?.isBrandSensitive === true
      ? LISTING_RULES.brandSensitivePhotosMin
      : LISTING_RULES.photosMin;
  if (input.photoCount > LISTING_RULES.photosMax) {
    issues.push({
      path: 'mediaIds',
      message: `Możesz dodać najwyżej ${String(LISTING_RULES.photosMax)} zdjęć.`,
    });
  } else if (input.photoCount < min) {
    issues.push({
      path: 'mediaIds',
      message:
        min === 1
          ? 'Dodaj co najmniej jedno zdjęcie.'
          : `W tej kategorii dodaj co najmniej ${String(min)} zdjęcia, w tym metkę albo kod produktu.`,
    });
  }
}

function checkCategory(issues: ListingIssue[], input: ListingInput, context: ListingContext): void {
  if (input.categoryId === null) {
    issues.push({ path: 'categoryId', message: 'Wybierz kategorię.' });
    return;
  }
  const { category } = context;
  if (category === undefined) {
    issues.push({
      path: 'categoryId',
      message: 'Ta kategoria nie jest już dostępna. Wybierz inną.',
    });
    return;
  }
  if (!category.isLeaf) {
    issues.push({
      path: 'categoryId',
      message: 'Wybierz podkategorię: przedmiot trafia do najbardziej szczegółowej kategorii.',
    });
    return;
  }
  const attributes = validateAttributes(category.attributes, input.attributes);
  if (!attributes.success) {
    for (const issue of attributes.issues) {
      issues.push({
        path: issue.key === '' ? 'attributes' : `attributes.${issue.key}`,
        message: issue.message,
      });
    }
  }
}

function checkPackage(issues: ListingIssue[], input: ListingInput, context: ListingContext): void {
  const size = input.packageSize;
  if (size === null || !(PACKAGE_SIZES as readonly string[]).includes(size)) {
    issues.push({ path: 'packageSize', message: 'Wybierz gabaryt paczki.' });
  } else if (size === 'XL') {
    for (const [path, value] of [
      ['lengthCm', input.lengthCm],
      ['widthCm', input.widthCm],
      ['heightCm', input.heightCm],
    ] as const) {
      if (value === null) {
        issues.push({ path, message: 'Podaj wymiary paczki (gabaryt XL).' });
      } else if (value < 1 || value > LISTING_RULES.dimensionMaxCm) {
        issues.push({
          path,
          message: `Wymiar paczki musi wynosić od 1 do ${String(LISTING_RULES.dimensionMaxCm)} cm.`,
        });
      }
    }
    if (input.weightGrams === null) {
      issues.push({ path: 'weightGrams', message: 'Podaj wagę paczki (gabaryt XL).' });
    } else if (input.weightGrams < 1 || input.weightGrams > LISTING_RULES.xlMaxWeightGrams) {
      issues.push({ path: 'weightGrams', message: 'Waga paczki może wynosić najwyżej 100 kg.' });
    }
  } else if (
    input.weightGrams !== null &&
    (input.weightGrams < 1 || input.weightGrams > LISTING_RULES.standardMaxWeightGrams)
  ) {
    issues.push({
      path: 'weightGrams',
      message: 'Paczka w gabarycie S, M albo L może ważyć najwyżej 25 kg. Wybierz gabaryt XL.',
    });
  }

  if (input.allowedCarriers.length === 0) {
    issues.push({ path: 'allowedCarriers', message: 'Wybierz co najmniej jednego przewoźnika.' });
    return;
  }
  for (const id of input.allowedCarriers) {
    const carrier = context.carriers.find((candidate) => candidate.id === id);
    if (carrier === undefined) {
      issues.push({
        path: 'allowedCarriers',
        message: 'Jeden z wybranych przewoźników nie jest już dostępny. Wybierz innego.',
      });
    } else if (size !== null && !carrier.packageSizes.includes(size)) {
      issues.push({
        path: 'allowedCarriers',
        message: `${carrier.name} nie obsługuje gabarytu ${size}.`,
      });
    }
  }
}

function checkPrices(issues: ListingIssue[], input: ListingInput, context: ListingContext): void {
  const { startPrice, reservePrice, buyNowPrice } = input;
  if (startPrice === null) {
    issues.push({ path: 'startPrice', message: 'Podaj cenę wywoławczą.' });
  } else if (startPrice < LISTING_RULES.minStartPrice) {
    issues.push({ path: 'startPrice', message: 'Cena wywoławcza musi wynosić co najmniej 1 zł.' });
  }
  for (const [path, value] of [
    ['startPrice', startPrice],
    ['reservePrice', reservePrice],
    ['buyNowPrice', buyNowPrice],
  ] as const) {
    if (value !== null && value > LISTING_RULES.maxPrice) {
      issues.push({ path, message: `Cena może wynosić najwyżej ${zl(LISTING_RULES.maxPrice)}.` });
    }
  }
  if (startPrice !== null && reservePrice !== null && reservePrice < startPrice) {
    issues.push({
      path: 'reservePrice',
      message: 'Cena minimalna nie może być niższa niż cena wywoławcza.',
    });
  }
  if (buyNowPrice !== null) {
    if (startPrice !== null && buyNowPrice < minimumBuyNowPrice(startPrice)) {
      issues.push({
        path: 'buyNowPrice',
        message: `Cena Kup teraz musi wynosić co najmniej 130% ceny wywoławczej, czyli ${zl(minimumBuyNowPrice(startPrice))}.`,
      });
    } else if (reservePrice !== null && buyNowPrice < reservePrice) {
      issues.push({
        path: 'buyNowPrice',
        message: 'Cena Kup teraz nie może być niższa niż cena minimalna.',
      });
    }
  }

  const { limits } = context;
  const value = auctionValue(input);
  if (limits === undefined || value === 0) {
    return;
  }
  // Błąd przy polu, które wyznacza wartość aukcji (najwyższa cena).
  const path =
    value === buyNowPrice ? 'buyNowPrice' : value === reservePrice ? 'reservePrice' : 'startPrice';
  if (limits.maxAuctionValue !== null && value > limits.maxAuctionValue) {
    issues.push({
      path,
      message: `Twój limit wartości aukcji to ${zl(limits.maxAuctionValue)} (liczy się najwyższa z cen: wywoławczej, minimalnej i Kup teraz). Limit rośnie po udanych sprzedażach.`,
    });
  } else if (value > KYC_REQUIRED_ABOVE && !limits.kycVerified) {
    issues.push({
      path,
      message: `Aukcje o wartości powyżej ${zl(KYC_REQUIRED_ABOVE)} wymagają weryfikacji tożsamości u operatora płatności.`,
    });
  }
}

/**
 * Sprawdza ofertę przed publikacją (i przy edycji aktywnej aukcji). Zwraca wszystkie braki
 * naraz, w kolejności kroków kreatora: zdjęcia, kategoria i atrybuty, opis, dostawa, ceny.
 */
export function validateListing(input: ListingInput, context: ListingContext): ListingIssue[] {
  const issues: ListingIssue[] = [];
  checkPhotos(issues, input, context);
  checkCategory(issues, input, context);
  if (context.category?.isBrandSensitive === true && textLength(input.brand) === 0) {
    issues.push({ path: 'brand', message: 'Podaj markę: w tej kategorii jest wymagana.' });
  } else if (textLength(input.brand) > LISTING_RULES.brandMax) {
    issues.push({
      path: 'brand',
      message: `Marka może mieć najwyżej ${String(LISTING_RULES.brandMax)} znaków.`,
    });
  }
  checkText(issues, 'title', input.title, {
    min: LISTING_RULES.titleMin,
    max: LISTING_RULES.titleMax,
    missing: 'Podaj tytuł.',
    label: 'Tytuł',
  });
  checkText(issues, 'description', input.description, {
    min: LISTING_RULES.descriptionMin,
    max: LISTING_RULES.descriptionMax,
    missing: 'Opisz przedmiot.',
    label: 'Opis',
  });
  if (
    input.condition === null ||
    !(ITEM_CONDITIONS as readonly string[]).includes(input.condition)
  ) {
    issues.push({ path: 'condition', message: 'Wybierz stan przedmiotu.' });
  }
  checkPackage(issues, input, context);
  checkPrices(issues, input, context);
  if (
    input.durationDays === null ||
    !(AUCTION_DURATIONS_DAYS as readonly number[]).includes(input.durationDays)
  ) {
    issues.push({ path: 'durationDays', message: 'Wybierz czas trwania aukcji.' });
  }
  return issues;
}
