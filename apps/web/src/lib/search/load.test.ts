import { describe, expect, it } from 'vitest';

import { mockApi } from '@/test/api';

import { ENDING_SOON_MS, countEndingSoon } from './load';
import { parseSearchState } from './search-params';

const CATEGORY_ID = '01a13b7a-4df1-7353-8d2b-c8d11c968e9f';

describe('countEndingSoon (pasek „kończy się w ciągu godziny”, F-63)', () => {
  it('te same filtry, koniec przed pełną minutą + 1 h, jedna pozycja, bez sortowania i strony', async () => {
    const fetchMock = mockApi({
      '/v1/auctions': { items: [], total: 6, totalPages: 6, page: 1, pageSize: 1, sort: 'ending' },
    });
    const state = parseSearchState({ q: 'nike', stan: 'NEW', sort: 'cena_rosnaco', strona: '3' });
    const now = Date.parse('2026-10-26T12:34:56.789Z');

    expect(await countEndingSoon(state, CATEGORY_ID, now)).toBe(6);
    const [input] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(input instanceof Request ? input.url : (input?.toString() ?? ''));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'nike',
      category: CATEGORY_ID,
      condition: 'NEW',
      endsBefore: new Date(Date.parse('2026-10-26T12:34:00.000Z') + ENDING_SOON_MS).toISOString(),
      page: '1',
      pageSize: '1',
    });
  });

  it('wyszukiwarka nie odpowiada: 0 (paska nie ma)', async () => {
    mockApi({ '/v1/auctions': new Response(null, { status: 503 }) });
    expect(await countEndingSoon(parseSearchState({}), undefined)).toBe(0);
  });
});
