import { describe, expect, it } from 'vitest';

import { contactKinds, groupByDay } from './messaging';

describe('contactKinds', () => {
  const label = (flag: string) =>
    ({ PHONE: 'numer telefonu', EMAIL: 'adres e-mail', IBAN: 'numer konta' })[flag] ?? flag;

  it('łączy rodzaje danych spójnikiem', () => {
    expect(contactKinds(['PHONE'], label)).toBe('numer telefonu');
    expect(contactKinds(['PHONE', 'EMAIL'], label)).toBe('numer telefonu i adres e-mail');
    expect(contactKinds(['PHONE', 'EMAIL', 'IBAN'], label)).toBe(
      'numer telefonu, adres e-mail i numer konta',
    );
  });
});

describe('groupByDay', () => {
  it('grupuje kolejne wiadomości z tego samego dnia w Warszawie', () => {
    const groups = groupByDay([
      { id: 'a', createdAt: '2026-11-02T22:30:00.000Z' },
      { id: 'b', createdAt: '2026-11-02T23:30:00.000Z' },
      { id: 'c', createdAt: '2026-11-03T08:00:00.000Z' },
    ]);
    expect(groups.map((group) => [group.day, group.items.map((item) => item.id)])).toEqual([
      ['2026-11-02', ['a']],
      ['2026-11-03', ['b', 'c']],
    ]);
  });
});
