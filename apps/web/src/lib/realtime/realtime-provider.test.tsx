import type { AuctionUpdatedEvent } from '@biddy/realtime';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServerClockProvider, useServerClock } from '@/components/providers/server-clock-provider';
import { AppWrapper } from '@/test/providers';
import { fakeRealtimeClient as fakeClient } from '@/test/realtime';

import {
  RealtimeProvider,
  useAuctionChannel,
  useRealtimeStatus,
  useUserRealtimeEvents,
} from './realtime-provider';

const AUCTION = '01960000-0000-7000-8000-0000000000a1';

function update(price: number): AuctionUpdatedEvent {
  return {
    auctionId: AUCTION,
    version: price,
    status: 'ACTIVE',
    currency: 'PLN',
    currentPrice: price,
    bidCount: 1,
    leader: { publicName: 'k***a' },
    endsAt: new Date().toISOString(),
    reserveStatus: 'NONE',
    minimumNextBid: price + 50,
    buyNowAvailable: false,
    serverTime: new Date().toISOString(),
  };
}

function LivePrice({ onResync }: { readonly onResync: () => void }) {
  const [price, setPrice] = useState<number | null>(null);
  const [outbid, setOutbid] = useState(false);
  const status = useRealtimeStatus();
  useAuctionChannel(AUCTION, { onUpdated: (event) => setPrice(event.currentPrice), onResync });
  useUserRealtimeEvents({ onOutbid: () => setOutbid(true) });
  return (
    <p>
      {status} {price ?? 'brak'} {outbid ? 'przebito' : ''}
    </p>
  );
}

function Clock() {
  const { offset } = useServerClock();
  return <p>offset {offset}</p>;
}

describe('RealtimeProvider', () => {
  it('bez subskrypcji nie tworzy klienta (leniwe połączenie)', () => {
    const createClient = vi.fn(() => Promise.resolve(fakeClient().client));
    render(
      <RealtimeProvider createClient={createClient}>
        <p>strona</p>
      </RealtimeProvider>,
      { wrapper: AppWrapper },
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('zdarzenia aukcji i użytkownika, status, odświeżenie po reconnect, odsubskrybowanie', async () => {
    const fake = fakeClient();
    const onResync = vi.fn();
    const { unmount } = render(
      <RealtimeProvider createClient={() => Promise.resolve(fake.client)}>
        <LivePrice onResync={onResync} />
      </RealtimeProvider>,
      { wrapper: AppWrapper },
    );
    await waitFor(() => {
      expect(fake.subscribers(AUCTION)).toBe(1);
    });
    act(() => {
      fake.status('connected');
      fake.update(update(2_500));
      fake.outbid(AUCTION);
    });
    expect(screen.getByText('connected 2500 przebito')).toBeDefined();

    act(() => {
      fake.reconnect();
    });
    expect(onResync).toHaveBeenCalledOnce();

    unmount();
    expect(fake.subscribers(AUCTION)).toBe(0);
    expect(fake.close).toHaveBeenCalled();
  });

  it('zegar z WebSocket zastępuje pomiar przez REST w ServerClockProvider', async () => {
    const fake = fakeClient();
    render(
      <RealtimeProvider createClient={() => Promise.resolve(fake.client)}>
        <ServerClockProvider>
          <LivePrice onResync={vi.fn()} />
          <Clock />
        </ServerClockProvider>
      </RealtimeProvider>,
      { wrapper: AppWrapper },
    );
    await waitFor(() => {
      expect(fake.subscribers(AUCTION)).toBe(1);
    });
    act(() => {
      fake.clock(4_200);
    });
    expect(screen.getByText('offset 4200')).toBeDefined();
  });
});
