import { describe, expect, it } from 'vitest';

import { addBusinessDays, isBusinessDay, nextBusinessDay } from './business-days.js';
import { type IsoDate, addCalendarDays } from './iso-date.js';

/** Niezależna wyrocznia: liczba dni roboczych w przedziale (from, to]. */
function countBusinessDaysAfter(from: IsoDate, to: IsoDate): number {
  let count = 0;
  for (let date = addCalendarDays(from, 1); date <= to; date = addCalendarDays(date, 1)) {
    count += isBusinessDay(date) ? 1 : 0;
  }
  return count;
}

function* everyDay(from: IsoDate, to: IsoDate): Generator<IsoDate> {
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    yield date;
  }
}

describe('isBusinessDay', () => {
  it.each<[IsoDate, boolean, string]>([
    ['2026-10-05', true, 'poniedziałek'],
    ['2026-10-09', true, 'piątek'],
    ['2026-10-10', false, 'sobota nie jest dniem roboczym'],
    ['2026-10-11', false, 'niedziela'],
    ['2026-11-11', false, 'Narodowe Święto Niepodległości w środę'],
    ['2026-01-06', false, 'Trzech Króli we wtorek'],
    ['2026-04-03', true, 'Wielki Piątek jest dniem roboczym'],
    ['2026-04-06', false, 'Poniedziałek Wielkanocny'],
    ['2026-06-04', false, 'Boże Ciało'],
    ['2024-12-24', true, 'Wigilia 2024 (wtorek) — jeszcze dzień roboczy'],
    ['2025-12-24', false, 'Wigilia 2025 (środa) — już dzień wolny'],
    ['2026-12-24', false, 'Wigilia 2026 (czwartek)'],
    ['2026-12-31', true, 'Sylwester nie jest świętem'],
    ['2049-04-19', false, 'Poniedziałek Wielkanocny 2049 (rok wyjątkowy algorytmu)'],
    ['2049-04-26', true, 'tydzień po Poniedziałku Wielkanocnym 2049'],
  ])('%s → %s (%s)', (date, expected) => {
    expect(isBusinessDay(date)).toBe(expected);
  });

  // Liczby wyliczone niezależnie (dateutil + lista świąt z ustawy).
  it.each([
    [2024, 252],
    [2025, 251],
    [2026, 253],
    [2027, 253],
    [2028, 251],
    [2029, 251],
    [2030, 250],
  ])('rok %d ma %d dni roboczych', (year, expected) => {
    const days = [...everyDay(`${year}-01-01`, `${year}-12-31`)];
    expect(days.filter((date) => isBusinessDay(date))).toHaveLength(expected);
  });

  it('rzuca RangeError poza kalendarzem świąt — także dla weekendu', () => {
    expect(() => isBusinessDay('2010-12-31')).toThrow(RangeError);
    expect(() => isBusinessDay('2100-01-02')).toThrow(RangeError); // sobota
  });
});

describe('addBusinessDays', () => {
  it('dla 0 dni zwraca datę bez zmian, także w weekend i święto', () => {
    expect(addBusinessDays('2026-10-07', 0)).toBe('2026-10-07');
    expect(addBusinessDays('2026-10-10', 0)).toBe('2026-10-10');
    expect(addBusinessDays('2026-12-25', 0)).toBe('2026-12-25');
  });

  it.each<[IsoDate, number, IsoDate, string]>([
    // Weekendy
    ['2026-10-05', 5, '2026-10-12', 'pon. + 5 → pon.'],
    ['2026-10-08', 2, '2026-10-12', 'czw. + 2 → pon.'],
    ['2026-10-09', 1, '2026-10-12', 'pt. + 1 → pon.'],
    ['2026-10-10', 1, '2026-10-12', 'sob. + 1 → pon.'],
    ['2026-10-11', 1, '2026-10-12', 'niedz. + 1 → pon.'],
    ['2026-10-10', 5, '2026-10-16', 'sob. + 5 → pt.'],
    ['2026-10-05', 10, '2026-10-19', 'dwa tygodnie'],
    // Boże Narodzenie
    ['2026-12-22', 5, '2026-12-31', 'Wigilia, święta i weekend 2026'],
    ['2025-12-19', 3, '2025-12-29', 'Wigilia 2025 w środę blokuje'],
    ['2024-12-20', 3, '2024-12-27', 'Wigilia 2024 jeszcze robocza'],
    ['2026-12-23', 1, '2026-12-28', 'z 23 grudnia na poniedziałek po świętach'],
    // Wielkanoc (Wielki Piątek roboczy, Poniedziałek Wielkanocny wolny)
    ['2026-04-02', 2, '2026-04-07', 'Wielkanoc 2026'],
    ['2027-03-25', 2, '2027-03-30', 'Wielkanoc 2027'],
    ['2049-04-16', 1, '2049-04-20', 'Wielkanoc 2049 (18 kwietnia)'],
    ['2076-04-17', 1, '2076-04-21', 'Wielkanoc 2076 (19 kwietnia)'],
    // Majówka
    ['2026-04-30', 1, '2026-05-04', '1 maja w piątek, 3 maja w niedzielę'],
    ['2027-04-30', 1, '2027-05-04', '3 maja 2027 w poniedziałek'],
    ['2024-04-30', 2, '2024-05-06', '1 i 3 maja 2024 w środę i piątek'],
    // Boże Ciało
    ['2026-06-03', 1, '2026-06-05', 'Boże Ciało 2026'],
    // Przełom roku i Trzech Króli
    ['2026-12-30', 2, '2027-01-04', 'Nowy Rok 2027 w piątek'],
    ['2027-12-30', 3, '2028-01-04', 'Nowy Rok 2028 w sobotę'],
    ['2026-01-02', 2, '2026-01-07', 'Trzech Króli we wtorek'],
    ['2025-12-31', 1, '2026-01-02', 'Sylwester → 2 stycznia'],
  ])('%s + %d → %s (%s)', (date, businessDays, expected) => {
    expect(addBusinessDays(date, businessDays)).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rzuca RangeError dla liczby dni %d',
    (businessDays) => {
      expect(() => addBusinessDays('2026-10-08', businessDays)).toThrow(RangeError);
    },
  );

  it('rzuca RangeError dla nieprawidłowej daty i poza kalendarzem świąt', () => {
    expect(() => addBusinessDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addBusinessDays('2010-12-31', 0)).toThrow(RangeError);
    expect(() => addBusinessDays('2099-12-28', 5)).toThrow(RangeError);
    expect(addBusinessDays('2099-12-28', 3)).toBe('2099-12-31');
  });

  describe('własności dla każdego dnia lat 2025–2030', () => {
    const days = [...everyDay('2025-01-01', '2030-12-31')];
    const maxBusinessDays = 12;

    it('wynik jest dniem roboczym, a między datami jest dokładnie n dni roboczych', () => {
      for (const date of days) {
        for (let businessDays = 0; businessDays <= maxBusinessDays; businessDays += 1) {
          const result = addBusinessDays(date, businessDays);
          if (businessDays >= 1) {
            expect(isBusinessDay(result)).toBe(true);
          } else {
            expect(result).toBe(date);
          }
          expect(countBusinessDaysAfter(date, result)).toBe(businessDays);
        }
      }
    });

    it('wynik rośnie ściśle wraz z n i składa się z kolejnych nextBusinessDay', () => {
      for (const date of days) {
        let previous = addBusinessDays(date, 0);
        for (let businessDays = 1; businessDays <= maxBusinessDays; businessDays += 1) {
          const result = addBusinessDays(date, businessDays);
          expect(result > previous).toBe(true);
          expect(result).toBe(nextBusinessDay(previous));
          previous = result;
        }
      }
    });
  });
});

describe('nextBusinessDay', () => {
  it.each<[IsoDate, IsoDate]>([
    ['2026-10-08', '2026-10-09'],
    ['2026-10-09', '2026-10-12'],
    ['2026-12-23', '2026-12-28'],
    ['2026-04-03', '2026-04-07'],
    ['2026-12-31', '2027-01-04'],
  ])('%s → %s', (date, expected) => {
    expect(nextBusinessDay(date)).toBe(expected);
  });
});
