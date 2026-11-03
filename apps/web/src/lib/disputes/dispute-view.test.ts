import type { DisputeDto } from '@biddy/api-client';
import { describe, expect, it } from 'vitest';

import { disputeDeadline, disputeFormSchema, parseOfferAmount } from './dispute-view';

const messages = (key: string) => key;

describe('formularz zgłoszenia', () => {
  const schema = disputeFormSchema(messages);
  const valid = {
    reason: 'OTHER',
    description: 'Paczka przyszła z innym przedmiotem.',
    mediaIds: [],
  };

  it('przyjmuje zgłoszenie bez zdjęcia przy innym problemie', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('wymaga zdjęcia przy wadzie przedmiotu i opisu od 20 znaków', () => {
    const result = schema.safeParse({ ...valid, reason: 'DAMAGED', description: 'Pęknięty.' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'descriptionShort',
      'photoRequired',
    ]);
  });
});

describe('propozycja zwrotu', () => {
  it('kwota w groszach, najwyżej cena', () => {
    expect(parseOfferAmount('25,50', 12_000)).toBe(2_550);
    expect(parseOfferAmount('120', 12_000)).toBe(12_000);
    expect(parseOfferAmount('120,01', 12_000)).toBe('tooHigh');
    expect(parseOfferAmount('', 12_000)).toBe('empty');
    expect(parseOfferAmount('abc', 12_000)).toBe('invalid');
  });
});

describe('termin bieżącego kroku', () => {
  const base = {
    responseDueAt: '2026-11-05T10:00:00.000Z',
    decisionDueAt: '2026-11-06T10:00:00.000Z',
    return: { shipBy: '2026-11-10T23:00:00.000Z', inspectionEndsAt: '2026-11-12T10:00:00.000Z' },
  } as unknown as DisputeDto;

  it('odpowiedź, decyzja, nadanie i sprawdzenie zwrotu', () => {
    expect(disputeDeadline({ ...base, status: 'AWAITING_SELLER' })).toBe(base.responseDueAt);
    expect(disputeDeadline({ ...base, status: 'ESCALATED' })).toBe(base.decisionDueAt);
    expect(disputeDeadline({ ...base, status: 'AWAITING_RETURN' })).toBe(
      '2026-11-10T23:00:00.000Z',
    );
    expect(disputeDeadline({ ...base, status: 'RETURN_DELIVERED' })).toBe(
      '2026-11-12T10:00:00.000Z',
    );
    expect(disputeDeadline({ ...base, status: 'RESOLVED' })).toBeNull();
  });
});
