import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Testy jednostkowe i komponentów (happy-dom). Strony i nawigację sprawdza Playwright (e2e/).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
