import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2023',
  platform: 'neutral',
  // socket.io-client zostaje zależnością (bundler aplikacji web i Expo wybiera jego wersję).
  external: ['socket.io-client'],
});
