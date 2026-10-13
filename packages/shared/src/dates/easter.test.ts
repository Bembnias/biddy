import { describe, expect, it } from 'vitest';

import { easterSunday } from './easter.js';
import { isoDateToParts, isoDayOfWeek } from './iso-date.js';

describe('easterSunday', () => {
  // Daty Wielkanocy sprawdzone niezależnie (tablice kościelne, dateutil.easter).
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
    [2031, '2031-04-13'],
    [2032, '2032-03-28'],
    [2033, '2033-04-17'],
    [2034, '2034-04-09'],
    [2035, '2035-03-25'],
  ])('Wielkanoc %d = %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it.each([
    [1818, '1818-03-22'], // najwcześniejsza możliwa data
    [2285, '2285-03-22'],
    [1886, '1886-04-25'], // najpóźniejsza możliwa data
    [1943, '1943-04-25'],
    [2038, '2038-04-25'],
    [2011, '2011-04-24'],
  ])('skrajne daty: Wielkanoc %d = %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  // Lata „wyjątkowe”, w których prostsze algorytmy (np. Gaussa bez obu poprawek)
  // dają Wielkanoc o tydzień za późno (25/26 kwietnia zamiast 18/19 kwietnia).
  it.each([
    [1954, '1954-04-18'],
    [1981, '1981-04-19'],
    [2049, '2049-04-18'],
    [2076, '2076-04-19'],
  ])('lata wyjątkowe: Wielkanoc %d = %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it('zgadza się z niezależną tablicą dla całego zakresu kalendarza świąt (2011–2099)', () => {
    // Tablica wygenerowana jednorazowo przez dateutil.easter (EASTER_WESTERN),
    // niezależnie od implementacji w easter.ts. Indeks 0 = rok 2011.
    const expected = [
      '2011-04-24',
      '2012-04-08',
      '2013-03-31',
      '2014-04-20',
      '2015-04-05',
      '2016-03-27',
      '2017-04-16',
      '2018-04-01',
      '2019-04-21',
      '2020-04-12',
      '2021-04-04',
      '2022-04-17',
      '2023-04-09',
      '2024-03-31',
      '2025-04-20',
      '2026-04-05',
      '2027-03-28',
      '2028-04-16',
      '2029-04-01',
      '2030-04-21',
      '2031-04-13',
      '2032-03-28',
      '2033-04-17',
      '2034-04-09',
      '2035-03-25',
      '2036-04-13',
      '2037-04-05',
      '2038-04-25',
      '2039-04-10',
      '2040-04-01',
      '2041-04-21',
      '2042-04-06',
      '2043-03-29',
      '2044-04-17',
      '2045-04-09',
      '2046-03-25',
      '2047-04-14',
      '2048-04-05',
      '2049-04-18',
      '2050-04-10',
      '2051-04-02',
      '2052-04-21',
      '2053-04-06',
      '2054-03-29',
      '2055-04-18',
      '2056-04-02',
      '2057-04-22',
      '2058-04-14',
      '2059-03-30',
      '2060-04-18',
      '2061-04-10',
      '2062-03-26',
      '2063-04-15',
      '2064-04-06',
      '2065-03-29',
      '2066-04-11',
      '2067-04-03',
      '2068-04-22',
      '2069-04-14',
      '2070-03-30',
      '2071-04-19',
      '2072-04-10',
      '2073-03-26',
      '2074-04-15',
      '2075-04-07',
      '2076-04-19',
      '2077-04-11',
      '2078-04-03',
      '2079-04-23',
      '2080-04-07',
      '2081-03-30',
      '2082-04-19',
      '2083-04-04',
      '2084-03-26',
      '2085-04-15',
      '2086-03-31',
      '2087-04-20',
      '2088-04-11',
      '2089-04-03',
      '2090-04-16',
      '2091-04-08',
      '2092-03-30',
      '2093-04-12',
      '2094-04-04',
      '2095-04-24',
      '2096-04-15',
      '2097-03-31',
      '2098-04-20',
      '2099-04-12',
    ];
    expect(expected).toHaveLength(2099 - 2011 + 1);
    expected.forEach((date, index) => {
      expect(easterSunday(2011 + index)).toBe(date);
    });
  });

  it('dla lat 1583–9999 wypada w niedzielę między 22 marca a 25 kwietnia', () => {
    for (let year = 1583; year <= 9999; year += 1) {
      const easter = easterSunday(year);
      const { year: easterYear, month, day } = isoDateToParts(easter);
      expect(easterYear).toBe(year);
      expect(isoDayOfWeek(easter)).toBe(7);
      expect(month * 100 + day).toBeGreaterThanOrEqual(322);
      expect(month * 100 + day).toBeLessThanOrEqual(425);
    }
  });

  it.each([1582, 10_000, 2026.5, Number.NaN])('rzuca RangeError dla roku %d', (year) => {
    expect(() => easterSunday(year)).toThrow(RangeError);
  });
});
