import { createConfig } from '@biddy/config/eslint';

export default [
  // Kod wygenerowany przez orval (`pnpm api:generate`) sprawdza tsc, a nie ESLint.
  { ignores: ['src/generated/**'] },
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['scripts/**/*.ts', 'orval.config.ts'],
    rules: { 'no-console': 'off' },
  },
];
