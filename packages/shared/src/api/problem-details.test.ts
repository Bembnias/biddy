import { describe, expect, it } from 'vitest';

import {
  ERROR_CODES,
  PROBLEM_CONTENT_TYPE,
  isErrorCode,
  isProblemDetails,
  problemTypeUri,
  type ErrorCode,
  type ProblemDetails,
} from './index.js';

const problem: ProblemDetails = {
  type: 'https://biddy.pl/problems/validation-failed',
  title: 'Nieprawidłowe dane',
  status: 400,
  detail: 'Popraw zaznaczone pola.',
  instance: '/v1/auctions',
  code: 'VALIDATION_FAILED',
  requestId: '0199c2f0-0000-7000-8000-000000000000',
  errors: [{ path: 'title', code: 'too_small', message: 'Za krótki tytuł' }],
};

describe('ERROR_CODES', () => {
  it('każdy kod jest równy swojej nazwie (wygodne w switch po stronie klienta)', () => {
    for (const [name, code] of Object.entries(ERROR_CODES)) {
      expect(code).toBe(name);
      expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    }
  });

  it('typ treści to application/problem+json (RFC 9457)', () => {
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });
});

describe('isErrorCode', () => {
  it.each([
    ['NOT_FOUND', true],
    ['VALIDATION_FAILED', true],
    ['not_found', false],
    ['BID_TOO_LOW', false],
    ['', false],
    [404, false],
    [undefined, false],
  ])('%j → %s', (value, expected) => {
    expect(isErrorCode(value)).toBe(expected);
  });

  it('zawęża typ do ErrorCode', () => {
    const value: unknown = 'CONFLICT';
    if (isErrorCode(value)) {
      const code: ErrorCode = value;
      expect(code).toBe('CONFLICT');
    }
  });
});

describe('problemTypeUri', () => {
  it.each([
    ['NOT_FOUND', 'https://biddy.pl/problems/not-found'],
    ['VALIDATION_FAILED', 'https://biddy.pl/problems/validation-failed'],
    ['INTERNAL_ERROR', 'https://biddy.pl/problems/internal-error'],
    ['CONFLICT', 'https://biddy.pl/problems/conflict'],
  ])('%s → %s', (code, uri) => {
    expect(problemTypeUri(code)).toBe(uri);
  });
});

describe('isProblemDetails', () => {
  it('przyjmuje pełny Problem Details z błędami pól', () => {
    expect(isProblemDetails(problem)).toBe(true);
  });

  it('przyjmuje nieznany kod (nowszy serwer niż klient) i dodatkowe pola', () => {
    expect(isProblemDetails({ ...problem, code: 'BID_TOO_LOW', minimumBid: 1500 })).toBe(true);
  });

  it('przyjmuje odpowiedź bez pola errors', () => {
    const { errors: _errors, ...withoutErrors } = problem;
    expect(isProblemDetails(withoutErrors)).toBe(true);
  });

  it.each([
    ['null', null],
    ['tablica', [problem]],
    ['tekst', 'Not Found'],
    ['błąd NestJS', { statusCode: 404, message: 'Cannot GET /x', error: 'Not Found' }],
    ['brak code', { ...problem, code: undefined }],
    ['pusty code', { ...problem, code: '' }],
    ['status jako tekst', { ...problem, status: '400' }],
    ['status ułamkowy', { ...problem, status: 400.5 }],
    ['brak requestId', { ...problem, requestId: undefined }],
    ['errors nie jest tablicą', { ...problem, errors: 'title' }],
    ['zły element errors', { ...problem, errors: [{ path: 'title' }] }],
  ])('odrzuca: %s', (_label, value) => {
    expect(isProblemDetails(value)).toBe(false);
  });
});
