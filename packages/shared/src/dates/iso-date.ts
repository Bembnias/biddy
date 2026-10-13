// Daty kalendarzowe (bez godziny i strefy czasowej) jako napisy ISO 8601 „RRRR-MM-DD”.
//
// Cała arytmetyka działa na liczbach całkowitych (numer dnia od 1970-01-01 w kalendarzu
// gregoriańskim proleptycznym). Nie używamy obiektów Date ani strefy czasowej procesu,
// więc wynik jest taki sam na serwerze, w przeglądarce i w React Native (Hermes).

/**
 * Data kalendarzowa w formacie ISO 8601 „RRRR-MM-DD” (np. `'2026-12-24'`), bez godziny
 * i bez strefy czasowej. Obsługiwane lata: 0000–9999.
 *
 * Typ szablonowy przepuszcza literały w kodzie, ale nie dowolny `string`: dane z zewnątrz
 * (API, baza, formularz) trzeba sprawdzić przez {@link isIsoDate} lub {@link assertIsoDate}.
 * Każda funkcja modułu i tak waliduje datę w czasie działania, bo typ nie wyklucza
 * wartości w rodzaju `'2026-2-30'`.
 */
export type IsoDate = `${number}-${number}-${number}`;

/** Dzień tygodnia wg ISO 8601: 1 = poniedziałek, …, 6 = sobota, 7 = niedziela. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Składowe daty kalendarzowej (miesiąc 1–12, dzień 1–31). */
export interface IsoDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Liczba milisekund w dobie (bez uwzględniania zmiany czasu). */
export const MS_PER_DAY = 86_400_000;

const MIN_YEAR = 0;
const MAX_YEAR = 9999;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isValidParts(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

function parseParts(value: string): IsoDateParts | undefined {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidParts(year, month, day) ? { year, month, day } : undefined;
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : typeof value;
}

/** Waliduje datę „RRRR-MM-DD” i zwraca jej składowe (wspólna logika walidacji modułu). */
function requireParts(value: unknown): IsoDateParts {
  if (typeof value !== 'string') {
    throw new TypeError(
      `Oczekiwano daty w formacie RRRR-MM-DD, otrzymano ${describeValue(value)}.`,
    );
  }
  const parts = parseParts(value);
  if (parts === undefined) {
    throw new RangeError(
      `Nieprawidłowa data kalendarzowa: ${describeValue(value)} (oczekiwano istniejącej daty RRRR-MM-DD).`,
    );
  }
  return parts;
}

/**
 * Numer dnia od 1970-01-01 (który ma numer 0) dla daty w kalendarzu gregoriańskim
 * proleptycznym. Algorytm „days_from_civil” Howarda Hinnanta. Nie waliduje składowych.
 * Funkcja wewnętrzna modułu dat.
 */
export function epochDayFromParts(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const shiftedMonth = (month + 9) % 12; // marzec = 0, …, luty = 11
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** Odwrotność {@link epochDayFromParts} (algorytm „civil_from_days” Howarda Hinnanta). */
function partsFromEpochDay(epochDay: number): IsoDateParts {
  const shifted = epochDay + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

const MIN_EPOCH_DAY = epochDayFromParts(MIN_YEAR, 1, 1);
const MAX_EPOCH_DAY = epochDayFromParts(MAX_YEAR, 12, 31);

function formatParts(year: number, month: number, day: number): IsoDate {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  // Napisy złożone z cyfr — rzutowanie na typ szablonowy jest bezpieczne.
  return `${yyyy}-${mm}-${dd}` as IsoDate;
}

/** Czy wartość jest poprawną datą „RRRR-MM-DD”, która istnieje w kalendarzu (lata 0000–9999). */
export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && parseParts(value) !== undefined;
}

/**
 * Rzuca wyjątek, jeśli wartość nie jest poprawną datą „RRRR-MM-DD” (patrz {@link isIsoDate}).
 *
 * @throws {TypeError} gdy wartość nie jest napisem.
 * @throws {RangeError} gdy napis nie jest istniejącą datą w formacie „RRRR-MM-DD”.
 */
export function assertIsoDate(value: unknown): asserts value is IsoDate {
  requireParts(value);
}

/**
 * Składa datę z roku, miesiąca (1–12) i dnia (1–31).
 *
 * @throws {RangeError} gdy taka data nie istnieje lub rok jest spoza zakresu 0000–9999.
 */
export function isoDateFromParts(year: number, month: number, day: number): IsoDate {
  if (!isValidParts(year, month, day)) {
    throw new RangeError(
      `Nieprawidłowa data kalendarzowa: rok ${year}, miesiąc ${month}, dzień ${day}.`,
    );
  }
  return formatParts(year, month, day);
}

/**
 * Rozkłada datę na rok, miesiąc (1–12) i dzień.
 *
 * @throws {RangeError} gdy data jest nieprawidłowa.
 */
export function isoDateToParts(date: IsoDate): IsoDateParts {
  return requireParts(date);
}

/**
 * Numer dnia liczony od 1970-01-01 (= 0). Funkcja wewnętrzna modułu dat.
 *
 * @throws {RangeError} gdy data jest nieprawidłowa.
 */
export function isoDateToEpochDay(date: IsoDate): number {
  const { year, month, day } = isoDateToParts(date);
  return epochDayFromParts(year, month, day);
}

/**
 * Data dla numeru dnia liczonego od 1970-01-01 (= 0). Funkcja wewnętrzna modułu dat.
 *
 * @throws {RangeError} gdy wynik wypada poza lata 0000–9999.
 */
export function epochDayToIsoDate(epochDay: number): IsoDate {
  if (!Number.isInteger(epochDay) || epochDay < MIN_EPOCH_DAY || epochDay > MAX_EPOCH_DAY) {
    throw new RangeError(`Data poza obsługiwanym zakresem lat ${MIN_YEAR}–${MAX_YEAR}.`);
  }
  const { year, month, day } = partsFromEpochDay(epochDay);
  return formatParts(year, month, day);
}

/** Rok daty o podanym numerze dnia (od 1970-01-01). Funkcja wewnętrzna modułu dat. */
export function epochDayToYear(epochDay: number): number {
  return partsFromEpochDay(epochDay).year;
}

/** Dzień tygodnia (ISO 8601) dla numeru dnia od 1970-01-01. Funkcja wewnętrzna modułu dat. */
export function epochDayToIsoDayOfWeek(epochDay: number): IsoDayOfWeek {
  // 1970-01-01 był czwartkiem (4).
  return ((((epochDay % 7) + 7 + 3) % 7) + 1) as IsoDayOfWeek;
}

/**
 * Dodaje (lub odejmuje, gdy `days` < 0) dni kalendarzowe.
 *
 * @example addCalendarDays('2026-12-31', 1) // '2027-01-01'
 * @throws {RangeError} gdy `days` nie jest liczbą całkowitą albo wynik wypada poza lata 0000–9999.
 */
export function addCalendarDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError(`Liczba dni musi być liczbą całkowitą, otrzymano ${days}.`);
  }
  return epochDayToIsoDate(isoDateToEpochDay(date) + days);
}

/**
 * Dzień tygodnia wg ISO 8601: 1 = poniedziałek, …, 7 = niedziela.
 *
 * @example isoDayOfWeek('2026-12-24') // 4 (czwartek)
 */
export function isoDayOfWeek(date: IsoDate): IsoDayOfWeek {
  return epochDayToIsoDayOfWeek(isoDateToEpochDay(date));
}
