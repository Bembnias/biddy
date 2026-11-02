import { defineConfig, devices } from '@playwright/test';

import { REVALIDATE_SECRET } from './e2e/mock-api';

// E2E na zbudowanej aplikacji (`pnpm build`, potem `next start`), jak na produkcji: statyczne
// strony, prawdziwe nagłówki i paczki JS. API wołane z przeglądarki podmieniają testy
// (page.route, e2e/support.ts), a renderowanie na serwerze rozmawia z atrapą API
// (e2e/mock-api.ts) pod adresem z API_INTERNAL_URL.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const API_PORT = Number(process.env.E2E_API_PORT ?? 3901);
const API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mock-api.ts',
      url: `${API_URL}/health`,
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
    },
    {
      command: `pnpm exec next start --hostname 127.0.0.1 --port ${PORT}`,
      url: BASE_URL,
      env: { API_INTERNAL_URL: API_URL, WEB_REVALIDATE_SECRET: REVALIDATE_SECRET },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
