import { describe, expect, it } from 'vitest';

import { pointMapFor } from './point-map.js';

const locker = { kind: 'LOCKER' as const, providerCodes: { furgonetka: 'inpost' } };

describe('pointMapFor', () => {
  it('Furgonetka jako dostawca punktów: usługa i środowisko z adresu API', () => {
    expect(pointMapFor(locker, 'furgonetka', 'https://api.sandbox.furgonetka.pl')).toEqual({
      provider: 'furgonetka',
      service: 'inpost',
      env: 'sandbox',
    });
    expect(pointMapFor(locker, 'furgonetka', 'https://api.furgonetka.pl')?.env).toBe('production');
  });

  it('bez mapy: kurier, FakeShipping, brak konfiguracji Furgonetki albo kodu usługi', () => {
    const url = 'https://api.furgonetka.pl';
    expect(pointMapFor({ ...locker, kind: 'COURIER' }, 'furgonetka', url)).toBeNull();
    expect(pointMapFor(locker, 'fake', url)).toBeNull();
    expect(pointMapFor(locker, 'furgonetka', undefined)).toBeNull();
    expect(pointMapFor({ ...locker, providerCodes: {} }, 'furgonetka', url)).toBeNull();
  });
});
