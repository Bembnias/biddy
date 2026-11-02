import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberSocialLogin, takeSocialLogin } from './auth-events';
import { hasAnalyticsConsent, parseConsent, readCookie } from './consent';
import { identifyUser, resetAnalyticsForTests, startAnalyticsIfConsented, track } from './posthog';

const CONFIG = { posthogKey: 'phc_test', posthogHost: 'https://eu.i.posthog.com' };

function fakePostHog() {
  const posthog = { init: vi.fn(), capture: vi.fn(), identify: vi.fn(), reset: vi.fn() };
  const load = vi.fn(() => Promise.resolve({ default: posthog } as never));
  return { ...posthog, load };
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

describe('zdarzenia i identyfikacja', () => {
  it('bez zgody track i identifyUser nic nie wysyłają', async () => {
    const { load, capture, identify } = fakePostHog();
    await startAnalyticsIfConsented(CONFIG, '', load);
    track('login_completed', { method: 'email' });
    identifyUser('u1');
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
  });

  it('zdarzenie i identify z czasu ładowania PostHog nie giną', async () => {
    const { load, capture, identify } = fakePostHog();
    identifyUser('u1');
    const started = startAnalyticsIfConsented(CONFIG, 'biddy_consent=analytics', load);
    track('login_completed', { method: 'google' });
    await started;
    await Promise.resolve();

    expect(identify).toHaveBeenCalledWith('u1');
    expect(capture).toHaveBeenCalledWith('login_completed', { method: 'google' });
  });

  it('wylogowanie resetuje osobę w PostHog, ten sam użytkownik nie jest identyfikowany ponownie', async () => {
    const { load, identify, reset } = fakePostHog();
    await startAnalyticsIfConsented(CONFIG, 'biddy_consent=analytics', load);
    identifyUser('u1');
    identifyUser('u1');
    identifyUser(undefined);
    await Promise.resolve();

    expect(identify).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('logowanie Google/Apple: metoda po powrocie od dostawcy', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('działa raz i tylko przez 15 minut', () => {
    rememberSocialLogin('google', 1_000);
    expect(takeSocialLogin(2_000)).toBe('google');
    expect(takeSocialLogin(3_000)).toBeUndefined();

    rememberSocialLogin('apple', 0);
    expect(takeSocialLogin(15 * 60 * 1000)).toBeUndefined();
  });

  it('ignoruje uszkodzony znacznik', () => {
    sessionStorage.setItem('biddy_social_login', '{nie json');
    expect(takeSocialLogin()).toBeUndefined();
  });
});
