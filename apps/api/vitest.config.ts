import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Testy jednostkowe: bez Dockera i bez bazy. SWC zamiast domyślnego transformera, bo NestJS
// potrzebuje metadanych dekoratorów (emitDecoratorMetadata).
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
  },
});
