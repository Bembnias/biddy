import { defineConfig } from 'tsdown';

// React i TanStack Query są peerDependencies: nie trafiają do paczki, dostarcza je aplikacja.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
  platform: 'neutral',
});
