// Testy nie mogą zależeć od strefy czasowej maszyny: używamy wyłącznie chwil zapisanych w UTC
// („…Z”). Uruchamiamy je także z TZ=America/Los_Angeles i TZ=Pacific/Kiritimati (UTC+14).

import { describe, expect, it } from 'vitest';

import { type IsoDate, addCalendarDays, isoDayOfWeek } from './iso-date.js';
import {
  BIDDY_TIME_ZONE,
  businessDayDeadline,
  toWarsawDate,
  warsawStartOfDay,
} from './warsaw-time.js';

const HOUR_MS = 3_600_000;

function utc(iso: string): Date {
  return new Date(iso);
}

/** Ostatnia niedziela miesiąca: dzień zmiany czasu w UE (marzec i październik). */
function lastSundayOf(year: number, month: 3 | 10): IsoDate {
  let date: IsoDate = `${year}-${month === 3 ? '03' : '10'}-31`;
  while (isoDayOfWeek(date) !== 7) {
    date = addCalendarDays(date, -1);
  }
  return date;
}

describe('BIDDY_TIME_ZONE', () => {
  it('to Europe/Warsaw', () => {
    expect(BIDDY_TIME_ZONE).toBe('Europe/Warsaw');
  });
});

describe('toWarsawDate', () => {
  it.each([
    // Zima (CET, UTC+1): doba w Warszawie zaczyna się o 23:00 UTC poprzedniego dnia.
    ['2026-01-14T22:59:59.999Z', '2026-01-14'],
    ['2026-01-14T23:00:00.000Z', '2026-01-15'],
    ['2026-01-15T00:00:00.000Z', '2026-01-15'],
    ['2026-01-15T22:59:59.999Z', '2026-01-15'],
    // Lato (CEST, UTC+2): doba zaczyna się o 22:00 UTC poprzedniego dnia.
    ['2026-07-14T21:59:59.999Z', '2026-07-14'],
    ['2026-07-14T22:00:00.000Z', '2026-07-15'],
    ['2026-07-15T00:00:00.000Z', '2026-07-15'],
    ['2026-07-15T21:59:59.999Z', '2026-07-15'],
    // Sylwester: w Warszawie już Nowy Rok, w UTC jeszcze nie.
    ['2026-12-31T22:59:59.999Z', '2026-12-31'],
    ['2026-12-31T23:00:00.000Z', '2027-01-01'],
    // Doby zmiany czasu.
    ['2026-03-29T00:59:59.000Z', '2026-03-29'], // 01:59:59 CET
    ['2026-03-29T01:00:00.000Z', '2026-03-29'], // 03:00:00 CEST
    ['2026-10-25T00:30:00.000Z', '2026-10-25'], // 02:30 CEST
    ['2026-10-25T01:30:00.000Z', '2026-10-25'], // 02:30 CET (powtórzona godzina)
    ['2026-10-25T22:59:59.999Z', '2026-10-25'],
    ['2026-10-25T23:00:00.000Z', '2026-10-26'],
  ])('%s → %s', (instant, expected) => {
    expect(toWarsawDate(utc(instant))).toBe(expected);
  });

  it('rzuca RangeError dla Invalid Date i chwil sprzed roku 0001', () => {
    expect(() => toWarsawDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => toWarsawDate(utc('-000001-06-01T00:00:00Z'))).toThrow(RangeError);
  });
});

describe('warsawStartOfDay', () => {
  it.each([
    ['2026-01-15', '2026-01-14T23:00:00.000Z'], // zwykły dzień zimą
    ['2026-07-15', '2026-07-14T22:00:00.000Z'], // zwykły dzień latem
    ['2027-01-01', '2026-12-31T23:00:00.000Z'],
    // 2026-03-29: zmiana na czas letni o 02:00 — północ jest jeszcze w CET.
    ['2026-03-29', '2026-03-28T23:00:00.000Z'],
    ['2026-03-30', '2026-03-29T22:00:00.000Z'],
    // 2026-10-25: zmiana na czas zimowy o 03:00 — północ jest jeszcze w CEST.
    ['2026-10-25', '2026-10-24T22:00:00.000Z'],
    ['2026-10-26', '2026-10-25T23:00:00.000Z'],
    ['2025-03-30', '2025-03-29T23:00:00.000Z'],
    ['2025-10-26', '2025-10-25T22:00:00.000Z'],
  ] as const)('%s zaczyna się o %s', (date, expected) => {
    expect(warsawStartOfDay(date).toISOString()).toBe(expected);
  });

  it('doby zmiany czasu mają 23 i 25 godzin', () => {
    const length = (date: IsoDate): number =>
      warsawStartOfDay(addCalendarDays(date, 1)).getTime() - warsawStartOfDay(date).getTime();
    expect(length('2026-03-29')).toBe(23 * HOUR_MS);
    expect(length('2026-10-25')).toBe(25 * HOUR_MS);
    expect(length('2026-10-26')).toBe(24 * HOUR_MS);
  });

  it('dla każdego dnia lat 2024–2030 jest zgodne z toWarsawDate i zmianami czasu', () => {
    const transitions = new Map<IsoDate, number>();
    for (let year = 2024; year <= 2030; year += 1) {
      transitions.set(lastSundayOf(year, 3), 23 * HOUR_MS);
      transitions.set(lastSundayOf(year, 10), 25 * HOUR_MS);
    }
    for (let date: IsoDate = '2024-01-01'; date <= '2030-12-31'; date = addCalendarDays(date, 1)) {
      const start = warsawStartOfDay(date);
      const nextStart = warsawStartOfDay(addCalendarDays(date, 1));
      expect(toWarsawDate(start)).toBe(date);
      expect(toWarsawDate(new Date(start.getTime() - 1))).toBe(addCalendarDays(date, -1));
      expect(nextStart.getTime() - start.getTime()).toBe(transitions.get(date) ?? 24 * HOUR_MS);
    }
  });

  it('gdy lokalna północ nie istnieje, zwraca pierwszą chwilę doby (luka 1946-04-14)', () => {
    // 14 kwietnia 1946 r. zegary w Polsce przestawiono o północy z 00:00 na 01:00.
    expect(warsawStartOfDay('1946-04-14').toISOString()).toBe('1946-04-13T23:00:00.000Z');
  });

  it('rzuca RangeError dla nieprawidłowej daty i daty sprzed 0001-01-02', () => {
    expect(() => warsawStartOfDay('2026-02-30')).toThrow(RangeError);
    expect(() => warsawStartOfDay('0001-01-01')).toThrow(RangeError);
  });
});

describe('businessDayDeadline', () => {
  it.each([
    // Przykład z dokumentacji: opłacenie w poniedziałek, 5 dni roboczych na nadanie.
    ['2026-10-05T12:00:00Z', 5, '2026-10-12T22:00:00.000Z'],
    // Wigilia, Boże Narodzenie i weekend; termin o północy CET (UTC+1).
    ['2026-12-22T10:00:00Z', 5, '2026-12-31T23:00:00.000Z'],
    // Przez zmianę czasu: start w CEST, koniec w CET (poniedziałek 2026-10-26).
    ['2026-10-19T08:00:00Z', 5, '2026-10-26T23:00:00.000Z'],
    // Opłacenie w sobotę: liczymy od poniedziałku.
    ['2026-10-10T10:00:00Z', 5, '2026-10-16T22:00:00.000Z'],
    // 0 dni: koniec dnia startowego.
    ['2026-10-08T10:00:00Z', 0, '2026-10-08T22:00:00.000Z'],
  ] as const)('%s + %d dni roboczych → %s', (from, businessDays, expected) => {
    expect(businessDayDeadline(utc(from), businessDays).toISOString()).toBe(expected);
  });

  it('piątek 23:30 w Warszawie to jeszcze piątek', () => {
    // Lato: 2026-10-09 23:30 CEST = 21:30 UTC.
    expect(businessDayDeadline(utc('2026-10-09T21:30:00Z'), 1).toISOString()).toBe(
      '2026-10-12T22:00:00.000Z',
    );
    // Zima: 2026-12-04 23:30 CET = 22:30 UTC.
    expect(businessDayDeadline(utc('2026-12-04T22:30:00Z'), 1).toISOString()).toBe(
      '2026-12-07T23:00:00.000Z',
    );
  });

  it('o dniu startowym decyduje data w Warszawie, nie w UTC', () => {
    // Czwartek 2026-10-08 23:59:59.999 w Warszawie: start w czwartek, termin koniec piątku.
    expect(businessDayDeadline(utc('2026-10-08T21:59:59.999Z'), 1).toISOString()).toBe(
      '2026-10-09T22:00:00.000Z',
    );
    // Piątek 00:30 w Warszawie, choć w UTC jest jeszcze czwartek 22:30: start w piątek,
    // więc 1 dzień roboczy kończy się w poniedziałek, a nie w piątek.
    expect(businessDayDeadline(utc('2026-10-08T22:30:00Z'), 1).toISOString()).toBe(
      '2026-10-12T22:00:00.000Z',
    );
    // Zima: poniedziałek 00:30 w Warszawie (w UTC niedziela 23:30) — start w poniedziałek,
    // więc termin to koniec wtorku, a nie poniedziałku.
    expect(businessDayDeadline(utc('2026-12-06T23:30:00Z'), 1).toISOString()).toBe(
      '2026-12-08T23:00:00.000Z',
    );
  });

  it('termin jest wyłączny: chwilę przed nim trwa jeszcze ostatni dzień roboczy', () => {
    const deadline = businessDayDeadline(utc('2026-12-22T10:00:00Z'), 5);
    expect(toWarsawDate(new Date(deadline.getTime() - 1))).toBe('2026-12-31');
    expect(toWarsawDate(deadline)).toBe('2027-01-01');
  });

  it('rzuca RangeError dla ujemnej liczby dni i Invalid Date', () => {
    expect(() => businessDayDeadline(utc('2026-10-08T10:00:00Z'), -1)).toThrow(RangeError);
    expect(() => businessDayDeadline(new Date(Number.NaN), 5)).toThrow(RangeError);
  });
});
