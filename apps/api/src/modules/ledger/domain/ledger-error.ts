/**
 * Kod błędu księgowania:
 * - `INVALID_POSTING`: błędne dane księgowania (kwota ujemna lub zerowa, różne waluty, zwrot
 *   częściowy ponad cenę, storno storna),
 * - `INSUFFICIENT_FUNDS`: księgowanie zostawiłoby saldo konta po złej stronie, np. wypłata ponad
 *   saldo dostępne albo zwrot ponad środki wstrzymane na zamówieniu,
 * - `IDEMPOTENCY_CONFLICT`: klucz księgowania użyty już dla innych danych,
 * - `ACCOUNT_MISMATCH`: konto istnieje z innym sprzedającym albo inną częścią sprzedającego,
 * - `TRANSACTION_NOT_FOUND`: storno nieistniejącej transakcji,
 * - `ALREADY_REVERSED`: transakcja ma już storno.
 */
export type LedgerErrorCode =
  | 'INVALID_POSTING'
  | 'INSUFFICIENT_FUNDS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ACCOUNT_MISMATCH'
  | 'TRANSACTION_NOT_FOUND'
  | 'ALREADY_REVERSED';

/**
 * Błąd wewnętrznego API ledgera. Przerywa transakcję wywołującego; moduł z API HTTP (np. wypłaty
 * w F-27) mapuje go na własny kod błędu.
 */
export class LedgerError extends Error {
  override name = 'LedgerError';
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
