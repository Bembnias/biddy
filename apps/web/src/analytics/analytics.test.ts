import { afterEach, describe, expect, it, vi } from 'vitest';

import { hasAnalyticsConsent, parseConsent, readCookie } from './consent';
import { resetAnalyticsForTests, startAnalyticsIfConsented } from './posthog';

const CONFIG = { posthogKey: 'phc_test', posthogHost: 'https://eu.i.posthog.com' };

function fakePostHog() {
  const init = vi.fn();
  const load = vi.fn(() => Promise.resolve({ default: { init } } as never));
  return { init, load };
}

afterEach(() => {
  resetAnalyticsForTests();
});

describe('zgody (ciasteczko biddy_consent)', () => {
  it('czyta wartość ciasteczka spośród innych', () => {
    expect(readCookie('a=1; biddy_consent=analytics; b=2', 'biddy_consent')).toBe('analytics');
    expect(readCookie('a=1', 'biddy_consent')).toBeUndefined();
  });

  it('kategorie po przecinku, także zakodowane w URL', () => {
    expect([...parseConsent('necessary%2Canalytics')]).toEqual(['analytics']);
    expect([...parseConsent('necessary')]).toEqual([]);
    expect([...parseConsent(undefined)]).toEqual([]);
  });

  it('zgoda na analitykę tylko przy kategorii analytics', () => {
    expect(hasAnalyticsConsent('biddy_consent=analytics')).toBe(true);
    expect(hasAnalyticsConsent('biddy_consent=necessary')).toBe(false);
    expect(hasAnalyticsConsent('')).toBe(false);
  });
});

describe('startAnalyticsIfConsented', () => {
  it('bez zgody nie ładuje PostHog (żadnego kodu ani żądań)', async () => {
    const { load, init } = fakePostHog();
    expect(await startAnalyticsIfConsented(CONFIG, '', load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it('bez klucza PostHog nie ładuje go mimo zgody', async () => {
    const { load } = fakePostHog();
    expect(
      await startAnalyticsIfConsented(
        { ...CONFIG, posthogKey: undefined },
        'biddy_consent=analytics',
        load,
      ),
    ).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('ze zgodą: ładuje i inicjalizuje PostHog w EU jeden raz', async () => {
    const { load, init } = fakePostHog();
    expect(await startAnalyticsIfConsented(CONFIG, 'biddy_consent=analytics', load)).toBe(true);
    expect(await startAnalyticsIfConsented(CONFIG, 'biddy_consent=analytics', load)).toBe(true);

    expect(load).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
    );
  });
});
