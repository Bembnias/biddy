// Warstwa strefy czasowej: zamiana chwil (Date, UTC) na daty kalendarzowe w Polsce i z powrotem.
//
// Biddy liczy dni (robocze i kalendarzowe) zawsze wg czasu w Warszawie, niezależnie od strefy
// serwera, przeglądarki czy telefonu. Przesunięcie strefy bierzemy z Intl.DateTimeFormat
// (formatToParts) — bez bibliotek i bez API Node, więc kod działa też w React Native (Hermes).
// Wymaga środowiska z obsługą stref IANA w Intl (Node, współczesne przeglądarki, Hermes).

import { addBusinessDays } from './business-days.js';
import {
  type IsoDate,
  MS_PER_DAY,
  addCalendarDays,
  epochDayFromParts,
  isoDateFromParts,
  isoDateToEpochDay,
} from './iso-date.js';

/** Strefa czasowa, w której Biddy liczy daty i terminy. */
export const BIDDY_TIME_ZONE = 'Europe/Warsaw';

/**
 * Najwcześniejsza obsługiwana chwila (0001-01-01T00:00:00Z). Dla wcześniejszych chwil Intl
 * zwraca rok p.n.e. bez znaku, czego nie da się zapisać jako {@link IsoDate}.
 */
const MIN_INSTANT_MS = epochDayFromParts(1, 1, 1) * MS_PER_DAY;

interface WallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

let warsawFormatter: Intl.DateTimeFormat | undefined;

function getWarsawFormatter(): Intl.DateTimeFormat {
  if (warsawFormatter === undefined) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: BIDDY_TIME_ZONE,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    // Środowisko bez danych stref mogłoby po cichu użyć strefy urządzenia — wolimy błąd.
    if (formatter.resolvedOptions().timeZone !== BIDDY_TIME_ZONE) {
      throw new Error(`Środowisko nie obsługuje strefy czasowej ${BIDDY_TIME_ZONE} w Intl.`);
    }
    warsawFormatter = formatter;
  }
  return warsawFormatter;
}

function assertSupportedInstant(instantMs: number): void {
  if (Number.isNaN(instantMs)) {
    throw new RangeError('Nieprawidłowa chwila w czasie (Invalid Date).');
  }
  if (instantMs < MIN_INSTANT_MS) {
    throw new RangeError('Chwila sprzed roku 0001 jest poza obsługiwanym zakresem.');
  }
}

/** Wskazania zegara w Warszawie (z dokładnością do sekundy) w danej chwili. */
function readWarsawWallClock(instantMs: number): WallClockParts {
  assertSupportedInstant(instantMs);
  const parts = getWarsawFormatter().formatToParts(instantMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    const parsed = Number(value);
    if (value === undefined || !Number.isInteger(parsed)) {
      throw new Error(`Nieoczekiwany wynik Intl.DateTimeFormat dla strefy ${BIDDY_TIME_ZONE}.`);
    }
    return parsed;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Starsze silniki mimo hourCycle 'h23' potrafią zwrócić „24” o północy.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Przesunięcie czasu w Warszawie względem UTC w danej chwili, w milisekundach (np. 7 200 000 latem). */
function warsawOffsetMs(instantMs: number): number {
  // Intl pokazuje pełne sekundy (zaokrąglając w dół), więc liczymy od pełnej sekundy.
  const wholeSecondMs = Math.floor(instantMs / 1000) * 1000;
  const wall = readWarsawWallClock(wholeSecondMs);
  const wallClockAsUtcMs =
    epochDayFromParts(wall.year, wall.month, wall.day) * MS_PER_DAY +
    ((wall.hour * 60 + wall.minute) * 60 + wall.second) * 1000;
  return wallClockAsUtcMs - wholeSecondMs;
}

/** Wskazanie zegara w Warszawie zapisane jako liczba milisekund „jak gdyby w UTC”. */
function warsawWallClockMs(instantMs: number): number {
  return instantMs + warsawOffsetMs(instantMs);
}

/**
 * Pierwsza chwila (UTC), w której zegar w Warszawie pokazuje co najmniej `wallClockMs`.
 *
 * Bierzemy przesunięcia strefy dobę przed i dobę po (obejmują ewentualną zmianę czasu)
 * i sprawdzamy obu kandydatów. Gdy pasują oba (cofnięcie zegara), wybieramy wcześniejszego.
 * Gdy nie pasuje żaden (przestawienie do przodu — taka godzina nie istnieje), zwracamy
 * chwilę zmiany czasu, czyli pierwszą chwilę po luce.
 */
function warsawWallClockToInstantMs(wallClockMs: number): number {
  const offsetBefore = warsawOffsetMs(wallClockMs - MS_PER_DAY);
  const offsetAfter = warsawOffsetMs(wallClockMs + MS_PER_DAY);
  const earlier = wallClockMs - Math.max(offsetBefore, offsetAfter);
  const later = wallClockMs - Math.min(offsetBefore, offsetAfter);
  if (warsawWallClockMs(earlier) === wallClockMs) {
    return earlier;
  }
  if (warsawWallClockMs(later) === wallClockMs) {
    return later;
  }
  // Luka: w chwili `before` zegar pokazuje mniej niż wallClockMs, w chwili `after` więcej.
  // Szukamy połówkowo chwili zmiany czasu z dokładnością do sekundy.
  let before = earlier;
  let after = later;
  while (after - before > 1000) {
    const middle = before + Math.floor((after - before) / 2000) * 1000;
    if (warsawWallClockMs(middle) < wallClockMs) {
      before = middle;
    } else {
      after = middle;
    }
  }
  return after;
}

/**
 * Data kalendarzowa w Warszawie w danej chwili. Nie zależy od strefy czasowej urządzenia.
 *
 * @example toWarsawDate(new Date('2026-07-15T22:30:00Z')) // '2026-07-16' (00:30 czasu letniego)
 * @throws {RangeError} dla nieprawidłowej daty (Invalid Date) lub chwili spoza lat 0001–9999.
 */
export function toWarsawDate(instant: Date): IsoDate {
  const { year, month, day } = readWarsawWallClock(instant.getTime());
  return isoDateFromParts(year, month, day);
}

/**
 * Chwila (UTC) rozpoczęcia doby `date` w Warszawie, czyli lokalna północ.
 * Uwzględnia czas letni: np. 2026-03-29 zaczyna się o 2026-03-28T23:00:00Z (CET, UTC+1),
 * a 2026-03-30 o 2026-03-29T22:00:00Z (CEST, UTC+2). Doby zmiany czasu mają 23 lub 25 godzin.
 *
 * @throws {RangeError} dla nieprawidłowej daty lub daty sprzed 0001-01-02.
 */
export function warsawStartOfDay(date: IsoDate): Date {
  return new Date(warsawWallClockToInstantMs(isoDateToEpochDay(date) * MS_PER_DAY));
}

/**
 * Termin liczony w dniach roboczych od chwili `from` (np. opłacenia zamówienia), §7.4 i §15.7.
 *
 * Semantyka:
 * 1. Dzień startowy to data kalendarzowa chwili `from` w Warszawie ({@link toWarsawDate}),
 *    a nie w UTC: płatność w piątek o 23:30 czasu polskiego to piątek, a płatność w sobotę
 *    o 00:30 to sobota, choć w UTC jest jeszcze piątek.
 * 2. Dzień startowy się nie liczy. Liczymy `businessDays` dni roboczych następujących po nim
 *    ({@link addBusinessDays}: pon.–pt. bez świąt ustawowych; soboty nie są dniami roboczymi).
 * 3. Termin to koniec ostatniego z tych dni, czyli północ czasu warszawskiego rozpoczynająca
 *    następny dzień kalendarzowy, zwrócona jako chwila UTC. Termin jest wyłączny: czynność
 *    wykonana w chwili `t < termin` jest w terminie, a od chwili `t >= termin` termin minął.
 *
 * Dla `businessDays` = 0 terminem jest koniec dnia startowego.
 *
 * @example
 * // Opłacenie w poniedziałek 2026-10-05 o 14:00 czasu polskiego, nadanie w 5 dni roboczych:
 * // ostatni dzień to poniedziałek 2026-10-12, termin upływa o północy (CEST, UTC+2).
 * businessDayDeadline(new Date('2026-10-05T12:00:00Z'), 5) // 2026-10-12T22:00:00.000Z
 * @throws {RangeError} dla nieprawidłowej chwili, ujemnej lub niecałkowitej liczby dni albo
 *   gdy liczenie wychodzi poza kalendarz świąt (2011–2099).
 */
export function businessDayDeadline(from: Date, businessDays: number): Date {
  const lastDay = addBusinessDays(toWarsawDate(from), businessDays);
  return warsawStartOfDay(addCalendarDays(lastDay, 1));
}
