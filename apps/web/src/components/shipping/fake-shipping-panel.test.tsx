import type { FakeShippingOverviewDto, ShipmentDto } from '@biddy/api-client';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { apiCalls, mockApi } from '@/test/api';
import { AppWrapper } from '@/test/providers';

import { FakeShippingPanel } from './fake-shipping-panel';

const CREATED = '2026-10-22T10:00:00.000Z';
const TEST_ID = '01960000-0000-7000-8000-0000000000a1';
const ORDER_SHIPMENT_ID = '01960000-0000-7000-8000-0000000000a2';

function shipment(overrides: Partial<ShipmentDto> = {}): ShipmentDto {
  return {
    id: TEST_ID,
    direction: 'OUTBOUND',
    status: 'PENDING',
    carrier: { id: 'inpost-paczkomat', name: 'InPost Paczkomat 24/7', kind: 'LOCKER' },
    packageSize: 'M',
    pickupPoint: {
      id: 'inpost-paczkomat-01',
      name: 'Paczkomat testowy 01',
      address: 'ul. Testowa 1, 00-001 Warszawa',
    },
    recipient: { name: 'Testerka Dostaw', city: null },
    sender: null,
    dispatchMethod: null,
    dispatchMethods: ['DROP_OFF', 'COURIER_PICKUP'],
    currency: 'PLN',
    price: 1_399,
    trackingNumber: null,
    dropoffCode: null,
    labelAvailable: false,
    lastError: null,
    events: [],
    requestedAt: null,
    deliveredAt: null,
    createdAt: CREATED,
    ...overrides,
  };
}

const overview: FakeShippingOverviewDto = {
  shipments: [
    { shipment: shipment(), orderId: null, parcel: null },
    {
      shipment: shipment({
        id: ORDER_SHIPMENT_ID,
        status: 'IN_TRANSIT',
        trackingNumber: 'FS123456789012',
        dropoffCode: '482913',
        labelAvailable: true,
      }),
      orderId: '01960000-0000-7000-8000-0000000000b1',
      parcel: {
        id: 'fsp_1',
        status: 'in_transit',
        scenario: 'DELIVERED',
        tracking: [
          { status: 'in_transit', description: 'Przesyłka w drodze', occurredAt: CREATED },
        ],
        webhooks: [
          { id: 'fsw_1', attempts: 2, lastError: null, deliveredAt: CREATED, createdAt: CREATED },
        ],
      },
    },
  ],
};

describe('FakeShippingPanel (F-24)', () => {
  it('lista przesyłek ze stanem w Biddy i u dostawcy; akcje wołają API', async () => {
    const fetchMock = mockApi({
      '/v1/dev/fake-shipping': overview,
      '/v1/shipping/carriers': [
        {
          id: 'inpost-paczkomat',
          name: 'InPost Paczkomat 24/7',
          kind: 'LOCKER',
          packageSizes: ['S', 'M', 'L'],
        },
      ],
      '/v1/shipping/points': [
        {
          id: 'inpost-paczkomat-01',
          name: 'Paczkomat testowy 01',
          address: 'ul. Testowa 1',
          location: null,
          distanceMeters: null,
          openingHours: '24/7',
        },
      ],
      '/v1/me/addresses': [],
      '/v1/dev/fake-shipping/parcels/fsp_1/advance': { ...overview.shipments[1]?.parcel },
      [`/v1/dev/fake-shipping/shipments/${ORDER_SHIPMENT_ID}/sync`]:
        overview.shipments[1]?.shipment,
    });
    render(<FakeShippingPanel />, { wrapper: AppWrapper });

    const list = await screen.findByRole('region', { name: 'Przesyłki (2)' });
    expect(within(list).getByText('W drodze')).toBeDefined();
    expect(within(list).getByText('Czeka na nadanie')).toBeDefined();
    expect(within(list).getByText('testowa')).toBeDefined();
    expect(within(list).getByText(/U dostawcy: in_transit · Doręczona/)).toBeDefined();
    expect(within(list).getByText(/dostarczony \(2 próby\)/)).toBeDefined();

    await userEvent.click(within(list).getByRole('button', { name: 'Następny status' }));
    expect(await screen.findByText('Gotowe: Następny status.')).toBeDefined();
    expect(apiCalls(fetchMock, '/v1/dev/fake-shipping/parcels/fsp_1/advance')).toHaveLength(1);

    await userEvent.click(within(list).getByRole('button', { name: 'Synchronizuj' }));
    expect(
      apiCalls(fetchMock, `/v1/dev/fake-shipping/shipments/${ORDER_SHIPMENT_ID}/sync`),
    ).toHaveLength(1);

    await userEvent.click(within(list).getByRole('button', { name: 'Nadaj' }));
    expect(await screen.findByRole('heading', { name: 'Nadaj przesyłkę testową' })).toBeDefined();
    expect(screen.getByRole('radio', { name: /Kurier odbierze paczkę/ })).toBeDefined();
  });
});
