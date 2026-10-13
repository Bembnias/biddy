import { describe, expect, it } from 'vitest';

import { easterSunday } from './easter.js';
import { type IsoDate, addCalendarDays, isoDateToParts, isoDayOfWeek } from './iso-date.js';
import {
  POLISH_HOLIDAYS_FIRST_YEAR,
  POLISH_HOLIDAYS_LAST_YEAR,
  isPolishPublicHoliday,
  polishPublicHolidays,
} from './polish-holidays.js';

describe('polishPublicHolidays', () => {
  it('2024: 13 świąt, bez Wigilii', () => {
    expect(polishPublicHolidays(2024)).toEqual([
      { date: '2024-01-01', name: 'Nowy Rok' },
      { date: '2024-01-06', name: 'Święto Trzech Króli' },
      { date: '2024-03-31', name: 'Wielkanoc' },
      { date: '2024-04-01', name: 'Poniedziałek Wielkanocny' },
      { date: '2024-05-01', name: 'Święto Państwowe' },
      { date: '2024-05-03', name: 'Święto Narodowe Trzeciego Maja' },
      { date: '2024-05-19', name: 'Zielone Świątki' },
      { date: '2024-05-30', name: 'Boże Ciało' },
      { date: '2024-08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
      { date: '2024-11-01', name: 'Wszystkich Świętych' },
      { date: '2024-11-11', name: 'Narodowe Święto Niepodległości' },
      { date: '2024-12-25', name: 'Boże Narodzenie (pierwszy dzień)' },
      { date: '2024-12-26', name: 'Boże Narodzenie (drugi dzień)' },
    ]);
  });

  it('2025: 14 świąt, pierwszy rok z Wigilią', () => {
    expect(polishPublicHolidays(2025)).toEqual([
      { date: '2025-01-01', name: 'Nowy Rok' },
      { date: '2025-01-06', name: 'Święto Trzech Króli' },
      { date: '2025-04-20', name: 'Wielkanoc' },
      { date: '2025-04-21', name: 'Poniedziałek Wielkanocny' },
      { date: '2025-05-01', name: 'Święto Państwowe' },
      { date: '2025-05-03', name: 'Święto Narodowe Trzeciego Maja' },
      { date: '2025-06-08', name: 'Zielone Świątki' },
      { date: '2025-06-19', name: 'Boże Ciało' },
      { date: '2025-08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
      { date: '2025-11-01', name: 'Wszystkich Świętych' },
      { date: '2025-11-11', name: 'Narodowe Święto Niepodległości' },
      { date: '2025-12-24', name: 'Wigilia Bożego Narodzenia' },
      { date: '2025-12-25', name: 'Boże Narodzenie (pierwszy dzień)' },
      { date: '2025-12-26', name: 'Boże Narodzenie (drugi dzień)' },
    ]);
  });

  it('2026: Boże Ciało 4 czerwca', () => {
    expect(polishPublicHolidays(2026)).toEqual([
      { date: '2026-01-01', name: 'Nowy Rok' },
      { date: '2026-01-06', name: 'Święto Trzech Króli' },
      { date: '2026-04-05', name: 'Wielkanoc' },
      { date: '2026-04-06', name: 'Poniedziałek Wielkanocny' },
      { date: '2026-05-01', name: 'Święto Państwowe' },
      { date: '2026-05-03', name: 'Święto Narodowe Trzeciego Maja' },
      { date: '2026-05-24', name: 'Zielone Świątki' },
      { date: '2026-06-04', name: 'Boże Ciało' },
      { date: '2026-08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
      { date: '2026-11-01', name: 'Wszystkich Świętych' },
      { date: '2026-11-11', name: 'Narodowe Święto Niepodległości' },
      { date: '2026-12-24', name: 'Wigilia Bożego Narodzenia' },
      { date: '2026-12-25', name: 'Boże Narodzenie (pierwszy dzień)' },
      { date: '2026-12-26', name: 'Boże Narodzenie (drugi dzień)' },
    ]);
  });

  it('2027: Boże Ciało 27 maja', () => {
    expect(polishPublicHolidays(2027)).toEqual([
      { date: '2027-01-01', name: 'Nowy Rok' },
      { date: '2027-01-06', name: 'Święto Trzech Króli' },
      { date: '2027-03-28', name: 'Wielkanoc' },
      { date: '2027-03-29', name: 'Poniedziałek Wielkanocny' },
      { date: '2027-05-01', name: 'Święto Państwowe' },
      { date: '2027-05-03', name: 'Święto Narodowe Trzeciego Maja' },
      { date: '2027-05-16', name: 'Zielone Świątki' },
      { date: '2027-05-27', name: 'Boże Ciało' },
      { date: '2027-08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
      { date: '2027-11-01', name: 'Wszystkich Świętych' },
      { date: '2027-11-11', name: 'Narodowe Święto Niepodległości' },
      { date: '2027-12-24', name: 'Wigilia Bożego Narodzenia' },
      { date: '2027-12-25', name: 'Boże Narodzenie (pierwszy dzień)' },
      { date: '2027-12-26', name: 'Boże Narodzenie (drugi dzień)' },
    ]);
  });

  it('Święto Trzech Króli obowiązuje od pierwszego obsługiwanego roku (2011)', () => {
    expect(POLISH_HOLIDAYS_FIRST_YEAR).toBe(2011);
    expect(polishPublicHolidays(2011).map((holiday) => holiday.date)).toContain('2011-01-06');
  });

  it(`dla każdego roku ${POLISH_HOLIDAYS_FIRST_YEAR}–${POLISH_HOLIDAYS_LAST_YEAR} lista jest spójna`, () => {
    for (let year = POLISH_HOLIDAYS_FIRST_YEAR; year <= POLISH_HOLIDAYS_LAST_YEAR; year += 1) {
      const holidays = polishPublicHolidays(year);
      const dates = holidays.map((holiday) => holiday.date);
      const byName = new Map(holidays.map((holiday) => [holiday.name, holiday.date]));
      const easter = easterSunday(year);

      expect(holidays).toHaveLength(year >= 2025 ? 14 : 13);
      expect(dates.every((date) => isoDateToParts(date).year === year)).toBe(true);
      // Ściśle rosnąco: posortowane i bez duplikatów.
      expect(dates.every((date, index) => index === 0 || (dates[index - 1] ?? '') < date)).toBe(
        true,
      );
      expect(byName.get('Wielkanoc')).toBe(easter);
      expect(byName.get('Poniedziałek Wielkanocny')).toBe(addCalendarDays(easter, 1));
      expect(byName.get('Zielone Świątki')).toBe(addCalendarDays(easter, 49));
      expect(byName.get('Boże Ciało')).toBe(addCalendarDays(easter, 60));
      expect(isoDayOfWeek(byName.get('Poniedziałek Wielkanocny') ?? easter)).toBe(1);
      expect(isoDayOfWeek(byName.get('Zielone Świątki') ?? easter)).toBe(7);
      expect(isoDayOfWeek(byName.get('Boże Ciało') ?? easter)).toBe(4);
      expect(byName.has('Wigilia Bożego Narodzenia')).toBe(year >= 2025);
    }
  });

  it('zwraca niemutowalną tablicę z cache', () => {
    const first = polishPublicHolidays(2030);
    expect(polishPublicHolidays(2030)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
  });

  it.each([2010, 2100, 2026.5, Number.NaN])('rzuca RangeError dla roku %d', (year) => {
    expect(() => polishPublicHolidays(year)).toThrow(RangeError);
  });
});

describe('isPolishPublicHoliday', () => {
  it('Wigilia jest świętem dopiero od 2025 r.', () => {
    expect(isPolishPublicHoliday('2024-12-24')).toBe(false);
    expect(isPolishPublicHoliday('2025-12-24')).toBe(true);
    expect(isPolishPublicHoliday('2026-12-24')).toBe(true);
  });

  it('Wielki Piątek i Wielka Sobota nie są świętami ustawowymi', () => {
    expect(isPolishPublicHoliday('2026-04-03')).toBe(false);
    expect(isPolishPublicHoliday('2026-04-04')).toBe(false);
  });

  it('zgadza się z listą świąt dla każdego dnia lat 2024–2027', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const expected = new Set(polishPublicHolidays(year).map((holiday) => holiday.date));
      let date: IsoDate = `${year}-01-01`;
      let found = 0;
      while (isoDateToParts(date).year === year) {
        expect(isPolishPublicHoliday(date)).toBe(expected.has(date));
        found += isPolishPublicHoliday(date) ? 1 : 0;
        date = addCalendarDays(date, 1);
      }
      expect(found).toBe(expected.size);
    }
  });

  it('rzuca RangeError poza obsługiwanym zakresem lat i dla nieprawidłowej daty', () => {
    expect(() => isPolishPublicHoliday('2010-12-25')).toThrow(RangeError);
    expect(() => isPolishPublicHoliday('2100-01-01')).toThrow(RangeError);
    expect(() => isPolishPublicHoliday('2026-02-30')).toThrow(RangeError);
  });
});
