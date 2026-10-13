import type { ErrorCode } from '@biddy/shared';

import { ERROR_DEFINITIONS } from './error-catalog.js';

export interface DomainErrorOptions {
  /** Kod domenowy z @biddy/shared (ERROR_CODES); po nim klient rozpoznaje błąd. */
  readonly code: ErrorCode;
  /** Opis dla użytkownika (po polsku). Domyślnie ogólny opis kodu. */
  readonly detail?: string;
  /** Status HTTP. Domyślnie status przypisany do kodu (error-catalog.ts). */
  readonly status?: number;
  /** Dodatkowe pola odpowiedzi (np. `minimumBid`). Nie mogą nadpisać pól standardowych. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** Pierwotna przyczyna (trafia do logów, nigdy do odpowiedzi). */
  readonly cause?: unknown;
}

/**
 * Błąd domenowy rzucany przez moduły. Filtr Problem Details zamienia go na odpowiedź
 * RFC 9457 z polem `code`.
 *
 * @example
 * throw new DomainError({ code: 'NOT_FOUND', detail: 'Aukcja nie istnieje albo została usunięta.' });
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(options: DomainErrorOptions) {
    const definition = ERROR_DEFINITIONS[options.code];
    const detail = options.detail ?? definition.detail;
    super(detail, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.code = options.code;
    this.status = options.status ?? definition.status;
    this.detail = detail;
    this.extensions = options.extensions ?? {};
  }
}
