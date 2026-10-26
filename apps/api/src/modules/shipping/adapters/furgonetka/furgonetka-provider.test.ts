import { describe, expect, it } from 'vitest';

import type { FurgonetkaConfig } from '../../../../infra/config/index.js';
import type { ShipmentParty } from '../../db/shipping.schema.js';
import {
  type CarrierConfig,
  type CreateShipmentInput,
  isShippingProviderError,
} from '../../ports/shipping-provider.port.js';
import { FurgonetkaClient } from './furgonetka-client.js';
import { commandUuid, furgonetkaChecksum } from './furgonetka-format.js';
import { FurgonetkaProvider } from './furgonetka-provider.js';
import type { FurgonetkaTokens, FurgonetkaTokenStore } from './furgonetka-token-store.js';

const CONFIG: FurgonetkaConfig = {
  apiUrl: 'https://api.sandbox.furgonetka.pl',
  clientId: 'client',
  clientSecret: 'secret',
  username: 'sklep@biddy.pl',
  password: 'haslo',
  webhookToken: 'webhook-token',
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type Handler = (call: Call) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Atrapa API Furgonetki: handlery po kolei, pierwszy pasujący odpowiada. */
function fakeApi(handlers: Handler[]) {
  const calls: Call[] = [];
  const fetchFn = ((input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    const raw = init?.body;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof raw === 'string' && raw.startsWith('{') ? (JSON.parse(raw) as unknown) : raw,
    };
    calls.push(call);
    for (const handler of handlers) {
      const response = handler(call);
      if (response !== undefined) {
        return Promise.resolve(response);
      }
    }
    return Promise.resolve(
      json(404, { errors: [{ path: '', message: `brak ${call.method} ${call.path}`, code: '' }] }),
    );
  }) as typeof fetch;
  return { calls, fetchFn };
}

/** Magazyn tokenów w pamięci z tą samą semantyką blokady co w bazie. */
class MemoryTokens implements FurgonetkaTokenStore {
  tokens: FurgonetkaTokens | undefined;

  current(): Promise<FurgonetkaTokens | undefined> {
    return Promise.resolve(this.tokens);
  }

  async rotate(
    stale: string | undefined,
    obtain: (current: FurgonetkaTokens | undefined) => Promise<FurgonetkaTokens>,
  ): Promise<FurgonetkaTokens> {
    if (this.tokens !== undefined && this.tokens.accessToken !== stale) {
      return this.tokens;
    }
    this.tokens = await obtain(this.tokens);
    return this.tokens;
  }
}

const tokenEndpoint: Handler = (call) => {
  if (call.path !== '/oauth/token') {
    return undefined;
  }
  const form = new URLSearchParams(String(call.body));
  return form.get('grant_type') === 'password'
    ? json(200, { access_token: 'A1', refresh_token: 'R1', expires_in: 3600 })
    : json(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 });
};

const services: Handler = (call) =>
  call.path === '/account/services'
    ? json(200, {
        services: [
          { id: 7, service: 'inpost', owner: 'client' },
          { id: 11, service: 'inpost', owner: 'furgonetka' },
          { id: 21, service: 'dpd', owner: 'furgonetka' },
        ],
      })
    : undefined;

function provider(handlers: Handler[], tokens = new MemoryTokens()) {
  const api = fakeApi([tokenEndpoint, services, ...handlers]);
  const client = new FurgonetkaClient(CONFIG, tokens, {
    fetch: api.fetchFn,
    sleep: () => Promise.resolve(),
    commandPollAttempts: 3,
  });
  return {
    provider: new FurgonetkaProvider(client, CONFIG.webhookToken),
    calls: api.calls,
    tokens,
  };
}

const locker: CarrierConfig = {
  id: 'inpost-paczkomat',
  kind: 'LOCKER',
  providerCodes: { furgonetka: 'inpost' },
};

const sender: ShipmentParty = {
  name: 'Anna Sprzedająca',
  phone: '+48500600700',
  email: 'anna@example.com',
  address: { street: 'ul. Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
};

const input: CreateShipmentInput = {
  idempotencyKey: 'shipment:0199:1',
  carrier: locker,
  packageSize: 'M',
  parcel: { weightGrams: null, dimensionsCm: null },
  declaredValue: { amount: 12_000, currency: 'PLN' },
  sender,
  recipient: {
    name: 'Jan Kupujący',
    phone: '+48600700800',
    email: 'jan@example.com',
    address: null,
  },
  pickupPointId: 'WAW01M',
  dispatchMethod: 'DROP_OFF',
  reference: 'k3x9qa7m',
};

const CREATE_UUID = commandUuid('shipment:0199:1:create');
const ORDER_UUID = commandUuid('shipment:0199:1:order');

/** Udane utworzenie i zamówienie przesyłki 555; PUT komendy odpowiada `commandExists`. */
const happyCreation: Handler[] = [
  (call) =>
    call.method === 'PUT' && call.path === `/create-package-command/${CREATE_UUID}`
      ? json(400, { errors: [{ path: '/uuid', message: 'exists', code: 'commandExists' }] })
      : undefined,
  (call) =>
    call.method === 'GET' && call.path === `/create-package-command/${CREATE_UUID}`
      ? json(200, { uuid: CREATE_UUID, status: 'successful', package_id: '555', errors: [] })
      : undefined,
  (call) =>
    call.method === 'PUT' && call.path === `/order-commands/${ORDER_UUID}`
      ? new Response(null, { status: 202 })
      : undefined,
  (call) =>
    call.method === 'GET' && call.path === `/order-commands/${ORDER_UUID}`
      ? json(200, { status: 'successful', errors: [], successfully_ordered_packages: ['555'] })
      : undefined,
  (call) =>
    call.path === '/packages/555'
      ? json(200, {
          package_id: '555',
          parcels: [{ package_no: '620000123456' }],
          pricing: { price_gross: 13.53 },
        })
      : undefined,
];

describe('FurgonetkaProvider: tworzenie przesyłki', () => {
  it('komendy z UUID z klucza (powtórka = commandExists), numer i koszt z przesyłki', async () => {
    const { provider: furgonetka, calls, tokens } = provider(happyCreation);

    const created = await furgonetka.createShipment(input);

    expect(created).toEqual({
      providerShipmentId: '555',
      trackingNumber: '620000123456',
      dropoffCode: null,
      cost: { amount: 1_353, currency: 'PLN' },
    });
    const create = calls.find(
      (call) => call.method === 'PUT' && call.path.includes('create-package'),
    );
    expect(create?.headers['content-type']).toBe('application/vnd.furgonetka.v2+json');
    expect(create?.headers['authorization']).toBe('Bearer A1');
    expect(create?.body).toMatchObject({
      service_id: 11,
      pickup: { name: 'Anna Sprzedająca', phone: '500600700', postcode: '00-001' },
      receiver: { name: 'Jan Kupujący', phone: '600700800', point: 'WAW01M' },
      parcels: [{ type: 'package', width: 38, depth: 64, height: 19, weight: 5, value: 120 }],
      user_reference_number: 'k3x9qa7m',
    });
    // Logowanie hasłem tylko raz (token z magazynu dla kolejnych żądań).
    const logins = calls.filter((call) => call.path === '/oauth/token');
    expect(logins).toHaveLength(1);
    expect(logins[0]?.headers['authorization']).toBe(
      `Basic ${Buffer.from('client:secret').toString('base64')}`,
    );
    expect(new URLSearchParams(String(logins[0]?.body)).get('grant_type')).toBe('password');
    expect(tokens.tokens?.refreshToken).toBe('R1');

    // Ponowienie z tym samym kluczem: te same UUID komend.
    await furgonetka.createShipment(input);
    const uuids = calls
      .filter((call) => call.method === 'PUT')
      .map((call) => call.path.split('/').at(-1));
    expect(new Set(uuids)).toEqual(new Set([CREATE_UUID, ORDER_UUID]));
  });

  it('odrzucenie przez przewoźnika: INVALID_REQUEST z polem Biddy i komunikatem', async () => {
    const { provider: furgonetka } = provider([
      (call) =>
        call.method === 'PUT' && call.path.startsWith('/create-package-command/')
          ? new Response(null, { status: 202 })
          : undefined,
      (call) =>
        call.method === 'GET' && call.path.startsWith('/create-package-command/')
          ? json(200, {
              status: 'error',
              errors: [{ path: '/pickup/phone', message: 'Niepoprawny numer telefonu', code: 'x' }],
            })
          : undefined,
    ]);
    const error = await furgonetka.createShipment(input).catch((caught: unknown) => caught);
    expect(isShippingProviderError(error, 'INVALID_REQUEST')).toBe(true);
    expect(error).toMatchObject({
      field: 'sender.phone',
      message: 'Przewoźnik odrzucił dane przesyłki: Niepoprawny numer telefonu',
    });
  });

  it('kurier po paczkę: UNSUPPORTED; usługa spoza Furgonetki: UNSUPPORTED', async () => {
    const { provider: furgonetka } = provider([]);
    await expect(
      furgonetka.createShipment({ ...input, dispatchMethod: 'COURIER_PICKUP' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(
      furgonetka.createShipment({ ...input, carrier: { ...locker, providerCodes: {} } }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('5xx i błąd sieci: UNAVAILABLE (ponowienie joba)', async () => {
    const { provider: furgonetka } = provider([
      (call) => (call.path.startsWith('/create-package-command/') ? json(503, {}) : undefined),
    ]);
    await expect(furgonetka.createShipment(input)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('FurgonetkaProvider: token, etykieta, tracking, punkty, webhook', () => {
  it('401 po zmianie tokenu: odświeżenie refresh tokenem i jedna powtórka', async () => {
    const tokens = new MemoryTokens();
    tokens.tokens = {
      accessToken: 'OLD',
      refreshToken: 'R0',
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    const { provider: furgonetka, calls } = provider(
      [
        (call) =>
          call.path === '/packages/555/label'
            ? call.headers['authorization'] === 'Bearer OLD'
              ? json(401, { code: 'unauthorized', message: 'Token revoked' })
              : new Response(null, { status: 204 })
            : undefined,
      ],
      tokens,
    );
    await expect(furgonetka.getLabel('555')).resolves.toBeNull();
    const refresh = calls.find((call) => call.path === '/oauth/token');
    expect(new URLSearchParams(String(refresh?.body)).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(String(refresh?.body)).get('refresh_token')).toBe('R0');
    expect(tokens.tokens.accessToken).toBe('A2');
  });

  it('etykieta PDF; anulowana albo nieznana: NOT_FOUND', async () => {
    const pdf = Buffer.from('%PDF-1.4 etykieta');
    const { provider: furgonetka } = provider([
      (call) =>
        call.path === '/packages/555/label'
          ? new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
          : undefined,
    ]);
    expect((await furgonetka.getLabel('555'))?.equals(pdf)).toBe(true);
    await expect(furgonetka.getLabel('999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tracking v2: zdarzenia wszystkich paczek z czasem warszawskim', async () => {
    const { provider: furgonetka, calls } = provider([
      (call) =>
        call.path === '/packages/555/tracking'
          ? json(200, {
              parcels: {
                '620000123456': {
                  tracking: [
                    { state: 'collected', status: 'Nadana', datetime: '2026-10-22 10:00:00' },
                    { state: 'transit', status: 'W drodze', datetime: '2026-10-22 18:00:00' },
                  ],
                },
              },
            })
          : undefined,
    ]);
    const events = await furgonetka.getTracking('555');
    expect(events).toEqual([
      {
        rawStatus: 'collected',
        status: 'DROPPED_OFF',
        occurredAt: new Date('2026-10-22T08:00:00.000Z'),
        description: 'Nadana',
      },
      {
        rawStatus: 'transit',
        status: 'IN_TRANSIT',
        occurredAt: new Date('2026-10-22T16:00:00.000Z'),
        description: 'W drodze',
      },
    ]);
    expect(calls.at(-1)?.headers['accept']).toBe('application/vnd.furgonetka.v2+json');
  });

  it('punkty: kod jako ID, adres, odległość w metrach, godziny otwarcia; nieaktywne pominięte', async () => {
    const day = { start_hour: '08:00', end_hour: '20:00' };
    const { provider: furgonetka, calls } = provider([
      (call) =>
        call.path === '/points/map'
          ? json(200, {
              points: [
                {
                  code: 'WAW01M',
                  name: 'Paczkomat WAW01M',
                  active: true,
                  address: { street: 'Prosta 1', postcode: '00-001', city: 'Warszawa' },
                  coordinates: { latitude: 52.23, longitude: 21.01 },
                  distance: 0.35,
                  opening_hours: {
                    monday: day,
                    tuesday: day,
                    wednesday: day,
                    thursday: day,
                    friday: day,
                    saturday: { start_hour: '09:00', end_hour: '15:00' },
                  },
                },
                { code: 'WAW02M', name: 'Nieczynny', active: false },
              ],
            })
          : undefined,
    ]);
    const points = await furgonetka.findPoints({
      carrier: locker,
      near: { lat: 52.23, lng: 21.01 },
      limit: 10,
    });
    expect(points).toEqual([
      {
        id: 'WAW01M',
        name: 'Paczkomat WAW01M',
        address: 'Prosta 1, 00-001 Warszawa',
        location: { lat: 52.23, lng: 21.01 },
        distanceMeters: 350,
        openingHours: 'pn–pt 08:00–20:00, sob 09:00–15:00',
      },
    ]);
    expect(calls.at(-1)?.body).toEqual({
      location: { coordinates: { latitude: 52.23, longitude: 21.01 } },
      filters: { services: ['inpost'], limit: 10 },
    });
  });

  it('webhook: poprawna suma kontrolna daje ID przesyłki, zła to INVALID_SIGNATURE', async () => {
    const { provider: furgonetka } = provider([]);
    const payload = {
      package_id: '555',
      package_no: '620000123456',
      partner_order_id: '',
      tracking: {
        state: 'delivered',
        description: 'Doręczona',
        datetime: '2026-10-22 12:00:00',
        branch: '',
      },
    };
    const control = furgonetkaChecksum(payload, CONFIG.webhookToken);
    await expect(
      furgonetka.parseWebhook({
        headers: {},
        rawBody: Buffer.from(JSON.stringify({ ...payload, control })),
      }),
    ).resolves.toEqual({ providerShipmentIds: ['555'] });
    await expect(
      furgonetka.parseWebhook({
        headers: {},
        rawBody: Buffer.from(JSON.stringify({ ...payload, control: '0'.repeat(32) })),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });
});
