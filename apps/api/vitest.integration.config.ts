import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Testy integracyjne: prawdziwy Postgres w kontenerze (Testcontainers). Wymagają Dockera.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
