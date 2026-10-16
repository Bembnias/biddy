import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
  platform: 'neutral',
  // React i React Email zostają zależnościami (jedna kopia Reacta w procesie API).
  external: [/^react(-dom)?(\/.*)?$/u, /^@react-email\//u, '@biddy/design-tokens'],
});
