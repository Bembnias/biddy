import { describe, expect, it } from 'vitest';

import {
  amountInputValue,
  bankAccountSchema,
  historyLabel,
  parsePayoutAmount,
  personalDataSchema,
} from './payout-view';

const t = (key: string) => key;

const valid = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  birthDate: '1944-05-14',
  taxIdKind: 'PESEL' as const,
  taxId: '44051401359',
  street: 'ul. Długa 5/2',
  postalCode: '00950',
  city: 'Warszawa',
};

const issues = (value: object) => {
  const result = personalDataSchema(t, '2026-11-02').safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('parsePayoutAmount', () => {
  it('złote z przecinkiem, spacjami i walutą; puste i błędne osobno', () => {
    expect(parsePayoutAmount('25')).toBe(2_500);
    expect(parsePayoutAmount('25,5')).toBe(2_550);
    expect(parsePayoutAmount('1 200 zł')).toBe(120_000);
    expect(parsePayoutAmount(' ')).toBe('empty');
    expect(parsePayoutAmount('dwadzieścia')).toBe('invalid');
    expect(parsePayoutAmount('0')).toBe('invalid');
    expect(parsePayoutAmount('1,234')).toBe('invalid');
  });

  it('wartość pola z groszy bez zbędnych zer', () => {
    expect(amountInputValue(5_000)).toBe('50');
    expect(amountInputValue(12_345)).toBe('123,45');
    expect(amountInputValue(1_205)).toBe('12,05');
  });
});

describe('historyLabel', () => {
  it('znane typy mają własną etykietę, reszta ogólną', () => {
    expect(historyLabel('ORDER_COMPLETED')).toBe('ORDER_COMPLETED');
    expect(historyLabel('REVERSAL')).toBe('REVERSAL');
    expect(historyLabel('PAYMENT_RECEIVED')).toBe('OTHER');
  });
});

describe('personalDataSchema', () => {
  it('poprawne dane z PESEL albo NIP przechodzą', () => {
    expect(issues(valid)).toEqual([]);
    expect(issues({ ...valid, taxIdKind: 'NIP', taxId: '526-025-02-74' })).toEqual([]);
  });

  it('zły PESEL, niezgodna data, zły NIP i wiek poniżej 18 lat', () => {
    expect(issues({ ...valid, taxId: '44051401358' })).toEqual(['PESEL']);
    expect(issues({ ...valid, birthDate: '1944-05-15' })).toEqual(['peselBirthDate']);
    expect(issues({ ...valid, taxIdKind: 'NIP', taxId: '5260250275' })).toEqual(['NIP']);
    expect(
      issues({ ...valid, taxIdKind: 'NIP', taxId: '5260250274', birthDate: '2008-11-03' }),
    ).toEqual(['adult']);
    expect(issues({ ...valid, postalCode: '0095', city: 'W' })).toEqual(['postalCode', 'city']);
  });
});

describe('bankAccountSchema', () => {
  it('polski IBAN z sumą kontrolną', () => {
    const schema = bankAccountSchema(t);
    expect(
      schema.safeParse({ iban: '61 1090 1014 0000 0712 1981 2874', holderName: 'Anna K' }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ iban: 'PL62 1090 1014 0000 0712 1981 2874', holderName: 'Anna K' })
        .success,
    ).toBe(false);
  });
});
