// Dni robocze: od poniedziałku do piątku, z wyjątkiem świąt ustawowych w Polsce.
// Soboty NIE są dniami roboczymi. To jedyne miejsce, w którym liczymy terminy w dniach
// roboczych (PROJECT.md §15.7), np. „Nadanie: 5 dni roboczych od opłacenia” (§7.4).

import {
  type IsoDate,
  epochDayToIsoDate,
  epochDayToIsoDayOfWeek,
  isoDateToEpochDay,
} from './iso-date.js';
import { isPolishPublicHolidayEpochDay } from './polish-holidays.js';

function isBusinessEpochDay(epochDay: number): boolean {
  // Najpierw kalendarz świąt: rzuca RangeError dla lat spoza zakresu, także dla weekendów.
  const isHoliday = isPolishPublicHolidayEpochDay(epochDay);
  return !isHoliday && epochDayToIsoDayOfWeek(epochDay) <= 5;
}

/**
 * Czy data jest dniem roboczym: poniedziałek–piątek i nie jest świętem ustawowym w Polsce.
 *
 * @example isBusinessDay('2026-12-24') // false (Wigilia jest dniem wolnym od 2025 r.)
 * @example isBusinessDay('2024-12-24') // true
 * @throws {RangeError} gdy data jest nieprawidłowa lub rok jest spoza kalendarza świąt (2011–2099).
 */
export function isBusinessDay(date: IsoDate): boolean {
  return isBusinessEpochDay(isoDateToEpochDay(date));
}

/**
 * Data, w której upływa `businessDays` dni roboczych liczonych od dnia następującego
 * po `date` (sam dzień `date` się nie liczy, nawet jeśli jest roboczy).
 * Dla `businessDays` = 0 zwraca `date` bez zmian.
 *
 * @example addBusinessDays('2026-12-22', 5) // '2026-12-31' (pomija Wigilię, święta i weekend)
 * @example addBusinessDays('2026-10-09', 1) // '2026-10-12' (z piątku na poniedziałek)
 * @throws {RangeError} gdy `businessDays` nie jest nieujemną liczbą całkowitą, data jest
 *   nieprawidłowa albo liczenie wychodzi poza kalendarz świąt (2011–2099).
 */
export function addBusinessDays(date: IsoDate, businessDays: number): IsoDate {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new RangeError(
      `Liczba dni roboczych musi być nieujemną liczbą całkowitą, otrzymano ${businessDays}.`,
    );
  }
  const startDay = isoDateToEpochDay(date);
  // Walidujemy rok także dla 0 dni, żeby błąd zakresu nie zależał od liczby dni.
  isPolishPublicHolidayEpochDay(startDay);

  let epochDay = startDay;
  let remaining = businessDays;
  while (remaining > 0) {
    epochDay += 1;
    if (isBusinessEpochDay(epochDay)) {
      remaining -= 1;
    }
  }
  return epochDay === startDay ? date : epochDayToIsoDate(epochDay);
}

/**
 * Najbliższy dzień roboczy po `date` (ściśle późniejszy).
 *
 * @example nextBusinessDay('2026-12-23') // '2026-12-28'
 * @throws {RangeError} jak {@link addBusinessDays}.
 */
export function nextBusinessDay(date: IsoDate): IsoDate {
  return addBusinessDays(date, 1);
}
