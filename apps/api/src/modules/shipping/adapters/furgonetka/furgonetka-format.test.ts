import { describe, expect, it } from 'vitest';

import {
  commandUuid,
  furgonetkaChecksum,
  furgonetkaErrors,
  furgonetkaField,
  mapFurgonetkaTracking,
  parseFurgonetkaDate,
  verifyFurgonetkaChecksum,
} from './furgonetka-format.js';
import { TokenCipher } from './furgonetka-token-store.js';

const at = (iso: string) => new Date(iso);

describe('mapowanie trackingu Furgonetki (spec F-24)', () => {
  it('stany na statusy Biddy, w kolejności czasu', () => {
    const events = mapFurgonetkaTracking([
      {
        state: 'waiting-for-receiver',
        description: 'W punkcie',
        occurredAt: at('2026-10-22T12:00:00Z'),
      },
      {
        state: 'collected',
        description: 'Odebrana od nadawcy',
        occurredAt: at('2026-10-22T08:00:00Z'),
      },
      { state: 'transit', description: null, occurredAt: at('2026-10-22T10:00:00Z') },
      { state: 'delivered', description: 'Odebrana', occurredAt: at('2026-10-22T14:00:00Z') },
    ]);
    expect(events.map((event) => event.status)).toEqual([
      'DROPPED_OFF',
      'IN_TRANSIT',
      'READY_FOR_PICKUP',
      'DELIVERED',
    ]);
    expect(events[0]).toMatchObject({ rawStatus: 'collected', description: 'Odebrana od nadawcy' });
  });

  it('`returned`, a potem `delivered`: zwrot w drodze i doręczenie zwrotu nadawcy', () => {
    const events = mapFurgonetkaTracking([
      { state: 'waiting-for-receiver', description: null, occurredAt: at('2026-10-22T10:00:00Z') },
      { state: 'returned', description: null, occurredAt: at('2026-10-24T10:00:00Z') },
      { state: 'delivered', description: null, occurredAt: at('2026-10-26T10:00:00Z') },
    ]);
    expect(events.map((event) => event.status)).toEqual([
      'READY_FOR_PICKUP',
      'RETURNING',
      'RETURNED',
    ]);
  });

  it('problemy to EXCEPTION, nieznany stan jest pomijany i zgłaszany', () => {
    const unknown: string[] = [];
    const events = mapFurgonetkaTracking(
      [
        { state: 'delivery-problem', description: null, occurredAt: at('2026-10-22T10:00:00Z') },
        { state: 'teleported', description: null, occurredAt: at('2026-10-22T11:00:00Z') },
      ],
      (state) => unknown.push(state),
    );
    expect(events.map((event) => event.status)).toEqual(['EXCEPTION']);
    expect(unknown).toEqual(['teleported']);
  });
});

describe('suma kontrolna webhooka Furgonetki', () => {
  const payload = {
    package_id: 123456,
    package_no: '6600123',
    partner_order_id: '',
    tracking: {
      state: 'delivered',
      description: 'Przesyłka doręczona',
      datetime: '2026-10-22 12:00:00',
      branch: '',
    },
  };

  it('md5 z pól w kolejności dokumentacji i tokenu; inna treść albo token: niepoprawna', () => {
    const control = furgonetkaChecksum(payload, 'token');
    expect(control).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyFurgonetkaChecksum({ ...payload, control }, 'token')).toBe(true);
    expect(verifyFurgonetkaChecksum({ ...payload, control }, 'inny')).toBe(false);
    expect(
      verifyFurgonetkaChecksum(
        { ...payload, control, tracking: { ...payload.tracking, state: 'returned' } },
        'token',
      ),
    ).toBe(false);
    expect(verifyFurgonetkaChecksum(payload, 'token')).toBe(false);
  });
});

describe('UUID komend, czas i błędy Furgonetki', () => {
  it('UUID z klucza: deterministyczny, w formacie UUID, inny dla innego klucza', () => {
    const uuid = commandUuid('shipment:0199:1:create');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(commandUuid('shipment:0199:1:create')).toBe(uuid);
    expect(commandUuid('shipment:0199:2:create')).not.toBe(uuid);
  });

  it('czas „naiwny” to Warszawa (lato UTC+2, zima UTC+1); z przesunięciem bez zmian', () => {
    expect(parseFurgonetkaDate('2026-07-01 12:00:00')?.toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(parseFurgonetkaDate('2026-12-01 12:00')?.toISOString()).toBe('2026-12-01T11:00:00.000Z');
    expect(parseFurgonetkaDate('2026-07-01T12:00:00+02:00')?.toISOString()).toBe(
      '2026-07-01T10:00:00.000Z',
    );
    expect(parseFurgonetkaDate('wczoraj')).toBeUndefined();
    expect(parseFurgonetkaDate(null)).toBeUndefined();
  });

  it('błędy w obu kształtach i ścieżki pól na pola Biddy', () => {
    expect(
      furgonetkaErrors({ errors: [{ path: '/pickup/phone', message: 'Zły numer', code: 'x' }] }),
    ).toEqual([{ path: '/pickup/phone', message: 'Zły numer', code: 'x' }]);
    expect(furgonetkaErrors({ code: 'terms', message: 'Regulamin' })).toEqual([
      { path: '', message: 'Regulamin', code: 'terms' },
    ]);
    expect(furgonetkaField('/pickup/phone')).toBe('sender.phone');
    expect(furgonetkaField('/receiver/postcode')).toBe('recipient.address.postalCode');
    expect(furgonetkaField('/receiver/point')).toBe('pickupPointId');
    expect(furgonetkaField('/0/postcode')).toBeUndefined();
  });
});

describe('szyfrowanie tokenów Furgonetki', () => {
  it('szyfrogram różny przy każdym zapisie, odszyfrowanie tym samym sekretem', () => {
    const cipher = new TokenCipher('sekret');
    const first = cipher.encrypt('token-dostepu');
    expect(first.equals(cipher.encrypt('token-dostepu'))).toBe(false);
    expect(first.toString('utf8')).not.toContain('token-dostepu');
    expect(cipher.decrypt(first)).toBe('token-dostepu');
    expect(() => new TokenCipher('inny').decrypt(first)).toThrow();
  });
});
