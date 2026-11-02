// Konfiguracja Next.js (apps/web). Zmienne środowiskowe czytamy z .env w katalogu głównym
// repozytorium (jak API); zmienne ustawione w powłoce lub na platformie mają pierwszeństwo.
import { existsSync } from 'node:fs';
import path from 'node:path';

import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { parsePublicEnv, publicEnvInput } from './src/env';

// Next.js kompiluje ten plik do CommonJS (bez import.meta), a uruchamiamy go w apps/web.
const rootEnvFile = path.resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

// Walidacja przy buildzie i starcie: błędna zmienna przerywa `next build` z listą problemów.
// Kod aplikacji dostaje gotowy wynik (src/config.ts), więc Zod nie trafia do paczki przeglądarki.
const publicConfig = parsePublicEnv(publicEnvInput());

/** Nagłówki bezpieczeństwa każdej odpowiedzi (CSP z nonce: F-42). */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  // Obraz Docker (apps/web/Dockerfile ustawia NEXT_OUTPUT=standalone): samodzielny serwer
  // z minimalnym node_modules. Śledzenie plików od korzenia monorepo (pakiety workspace).
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') }
    : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  env: { BIDDY_PUBLIC_CONFIG: JSON.stringify(publicConfig) },
  // Pakiety workspace są budowane do dist (ESM), więc nie wymagają transpilacji.
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]);
  },
  // Dawny adres Moich aukcji (F-14): od F-21 w Moje Biddy. Parametry adresu Next przenosi sam.
  redirects() {
    return Promise.resolve([
      { source: '/konto/aukcje', destination: '/moje-biddy/aukcje', permanent: true },
    ]);
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withSentryConfig(withNextIntl(nextConfig), {
  // Upload source map do Sentry tylko w CI z tokenem (F-09); lokalnie bez wysyłki.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Source mapy pod tym samym release co zdarzenia z przeglądarki (SHA commita na Vercel).
  ...(publicConfig.release === undefined ? {} : { release: { name: publicConfig.release } }),
  silent: !process.env.CI,
  telemetry: false,
});
