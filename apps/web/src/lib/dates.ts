/**
 * Miesiąc i rok w dopełniaczu, np. „października 2026” (do zdań „od …”). Sam miesiąc z rokiem
 * Intl podaje w mianowniku („październik 2026”), więc bierzemy części z pełnej daty. Strefa
 * Europe/Warsaw, jak w całej aplikacji.
 */
export function monthAndYear(date: Date): string {
  const parts = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('month')} ${value('year')}`;
}

const DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Europe/Warsaw',
});

/** Dzień kalendarzowy w strefie Europe/Warsaw jako „2026-10-26” (do grup „Dzisiaj”, F-63). */
export function warsawDay(date: Date | number): string {
  return DAY.format(date);
}
