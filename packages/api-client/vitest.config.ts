import { defineConfig } from 'vitest/config';

// Hooki React testujemy w DOM z happy-dom (tak jak użyje ich web); fetch jest podmieniany.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
  },
});
