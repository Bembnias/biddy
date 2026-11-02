import { ApiError } from '@biddy/api-client';
import { describe, expect, it } from 'vitest';

import { MAX_QUERY_RETRIES, shouldRetryQuery } from './query-client';

function apiError(status: number): ApiError {
  return new ApiError({ status, message: `status ${status}` });
}

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409, 422])('nie ponawia błędu klienta %i', (status) => {
    expect(shouldRetryQuery(0, apiError(status))).toBe(false);
  });

  it.each([0, 500, 502, 503])(
    'ponawia brak odpowiedzi i błąd serwera (status %i) najwyżej 2 razy',
    (status) => {
      expect(shouldRetryQuery(0, apiError(status))).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, apiError(status))).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, apiError(status))).toBe(false);
    },
  );

  it('ponawia inne błędy (np. TypeError) w tym samym limicie', () => {
    expect(shouldRetryQuery(0, new TypeError('x'))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError('x'))).toBe(false);
  });
});
