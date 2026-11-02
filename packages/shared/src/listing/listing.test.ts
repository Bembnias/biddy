import { describe, expect, it } from 'vitest';

import {
  type AttributeDefinition,
  auctionValue,
  completedListingSteps,
  type ListingContext,
  type ListingInput,
  listingStepOfPath,
  minimumBuyNowPrice,
  validateListing,
} from '../index.js';

const ATTRIBUTES: AttributeDefinition[] = [
  { key: 'rozmiarEu', label: 'Rozmiar', type: 'number', min: 15, max: 52, required: true },
];

const CONTEXT: ListingContext = {
  category: { isLeaf: true, isBrandSensitive: false, attributes: ATTRIBUTES },
  carriers: [
    { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', packageSizes: ['S', 'M', 'L'] },
    { id: 'dpd-kurier', name: 'DPD Kurier', packageSizes: ['S', 'M', 'L', 'XL'] },
  ],
  limits: { maxAuctionValue: 500_000, kycVerified: false },
};

const COMPLETE: ListingInput = {
  photoCount: 2,
  categoryId: 'sneakersy',
  attributes: { rozmiarEu: 42 },
  title: 'Nike Air Max 90, rozmiar 42',
  description: 'Noszone kilka razy, bez uszkodzeń, oryginalne pudełko.',
  condition: 'VERY_GOOD',
  brand: 'Nike',
  packageSize: 'M',
  weightGrams: 1_200,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  allowedCarriers: ['inpost-paczkomat'],
  startPrice: 10_000,
  reservePrice: null,
  buyNowPrice: null,
  durationDays: 7,
};

const EMPTY: ListingInput = {
  photoCount: 0,
  categoryId: null,
  attributes: {},
  title: null,
  description: null,
  condition: null,
  brand: null,
  packageSize: null,
  weightGrams: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  allowedCarriers: [],
  startPrice: null,
  reservePrice: null,
  buyNowPrice: null,
  durationDays: null,
};

const paths = (input: Partial<ListingInput>, context: Partial<ListingContext> = {}) =>
  validateListing({ ...COMPLETE, ...input }, { ...CONTEXT, ...context }).map((issue) => issue.path);

const messages = (input: Partial<ListingInput>, context: Partial<ListingContext> = {}) =>
  validateListing({ ...COMPLETE, ...input }, { ...CONTEXT, ...context }).map((issue) =>
    issue.message.replaceAll(' ', ' '),
  );

describe('validateListing', () => {
  it('kompletna oferta przechodzi', () => {
    expect(validateListing(COMPLETE, CONTEXT)).toEqual([]);
  });

  it('pusty szkic: każdy brak naraz, w kolejności kroków kreatora', () => {
    expect(validateListing(EMPTY, CONTEXT).map((issue) => issue.path)).toEqual([
      'mediaIds',
      'categoryId',
      'title',
      'description',
      'condition',
      'packageSize',
      'allowedCarriers',
      'startPrice',
      'durationDays',
    ]);
  });

  it('zdjęcia: 1–20, w kategorii narażonej na podróbki co najmniej 4 i marka', () => {
    expect(paths({ photoCount: 21 })).toEqual(['mediaIds']);
    const brandSensitive = { category: { ...CONTEXT.category!, isBrandSensitive: true } };
    expect(messages({ photoCount: 3, brand: null }, brandSensitive)).toEqual([
      'W tej kategorii dodaj co najmniej 4 zdjęcia, w tym metkę albo kod produktu.',
      'Podaj markę: w tej kategorii jest wymagana.',
    ]);
    expect(paths({ photoCount: 4 }, brandSensitive)).toEqual([]);
  });

  it('kategoria: nieaktywna, nie-liść, błędne atrybuty z ich ścieżkami', () => {
    expect(messages({}, { category: undefined })).toEqual([
      'Ta kategoria nie jest już dostępna. Wybierz inną.',
    ]);
    expect(paths({}, { category: { ...CONTEXT.category!, isLeaf: false } })).toEqual([
      'categoryId',
    ]);
    expect(paths({ attributes: { rozmiarEu: 60, marka: 'x' } })).toEqual([
      'attributes.marka',
      'attributes.rozmiarEu',
    ]);
  });

  it('tytuł i opis: długość po przycięciu, w znakach', () => {
    expect(messages({ title: '   Krótki   ' })).toEqual(['Tytuł musi mieć co najmniej 10 znaków.']);
    expect(paths({ title: 'ż'.repeat(80) })).toEqual([]);
    expect(paths({ title: 'ż'.repeat(81) })).toEqual(['title']);
    expect(paths({ description: 'x'.repeat(29) })).toEqual(['description']);
    expect(paths({ description: 'x'.repeat(5001) })).toEqual(['description']);
  });

  it('stan spoza listy', () => {
    expect(paths({ condition: 'USED' })).toEqual(['condition']);
  });

  it('gabaryt: XL wymaga wymiarów i wagi, S–L do 25 kg', () => {
    expect(paths({ packageSize: 'XL', allowedCarriers: ['dpd-kurier'] })).toEqual([
      'lengthCm',
      'widthCm',
      'heightCm',
    ]);
    expect(
      paths({
        packageSize: 'XL',
        allowedCarriers: ['dpd-kurier'],
        weightGrams: null,
        lengthCm: 120,
        widthCm: 60,
        heightCm: 301,
      }),
    ).toEqual(['heightCm', 'weightGrams']);
    expect(paths({ weightGrams: 25_001 })).toEqual(['weightGrams']);
    expect(paths({ weightGrams: null })).toEqual([]);
  });

  it('przewoźnicy: co najmniej jeden, obsługujący gabaryt, dostępny', () => {
    expect(
      messages({
        packageSize: 'XL',
        lengthCm: 100,
        widthCm: 50,
        heightCm: 50,
        weightGrams: 30_000,
      }),
    ).toEqual(['InPost Paczkomat 24/7 nie obsługuje gabarytu XL.']);
    expect(paths({ allowedCarriers: ['poczta'] })).toEqual(['allowedCarriers']);
  });

  it('ceny: wywoławcza ≥ 1 zł, minimalna ≥ wywoławczej, Kup teraz ≥ 130% i ≥ minimalnej', () => {
    expect(paths({ startPrice: 99 })).toEqual(['startPrice']);
    expect(paths({ startPrice: 100 })).toEqual([]);
    expect(paths({ reservePrice: 9_999 })).toEqual(['reservePrice']);
    expect(paths({ reservePrice: 10_000 })).toEqual([]);
    expect(messages({ buyNowPrice: 12_999 })).toEqual([
      'Cena Kup teraz musi wynosić co najmniej 130% ceny wywoławczej, czyli 130 zł.',
    ]);
    expect(paths({ buyNowPrice: 13_000 })).toEqual([]);
    expect(messages({ reservePrice: 20_000, buyNowPrice: 15_000 })).toEqual([
      'Cena Kup teraz nie może być niższa niż cena minimalna.',
    ]);
  });

  it('limit wartości aukcji (najwyższa cena) i próg KYC, błąd przy polu wyznaczającym wartość', () => {
    expect(paths({ startPrice: 500_000 })).toEqual([]);
    expect(paths({ startPrice: 400_000, reservePrice: 500_001 })).toEqual(['reservePrice']);
    expect(messages({ startPrice: 10_000, buyNowPrice: 600_000 })).toEqual([
      'Twój limit wartości aukcji to 5000 zł (liczy się najwyższa z cen: wywoławczej, minimalnej i Kup teraz). Limit rośnie po udanych sprzedażach.',
    ]);
    const unlimited = { limits: { maxAuctionValue: null, kycVerified: false } };
    expect(messages({ startPrice: 500_001 }, unlimited)).toEqual([
      'Aukcje o wartości powyżej 5000 zł wymagają weryfikacji tożsamości u operatora płatności.',
    ]);
    expect(paths({ startPrice: 500_000 }, unlimited)).toEqual([]);
    expect(
      paths({ startPrice: 1_000_000 }, { limits: { maxAuctionValue: null, kycVerified: true } }),
    ).toEqual([]);
    expect(paths({ startPrice: 1_000_000 }, { limits: undefined })).toEqual([]);
  });

  it('czas trwania z listy 1, 3, 5, 7, 10 dni', () => {
    expect(paths({ durationDays: 2 })).toEqual(['durationDays']);
    expect(paths({ durationDays: 10 })).toEqual([]);
  });
});

describe('ceny pomocnicze', () => {
  it('auctionValue: najwyższa z cen, 0 bez cen', () => {
    expect(auctionValue({ startPrice: 100, reservePrice: null, buyNowPrice: 300 })).toBe(300);
    expect(auctionValue({ startPrice: null, reservePrice: null, buyNowPrice: null })).toBe(0);
  });

  it('minimumBuyNowPrice: 130% half-up do grosza', () => {
    expect(minimumBuyNowPrice(100)).toBe(130);
    expect(minimumBuyNowPrice(105)).toBe(137); // 136,5 gr → 137 gr
    expect(minimumBuyNowPrice(10_000)).toBe(13_000);
  });
});

describe('postęp szkicu (F-63)', () => {
  const completed = (input: Partial<ListingInput>, context: Partial<ListingContext> = {}) =>
    completedListingSteps(validateListing({ ...COMPLETE, ...input }, { ...CONTEXT, ...context }));

  it('przypisuje ścieżki braków do kroków kreatora', () => {
    expect(listingStepOfPath('mediaIds')).toBe(1);
    expect(listingStepOfPath('attributes.rozmiarEu')).toBe(2);
    expect(listingStepOfPath('condition')).toBe(3);
    expect(listingStepOfPath('weightGrams')).toBe(4);
    expect(listingStepOfPath('buyNowPrice')).toBe(5);
    expect(listingStepOfPath('kycNoticeAccepted')).toBe(6);
  });

  it('pusty szkic nie ma ukończonych kroków', () => {
    expect(completedListingSteps(validateListing(EMPTY, CONTEXT))).toBe(0);
  });

  it('liczy kroki do pierwszego braku, nawet gdy dalsze są uzupełnione', () => {
    expect(completed({ title: null })).toBe(2);
    expect(completed({ allowedCarriers: [] })).toBe(3);
    expect(completed({ photoCount: 0, startPrice: null })).toBe(0);
  });

  it('cena ponad limit sprzedawcy zatrzymuje postęp na kroku ceny', () => {
    expect(completed({ startPrice: 600_000 })).toBe(4);
  });

  it('komplet daje 5 kroków: zostaje podgląd i publikacja', () => {
    expect(completed({})).toBe(5);
    expect(completedListingSteps([{ path: 'kycNoticeAccepted', message: '' }])).toBe(5);
  });
});
