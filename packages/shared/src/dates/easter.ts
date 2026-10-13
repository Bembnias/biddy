import { type IsoDate, isoDateFromParts } from './iso-date.js';

/** Pierwszy rok, od którego algorytm daje datę Wielkanocy w kalendarzu gregoriańskim. */
const FIRST_GREGORIAN_EASTER_YEAR = 1583;
const LAST_SUPPORTED_YEAR = 9999;

/**
 * Data Wielkanocy (niedziela wielkanocna, obrządek zachodni) w kalendarzu gregoriańskim.
 * Anonimowy algorytm gregoriański (Meeus/Jones/Butcher), bez tabel i bez obiektów Date.
 *
 * @example easterSunday(2026) // '2026-04-05'
 * @throws {RangeError} gdy rok nie jest liczbą całkowitą z zakresu 1583–9999.
 */
export function easterSunday(year: number): IsoDate {
  if (!Number.isInteger(year) || year < FIRST_GREGORIAN_EASTER_YEAR || year > LAST_SUPPORTED_YEAR) {
    throw new RangeError(
      `Datę Wielkanocy liczymy dla lat ${FIRST_GREGORIAN_EASTER_YEAR}–${LAST_SUPPORTED_YEAR}, podano: ${year}.`,
    );
  }
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDateFromParts(year, month, day);
}
