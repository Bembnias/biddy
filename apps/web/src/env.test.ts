import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  WebConfigError,
  parsePublicEnv,
  platformDefaults,
  publicEnvInput,
  serverApiUrl,
} from './env';

describe('parsePublicEnv', () => {
  it('lokalnie: wartości domyślne (API na 3001, strona na 3000, PostHog EU, bez Sentry)', () => {
    expect(parsePublicEnv({})).toEqual({
      environment: 'local',
      apiUrl: 'http://localhost:3001',
      siteUrl: 'http://localhost:3000',
      sentryDsn: undefined,
      posthogKey: undefined,
      posthogHost: 'https://eu.i.posthog.com',
      release: undefined,
    });
  });

  it('pusta wartość to brak zmiennej, ukośnik na końcu adresu jest usuwany', () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_API_URL: 'https://api.biddy.pl/',
        NEXT_PUBLIC_SENTRY_DSN: '',
        NEXT_PUBLIC_POSTHOG_KEY: '  ',
      }),
    ).toMatchObject({
      apiUrl: 'https://api.biddy.pl',
      sentryDsn: undefined,
      posthogKey: undefined,
    });
  });

  it('poza środowiskiem lokalnym adresy API i strony są wymagane', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_ENVIRONMENT: 'production' })).toThrow(WebConfigError);
    try {
      parsePublicEnv({ NEXT_PUBLIC_ENVIRONMENT: 'staging' });
    } catch (error) {
      expect((error as Error).message).toContain('• NEXT_PUBLIC_API_URL: wymagana');
      expect((error as Error).message).toContain('• NEXT_PUBLIC_SITE_URL: wymagana');
    }
  });

  it('produkcja z adresami przechodzi', () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_ENVIRONMENT: 'production',
        NEXT_PUBLIC_API_URL: 'https://api.biddy.pl',
        NEXT_PUBLIC_SITE_URL: 'https://biddy.pl',
        NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2',
      }),
    ).toMatchObject({
      environment: 'production',
      sentryDsn: 'https://abc@o1.ingest.de.sentry.io/2',
    });
  });

  it.each([
    ['nieznane środowisko', { NEXT_PUBLIC_ENVIRONMENT: 'prod' }, 'NEXT_PUBLIC_ENVIRONMENT'],
    ['adres bez protokołu http', { NEXT_PUBLIC_API_URL: 'api.biddy.pl' }, 'NEXT_PUBLIC_API_URL'],
    ['DSN, który nie jest adresem', { NEXT_PUBLIC_SENTRY_DSN: 'abc' }, 'NEXT_PUBLIC_SENTRY_DSN'],
  ])('odrzuca: %s', (_label, input, variable) => {
    expect(() => parsePublicEnv(input)).toThrow(`• ${variable}:`);
  });
});

describe('serverApiUrl (API_INTERNAL_URL)', () => {
  it('bez zmiennej: adres publiczny', () => {
    expect(serverApiUrl('https://api.biddy.pl', undefined)).toBe('https://api.biddy.pl');
    expect(serverApiUrl('https://api.biddy.pl', ' ')).toBe('https://api.biddy.pl');
  });

  it('ze zmienną: adres wewnętrzny bez końcowego ukośnika', () => {
    expect(serverApiUrl('https://api.biddy.pl', 'http://api.internal:3001/')).toBe(
      'http://api.internal:3001',
    );
  });

  it('odrzuca adres bez protokołu http', () => {
    expect(() => serverApiUrl('https://api.biddy.pl', 'api.internal')).toThrow(
      '• API_INTERNAL_URL:',
    );
  });
});

describe('platformDefaults (Vercel)', () => {
  const preview = {
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'biddy-web-abc123-biddy.vercel.app',
    VERCEL_GIT_COMMIT_SHA: 'f00dcafe',
  };

  it('preview: środowisko preview, adres deploymentu i SHA commita jako release', () => {
    expect(platformDefaults(preview)).toEqual({
      NEXT_PUBLIC_ENVIRONMENT: 'preview',
      NEXT_PUBLIC_SITE_URL: 'https://biddy-web-abc123-biddy.vercel.app',
      NEXT_PUBLIC_APP_RELEASE: 'f00dcafe',
    });
  });

  it('produkcja Vercel i lokalnie: środowisko i adres tylko ze zmiennych NEXT_PUBLIC_*', () => {
    expect(platformDefaults({ ...preview, VERCEL_ENV: 'production' })).toEqual({
      NEXT_PUBLIC_ENVIRONMENT: undefined,
      NEXT_PUBLIC_SITE_URL: undefined,
      NEXT_PUBLIC_APP_RELEASE: 'f00dcafe',
    });
    expect(Object.values(platformDefaults({})).every((value) => value === undefined)).toBe(true);
  });

  it('jawne NEXT_PUBLIC_* wygrywają, puste wartości nie', () => {
    const defaults = platformDefaults(preview);
    vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', '');
    vi.stubEnv('NEXT_PUBLIC_APP_RELEASE', 'web@1.0.0');
    try {
      expect(publicEnvInput(defaults)).toMatchObject({
        NEXT_PUBLIC_ENVIRONMENT: 'preview',
        NEXT_PUBLIC_APP_RELEASE: 'web@1.0.0',
      });
      expect(
        parsePublicEnv({
          ...publicEnvInput(defaults),
          NEXT_PUBLIC_API_URL: 'https://api.staging.biddy.pl',
        }),
      ).toMatchObject({
        environment: 'preview',
        siteUrl: 'https://biddy-web-abc123-biddy.vercel.app',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('.env.example (sekcja Web)', () => {
  const example = readFileSync(path.resolve(import.meta.dirname, '../../../.env.example'), 'utf8');

  /** Zakomentowane linie `# NEXT_PUBLIC_X=wartość` (opcjonalne zmienne web). */
  function documented(): Record<string, string> {
    return Object.fromEntries(
      [...example.matchAll(/^# (NEXT_PUBLIC_[A-Z_]+)=(.*)$/gm)].map(([, key = '', value = '']) => [
        key,
        value,
      ]),
    );
  }

  it('opisuje każdą zmienną publiczną aplikacji', () => {
    expect(Object.keys(documented()).sort()).toEqual(
      Object.keys(publicEnvInput())
        .filter((key) => key !== 'NEXT_PUBLIC_APP_RELEASE')
        .sort(),
    );
  });

  it('wartościami równymi domyślnym (odkomentowanie niczego nie zmienia)', () => {
    expect(parsePublicEnv(documented())).toEqual(parsePublicEnv({}));
  });
});
