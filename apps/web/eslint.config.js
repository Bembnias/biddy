import { createConfig } from '@biddy/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  },
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Dostępność JSX (WCAG 2.1 AA, PROJECT.md §17); dynamiczne sprawdzenia robi axe-core w e2e.
      ...jsxA11y.flatConfigs.strict.rules,
    },
  },
  {
    files: ['scripts/**/*.ts', 'e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
