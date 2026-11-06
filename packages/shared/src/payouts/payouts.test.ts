import { describe, expect, it } from 'vitest';

import {
  ageInYears,
  formatIban,
  isValidNip,
  isValidPesel,
  maskIban,
  maskTaxId,
  normalizeIban,
  normalizeTaxId,
  peselBirthDate,
} from './index.js';

const IBAN = 'PL61109010140000071219812874';

describe('normalizeIban', () => {
  it('przyjmuje numer ze spacjami, myślnikami, małymi literami i bez prefiksu PL', () => {
    expect(normalizeIban('PL61 1090 1014 0000 0712 1981 2874')).toBe(IBAN);
    expect(normalizeIban('pl61-1090-1014-0000-0712-1981-2874')).toBe(IBAN);
    expect(normalizeIban('61 1090 1014 0000 0712 1981 2874')).toBe(IBAN);
  });

  it('odrzuca złą sumę kontrolną, długość i rachunki spoza Polski', () => {
    expect(normalizeIban('PL62109010140000071219812874')).toBeUndefined();
    expect(normalizeIban('PL6110901014000007121981287')).toBeUndefined();
    expect(normalizeIban('DE89370400440532013000')).toBeUndefined();
    expect(normalizeIban('')).toBeUndefined();
  });

  it('formatuje w grupach po 4 i maskuje do ostatnich 4 cyfr', () => {
    expect(formatIban(IBAN)).toBe('PL61 1090 1014 0000 0712 1981 2874');
    expect(maskIban(IBAN)).toBe('•••• 2874');
  });
});

describe('PESEL', () => {
  it('odczytuje datę urodzenia z przesunięciem miesiąca dla stulecia', () => {
    expect(peselBirthDate('44051401359')).toBe('1944-05-14');
    expect(peselBirthDate('90010101239')).toBe('1990-01-01');
    expect(peselBirthDate('02250803622')).toBe('2002-05-08');
    expect(peselBirthDate('06322900127')).toBe('2006-12-29');
  });

  it('odrzuca złą sumę kontrolną, nieistniejącą datę i złą długość', () => {
    expect(isValidPesel('44051401358')).toBe(false);
    // 31 lutego z poprawną sumą kontrolną.
    expect(isValidPesel('90023101237')).toBe(false);
    expect(isValidPesel('4405140135')).toBe(false);
    expect(isValidPesel('4405140135a')).toBe(false);
  });
});

describe('NIP', () => {
  it('sprawdza sumę kontrolną z wagami 6, 5, 7, 2, 3, 4, 5, 6, 7', () => {
    expect(isValidNip('5260250274')).toBe(true);
    expect(isValidNip('1234563218')).toBe(true);
    expect(isValidNip('5260250275')).toBe(false);
    expect(isValidNip('526025027')).toBe(false);
  });

  it('normalizacja usuwa myślniki i spacje, maska zostawia 4 ostatnie cyfry', () => {
    expect(normalizeTaxId('526-025-02-74')).toBe('5260250274');
    expect(maskTaxId('5260250274')).toBe('••••••0274');
    expect(maskTaxId('44051401359')).toBe('•••••••1359');
  });
});

describe('ageInYears', () => {
  it('liczy pełne lata, także w dniu urodzin i dla 29 lutego', () => {
    expect(ageInYears('2008-11-02', '2026-11-02')).toBe(18);
    expect(ageInYears('2008-11-03', '2026-11-02')).toBe(17);
    expect(ageInYears('2004-02-29', '2023-02-28')).toBe(18);
    expect(ageInYears('2004-02-29', '2022-03-01')).toBe(18);
  });
});
