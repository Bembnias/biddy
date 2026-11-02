// Polskie kody pocztowe (F-10): zapis `NN-NNN`, pole przyjmuje też `NNNNN`.

export const POSTAL_CODE_MESSAGE = 'Podaj kod pocztowy w formacie 00-000.';

/** Kod w formacie `NN-NNN` albo `undefined`, gdy wejście nie jest polskim kodem pocztowym. */
export function normalizePostalCode(value: string): string | undefined {
  const match = /^(\d{2})-?(\d{3})$/u.exec(value.trim());
  return match === null ? undefined : `${match[1]}-${match[2]}`;
}
