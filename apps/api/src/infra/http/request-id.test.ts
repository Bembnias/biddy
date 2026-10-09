import { describe, expect, it } from 'vitest';

import {
  REQUEST_ID_HEADER,
  isValidRequestId,
  requestIdFor,
  resolveRequestId,
} from './request-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('isValidRequestId', () => {
  it.each([
    '0199c2f0-1234-7abc-8def-0123456789ab',
    'abc',
    'req-1',
    '8c1f2a3b4d5e6f70-WAW',
    '01JABCDEF0123456789XYZABCD',
    'a.b_c:d-e',
    'x'.repeat(128),
  ])('przyjmuje %j', (value) => {
    expect(isValidRequestId(value)).toBe(true);
  });

  it.each([
    ['pusty', ''],
    ['za długi', 'x'.repeat(129)],
    ['spacja', 'abc def'],
    ['nowa linia (wstrzyknięcie do logów)', 'abc\ninjected'],
    ['przecinek (kilka nagłówków połączonych przez Node)', 'abc, def'],
    ['ukośnik', 'a/b'],
    ['znak równości', 'Root=1-abc'],
    ['znaki spoza ASCII', 'żółć'],
    ['cudzysłów', 'a"b'],
    ['nawiasy HTML', '<script>'],
  ])('odrzuca: %s', (_label, value) => {
    expect(isValidRequestId(value)).toBe(false);
  });

  it('odrzuca wartości niebędące tekstem', () => {
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(['abc'])).toBe(false);
    expect(isValidRequestId(123)).toBe(false);
  });
});

describe('resolveRequestId', () => {
  it('zwraca poprawny identyfikator z nagłówka bez zmian', () => {
    expect(resolveRequestId('abc-123')).toBe('abc-123');
  });

  it('bez nagłówka generuje UUIDv7', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID_V7);
  });

  it('niepoprawny nagłówek zastępuje UUIDv7 (nie przepisuje go do logów)', () => {
    const id = resolveRequestId('zły identyfikator\n');
    expect(id).toMatch(UUID_V7);
  });

  it('kilka nagłówków (tablica) traktuje jak niepoprawny', () => {
    expect(resolveRequestId(['abc', 'def'])).toMatch(UUID_V7);
  });

  it('generowane identyfikatory są unikalne i rosną w czasie (UUIDv7)', () => {
    const ids = Array.from({ length: 100 }, () => resolveRequestId(undefined));
    expect(new Set(ids).size).toBe(100);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('requestIdFor (genReqId dla Fastify)', () => {
  it('czyta nagłówek x-request-id z surowego żądania', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
    expect(requestIdFor({ headers: { 'x-request-id': 'from-proxy-1' } })).toBe('from-proxy-1');
    expect(requestIdFor({ headers: { 'x-request-id': 'zły id' } })).toMatch(UUID_V7);
    expect(requestIdFor({ headers: {} })).toMatch(UUID_V7);
  });
});
