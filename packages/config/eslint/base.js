// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Bazowa konfiguracja ESLint (flat config) dla pakietów TypeScript.
 * Reguły z informacją o typach (typed linting) korzystają z tsconfig.json pakietu.
 *
 * @param {{ tsconfigRootDir: string, node?: boolean }} options
 */
export function createConfig({ tsconfigRootDir, node = false }) {
  return defineConfig(
    {
      ignores: ['dist/**', 'coverage/**', '.turbo/**', '.next/**'],
    },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
        globals: node ? { ...globals.node } : {},
      },
      rules: {
        eqeqeq: ['error', 'always'],
        'no-console': node ? 'off' : 'warn',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  );
}
