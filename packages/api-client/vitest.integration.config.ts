import { defineConfig } from 'vitest/config';

// Klient na prawdziwym API: test uruchamia apps/api (src/main.ts) jako proces, a strona w
// happy-dom ma origin aplikacji web (http://localhost:3000), więc fetch przechodzi przez CORS
// tak jak w przeglądarce. API nie potrzebuje bazy dla GET /v1/time (pula łączy się leniwie).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.{ts,tsx}'],
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: 'http://localhost:3000/' } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
