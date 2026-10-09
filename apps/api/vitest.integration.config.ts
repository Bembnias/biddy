import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Testy integracyjne: prawdziwy Postgres 17 w kontenerze (Testcontainers), wspólny dla całego
// przebiegu (test/integration/global-setup.ts). Wymagają Dockera. SWC, bo NestJS potrzebuje
// metadanych dekoratorów (emitDecoratorMetadata).
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Zatrzymanie kontenera w teardownie globalSetup.
    teardownTimeout: 60_000,
  },
});
