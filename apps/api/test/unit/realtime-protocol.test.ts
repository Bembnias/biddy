// API importuje z @biddy/realtime tylko typy (pakiet nie trafia do obrazu Dockera), więc stałe
// protokołu ma u siebie. Ten test pilnuje, żeby były takie same jak w pakiecie klienta.
import * as protocol from '@biddy/realtime';
import { describe, expect, it } from 'vitest';

import {
  MAX_AUCTION_SUBSCRIPTIONS,
  MAX_AUCTION_VIEWS,
  REALTIME_PATH,
  auctionRoom,
  userRoom,
} from '../../src/infra/realtime/index.js';

describe('protokół realtime: API = @biddy/realtime', () => {
  it('ścieżka, limity subskrypcji i oglądania, nazwy roomów', () => {
    expect(REALTIME_PATH).toBe(protocol.REALTIME_PATH);
    expect(MAX_AUCTION_SUBSCRIPTIONS).toBe(protocol.MAX_AUCTION_SUBSCRIPTIONS);
    expect(MAX_AUCTION_VIEWS).toBe(protocol.MAX_AUCTION_VIEWS);
    expect(auctionRoom('a')).toBe(protocol.auctionRoom('a'));
    expect(userRoom('u')).toBe(protocol.userRoom('u'));
  });
});
