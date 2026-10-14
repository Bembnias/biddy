// Hooki pnpm (https://pnpm.io/pnpmfile). Zmieniają manifesty zależności przed rozwiązaniem
// wersji; po zmianie tego pliku uruchom `pnpm install` (lockfile zapisuje jego sumę kontrolną).

/**
 * better-auth deklaruje opcjonalne peery dla wszystkich obsługiwanych frameworków. pnpm
 * rozwiązuje je z innych pakietów workspace (np. `next` z apps/web), przez co obraz API
 * (apps/api/Dockerfile) dostawał Next.js, React i Vitest (ok. 400 MB). API używa tylko
 * integracji Node i adaptera Drizzle, więc te peery pomijamy.
 */
const UNUSED_BETTER_AUTH_PEERS = [
  '@lynx-js/react',
  '@prisma/client',
  '@sveltejs/kit',
  '@tanstack/react-start',
  '@tanstack/solid-start',
  'drizzle-kit',
  'mongodb',
  'mysql2',
  'next',
  'prisma',
  'react',
  'react-dom',
  'solid-js',
  'svelte',
  'vitest',
  'vue',
];

function readPackage(pkg) {
  if (pkg.name === 'better-auth') {
    for (const name of UNUSED_BETTER_AUTH_PEERS) {
      delete pkg.peerDependencies?.[name];
      delete pkg.peerDependenciesMeta?.[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
