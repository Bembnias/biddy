import { fileURLToPath } from 'node:url';

import { createConfig } from '@biddy/config/eslint';
import boundaries from 'eslint-plugin-boundaries';

/**
 * Granice modułów (PROJECT.md §10.3): moduły komunikują się przez publiczne API modułu
 * (src/modules/<moduł>/index.ts) albo eventy domenowe, nigdy przez wewnętrzne pliki ani tabele
 * innego modułu.
 *
 * Klasyfikacja (eslint-plugin-boundaries 7: elementy to katalogi, pojedyncze pliki opisują
 * kategorie plików):
 * - element `module`: src/modules/<moduł>/** (nazwa w `captured.name`),
 * - element `infra`: src/infra/<nazwa>/** (db, config, …),
 * - plik `app`: src/*.ts (main.ts, app.module.ts, create-app.ts, instrument.ts),
 * - plik `registry`: src/modules/index.ts (DOMAIN_MODULES),
 * - plik `tables`: src/modules/<moduł>/db/*.schema.ts (tabele Drizzle modułu),
 * - plik `schema-registry`: src/infra/db/schema.ts (agregat schematu Drizzle),
 * - plik `source`: każdy plik źródłowy w src/. Bez tej kategorii plik spoza znanych miejsc
 *   (np. src/common/x.ts albo src/modules/x.ts) byłby dla reguły nieznany i mógłby bez błędu
 *   re-eksportować wewnętrzne pliki modułu.
 *
 * Importy wewnątrz jednego modułu (albo jednego katalogu infra) nie są sprawdzane. Testy
 * (*.test.ts, katalog test/) mogą importować wszystko.
 */
const SOURCE_FILES = 'src/**/*.{ts,mts,cts}';

export const moduleBoundaries = {
  files: [SOURCE_FILES],
  plugins: { boundaries },
  settings: {
    'boundaries/root-path': import.meta.dirname,
    // Specyfikatory `.js` wskazują pliki `.ts`; własny resolver rozwiązuje importy względne,
    // `node` pakiety (zależności zewnętrzne reguła i tak pomija).
    'import/resolver': {
      [fileURLToPath(new URL('./eslint.resolver.js', import.meta.url))]: {},
      node: {},
    },
    'boundaries/dependency-nodes': ['import', 'export', 'dynamic-import'],
    'boundaries/legacy-templates': false,
    'boundaries/elements': [
      { type: 'module', pattern: 'src/modules/*', capture: ['name'], partialMatch: false },
      { type: 'infra', pattern: 'src/infra/*', capture: ['name'], partialMatch: false },
    ],
    'boundaries/files': [
      { category: 'app', pattern: 'src/*.ts' },
      { category: 'registry', pattern: 'src/modules/index.ts' },
      { category: 'tables', pattern: 'src/modules/*/db/*.schema.ts' },
      { category: 'schema-registry', pattern: 'src/infra/db/schema.ts' },
      { category: 'source', pattern: SOURCE_FILES },
    ],
    'boundaries/ignore': ['**/*.test.{ts,mts,cts}'],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'allow',
        // Przy kilku pasujących politykach wygrywa ostatnia: najpierw zasada ogólna, potem
        // bardziej szczegółowe komunikaty i wyjątki.
        policies: [
          {
            // Z dowolnego pliku źródłowego (także spoza modułów, infra i aplikacji) do modułu
            // prowadzi tylko jego index.ts. Importy wewnątrz modułu reguła pomija.
            from: { file: { categories: 'source' } },
            disallow: { to: { element: { type: 'module', fileInternalPath: '!index.ts' } } },
            message:
              'Spoza modułu „{{to.element.captured.name}}” importuj wyłącznie jego publiczne API src/modules/{{to.element.captured.name}}/index.ts ({{dependency.source}}).',
          },
          {
            from: { element: { type: 'module' } },
            disallow: { to: { element: { type: 'module', fileInternalPath: '!index.ts' } } },
            message:
              'Moduł „{{from.element.captured.name}}” importuje wewnętrzny plik modułu „{{to.element.captured.name}}” ({{dependency.source}}). Korzystaj z publicznego API src/modules/{{to.element.captured.name}}/index.ts albo z eventów domenowych (PROJECT.md §10.3).',
          },
          {
            from: { element: { type: 'module' } },
            disallow: { to: { file: { categories: ['app', 'registry'] } } },
            message:
              'Moduł „{{from.element.captured.name}}” nie może importować plików aplikacji ani rejestru modułów ({{dependency.source}}). Moduły nie zależą od warstwy, która je składa.',
          },
          {
            from: { file: { categories: ['app', 'registry'] } },
            disallow: { to: { element: { type: 'module', fileInternalPath: '!index.ts' } } },
            message:
              'Spoza modułu „{{to.element.captured.name}}” importuj wyłącznie jego publiczne API src/modules/{{to.element.captured.name}}/index.ts ({{dependency.source}}).',
          },
          {
            // Agregat re-eksportuje tabele wszystkich modułów: import z modułu omijałby zasadę
            // „żadnego dostępu do cudzych tabel”.
            from: { element: { type: 'module' } },
            disallow: { to: { file: { categories: 'schema-registry' } } },
            message:
              'Moduł „{{from.element.captured.name}}” nie może importować agregatu schematu src/infra/db/schema.ts (tabele wszystkich modułów, {{dependency.source}}). Własne tabele importuj z ./db/*.schema.ts, a dane innych modułów pobieraj przez ich publiczne API (PROJECT.md §10.3).',
          },
          {
            from: { element: { type: 'infra' } },
            disallow: {
              to: [{ element: { type: 'module' } }, { file: { categories: ['app', 'registry'] } }],
            },
            message:
              'Infrastruktura („{{from.element.captured.name}}”) nie może importować modułów domenowych ani plików aplikacji ({{dependency.source}}). Zależność idzie odwrotnie: moduły korzystają z infra.',
          },
          {
            // Wyjątek: agregat schematu Drizzle zbiera tabele modułów (tylko pliki *.schema.ts).
            from: { file: { categories: 'schema-registry' } },
            allow: { to: { element: { type: 'module' }, file: { categories: 'tables' } } },
          },
        ],
      },
    ],
  },
};

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname, node: true }),
  {
    languageOptions: {
      parserOptions: {
        // Importy klas używanych w konstruktorach (DI NestJS) muszą zostać importami wartości,
        // inaczej SWC usunie je i zabraknie metadanych `design:paramtypes`.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
  },
  moduleBoundaries,
];
