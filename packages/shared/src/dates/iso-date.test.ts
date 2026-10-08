import { describe, expect, it } from 'vitest';

import {
  type IsoDate,
  addCalendarDays,
  assertIsoDate,
  epochDayToIsoDate,
  isIsoDate,
  isoDateFromParts,
  isoDateToEpochDay,
  isoDateToParts,
  isoDayOfWeek,
} from './iso-date.js';

describe('isIsoDate', () => {
  it.each(['2026-10-08', '2024-02-29', '2000-02-29', '0000-01-01', '9999-12-31', '2026-04-30'])(
    'akceptuje istniejącą datę %s',
    (value) => {
      expect(isIsoDate(value)).toBe(true);
    },
  );

  it.each([
    '2025-02-29', // rok nieprzestępny
    '1900-02-29', // rok podzielny przez 100, nie przez 400
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-01',
    '2026-01-1',
    '20260101',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01T00:00:00Z',
    '+02026-01-01',
    '10000-01-01',
    '',
  ])('odrzuca %j', (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it.each([undefined, null, 20260101, new Date('2026-01-01T00:00:00Z'), {}])(
    'odrzuca wartość, która nie jest napisem: %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe('assertIsoDate', () => {
  it('przepuszcza poprawną datę', () => {
    expect(() => {
      assertIsoDate('2026-12-24');
    }).not.toThrow();
  });

  it('rzuca TypeError dla wartości, która nie jest napisem', () => {
    expect(() => {
      assertIsoDate(42);
    }).toThrow(TypeError);
  });

  it('rzuca RangeError dla nieistniejącej daty lub złego formatu', () => {
    expect(() => {
      assertIsoDate('2026-02-30');
    }).toThrow(RangeError);
    expect(() => {
      assertIsoDate('24.12.2026');
    }).toThrow(RangeError);
  });
});

describe('isoDateFromParts / isoDateToParts', () => {
  it('składa i rozkłada datę z dopełnieniem zerami', () => {
    expect(isoDateFromParts(2026, 3, 7)).toBe('2026-03-07');
    expect(isoDateFromParts(42, 1, 2)).toBe('0042-01-02');
    expect(isoDateToParts('2026-12-24')).toEqual({ year: 2026, month: 12, day: 24 });
  });

  it.each([
    [2025, 2, 29],
    [2026, 13, 1],
    [2026, 1, 0],
    [2026.5, 1, 1],
    [10_000, 1, 1],
    [-1, 1, 1],
  ])('rzuca RangeError dla nieprawidłowych składowych %d-%d-%d', (year, month, day) => {
    expect(() => isoDateFromParts(year, month, day)).toThrow(RangeError);
  });

  it('isoDateToParts waliduje wejście w czasie działania', () => {
    expect(() => isoDateToParts('2026-2-3')).toThrow(RangeError);
  });
});

describe('addCalendarDays', () => {
  it.each<[IsoDate, number, IsoDate]>([
    ['2026-10-08', 0, '2026-10-08'],
    ['2026-10-08', 1, '2026-10-09'],
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2025-02-28', 1, '2025-03-01'],
    ['2000-02-28', 1, '2000-02-29'],
    ['2100-02-28', 1, '2100-03-01'],
    ['2026-03-29', 1, '2026-03-30'], // doba zmiany czasu nie ma znaczenia dla dat
    ['1970-01-01', -1, '1969-12-31'],
    ['2026-10-08', 365, '2027-10-08'],
    ['2028-10-08', -366, '2027-10-08'],
  ])('%s %+d dni = %s', (date, days, expected) => {
    expect(addCalendarDays(date, days)).toBe(expected);
  });

  it('jest odwracalne dla każdego dnia z lat 1999–2101', () => {
    let date: IsoDate = '1999-01-01';
    let previousEpochDay = isoDateToEpochDay(date) - 1;
    while (date <= '2101-12-31') {
      const epochDay = isoDateToEpochDay(date);
      expect(epochDay).toBe(previousEpochDay + 1);
      expect(epochDayToIsoDate(epochDay)).toBe(date);
      expect(addCalendarDays(addCalendarDays(date, 40), -40)).toBe(date);
      previousEpochDay = epochDay;
      date = addCalendarDays(date, 1);
    }
  });

  it('rzuca RangeError dla niecałkowitej liczby dni i wyjścia poza lata 0000–9999', () => {
    expect(() => addCalendarDays('2026-10-08', 1.5)).toThrow(RangeError);
    expect(() => addCalendarDays('2026-10-08', Number.NaN)).toThrow(RangeError);
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow(RangeError);
    expect(() => addCalendarDays('0000-01-01', -1)).toThrow(RangeError);
  });
});

describe('isoDayOfWeek', () => {
  it.each<[IsoDate, number]>([
    ['1970-01-01', 4], // czwartek
    ['2000-01-01', 6], // sobota
    ['2024-12-24', 2], // wtorek
    ['2026-10-05', 1], // poniedziałek
    ['2026-10-08', 4], // czwartek
    ['2026-10-11', 7], // niedziela
    ['2026-12-24', 4], // czwartek
    ['1600-03-01', 3], // środa
  ])('%s → %d', (date, expected) => {
    expect(isoDayOfWeek(date)).toBe(expected);
  });

  it('kolejne dni mają kolejne dni tygodnia', () => {
    let date: IsoDate = '2024-01-01'; // poniedziałek
    for (let index = 0; index < 3 * 366; index += 1) {
      expect(isoDayOfWeek(date)).toBe((index % 7) + 1);
      date = addCalendarDays(date, 1);
    }
  });
});
