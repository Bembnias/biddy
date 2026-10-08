// Kalendarz polskich świąt ustawowych (dni wolnych od pracy) wg ustawy z dnia 18 stycznia
// 1951 r. o dniach wolnych od pracy, w brzmieniu po nowelizacjach:
// - od 2011 r. 6 stycznia (Święto Trzech Króli) jest dniem wolnym (nowelizacja z 2010 r.),
// - od 2025 r. 24 grudnia (Wigilia Bożego Narodzenia) jest dniem wolnym (nowelizacja z 2024 r.).
//
// Obsługujemy lata 2011–2099. Wcześniejsze lata mają inny katalog świąt (a terminy Biddy
// i tak ich nie dotyczą), a dla odległej przyszłości kalendarz byłby zgadywaniem — poza
// zakresem rzucamy RangeError zamiast zwracać wynik, który może być nieprawdziwy.

import { easterSunday } from './easter.js';
import {
  type IsoDate,
  addCalendarDays,
  epochDayToYear,
  isoDateFromParts,
  isoDateToEpochDay,
} from './iso-date.js';

/** Pierwszy rok obsługiwany przez kalendarz świąt (pierwszy rok z dniem wolnym 6 stycznia). */
export const POLISH_HOLIDAYS_FIRST_YEAR = 2011;

/** Ostatni rok obsługiwany przez kalendarz świąt. */
export const POLISH_HOLIDAYS_LAST_YEAR = 2099;

/** Pierwszy rok, w którym 24 grudnia (Wigilia) jest dniem wolnym od pracy. */
const CHRISTMAS_EVE_FIRST_YEAR = 2025;

/** Święto ustawowe: data i polska nazwa do wyświetlenia. */
export interface PolishPublicHoliday {
  readonly date: IsoDate;
  readonly name: string;
}

interface YearCalendar {
  readonly holidays: readonly PolishPublicHoliday[];
  /** Numery dni (od 1970-01-01) świąt danego roku, do szybkiego sprawdzania. */
  readonly epochDays: ReadonlySet<number>;
}

const calendarCache = new Map<number, YearCalendar>();

function assertSupportedYear(year: number): void {
  if (
    !Number.isInteger(year) ||
    year < POLISH_HOLIDAYS_FIRST_YEAR ||
    year > POLISH_HOLIDAYS_LAST_YEAR
  ) {
    throw new RangeError(
      `Kalendarz świąt obsługuje lata ${POLISH_HOLIDAYS_FIRST_YEAR}–${POLISH_HOLIDAYS_LAST_YEAR}, podano: ${year}.`,
    );
  }
}

function buildHolidays(year: number): PolishPublicHoliday[] {
  const easter = easterSunday(year);
  const fixed = (month: number, day: number, name: string): PolishPublicHoliday => ({
    date: isoDateFromParts(year, month, day),
    name,
  });
  const movable = (daysAfterEaster: number, name: string): PolishPublicHoliday => ({
    date: addCalendarDays(easter, daysAfterEaster),
    name,
  });

  const holidays: PolishPublicHoliday[] = [
    fixed(1, 1, 'Nowy Rok'),
    fixed(1, 6, 'Święto Trzech Króli'),
    movable(0, 'Wielkanoc'),
    movable(1, 'Poniedziałek Wielkanocny'),
    fixed(5, 1, 'Święto Państwowe'),
    fixed(5, 3, 'Święto Narodowe Trzeciego Maja'),
    movable(49, 'Zielone Świątki'),
    movable(60, 'Boże Ciało'),
    fixed(8, 15, 'Wniebowzięcie Najświętszej Maryi Panny'),
    fixed(11, 1, 'Wszystkich Świętych'),
    fixed(11, 11, 'Narodowe Święto Niepodległości'),
  ];
  if (year >= CHRISTMAS_EVE_FIRST_YEAR) {
    holidays.push(fixed(12, 24, 'Wigilia Bożego Narodzenia'));
  }
  holidays.push(
    fixed(12, 25, 'Boże Narodzenie (pierwszy dzień)'),
    fixed(12, 26, 'Boże Narodzenie (drugi dzień)'),
  );
  // Daty w formacie RRRR-MM-DD sortują się poprawnie jako napisy.
  return holidays.sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
  );
}

function getYearCalendar(year: number): YearCalendar {
  assertSupportedYear(year);
  let calendar = calendarCache.get(year);
  if (calendar === undefined) {
    const holidays = Object.freeze(buildHolidays(year).map((holiday) => Object.freeze(holiday)));
    calendar = {
      holidays,
      epochDays: new Set(holidays.map((holiday) => isoDateToEpochDay(holiday.date))),
    };
    calendarCache.set(year, calendar);
  }
  return calendar;
}

/**
 * Święta ustawowe w Polsce w danym roku, posortowane rosnąco po dacie.
 * Zwracana tablica jest niemutowalna (współdzielona przez cache).
 *
 * Uwzględnia święta przypadające w niedzielę (Wielkanoc, Zielone Świątki) oraz w sobotę —
 * to nadal święta, choć dla dni roboczych nie zmieniają wyniku.
 *
 * @throws {RangeError} gdy rok jest spoza zakresu {@link POLISH_HOLIDAYS_FIRST_YEAR}–{@link POLISH_HOLIDAYS_LAST_YEAR}.
 */
export function polishPublicHolidays(year: number): readonly PolishPublicHoliday[] {
  return getYearCalendar(year).holidays;
}

/**
 * Czy dzień o podanym numerze (od 1970-01-01) jest świętem ustawowym. Funkcja wewnętrzna
 * modułu dat, używana w pętlach dni roboczych.
 *
 * @throws {RangeError} gdy rok jest spoza obsługiwanego zakresu.
 */
export function isPolishPublicHolidayEpochDay(epochDay: number): boolean {
  return getYearCalendar(epochDayToYear(epochDay)).epochDays.has(epochDay);
}

/**
 * Czy data jest świętem ustawowym w Polsce (dniem wolnym od pracy z mocy ustawy).
 *
 * @example isPolishPublicHoliday('2025-12-24') // true (Wigilia, od 2025 r.)
 * @example isPolishPublicHoliday('2024-12-24') // false
 * @throws {RangeError} gdy data jest nieprawidłowa lub rok jest spoza obsługiwanego zakresu.
 */
export function isPolishPublicHoliday(date: IsoDate): boolean {
  return isPolishPublicHolidayEpochDay(isoDateToEpochDay(date));
}
