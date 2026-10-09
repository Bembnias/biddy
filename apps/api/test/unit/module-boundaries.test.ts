// Reguły granic modułów (PROJECT.md §10.3, eslint.config.js) sprawdzane prawdziwym ESLintem
// z konfiguracją tego pakietu. Lintujemy fragmenty kodu (lintText) jako pliki z drzewa
// testowego w katalogu tymczasowym: wynik nie zależy od aktualnej zawartości src/, a test nie
// tworzy plików w src/ (lint i typecheck mogą działać równolegle z testami).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Pliki, do których prowadzą importy z przypadków testowych (reguła potrzebuje celu na dysku). */
const FIXTURE_FILES = [
  'src/main.ts',
  'src/app.module.ts',
  'src/modules/index.ts',
  'src/modules/orders/index.ts',
  'src/modules/orders/orders.module.ts',
  'src/modules/orders/orders.service.ts',
  'src/modules/orders/db/orders.schema.ts',
  'src/modules/auctions/index.ts',
  'src/modules/auctions/auctions.module.ts',
  'src/infra/db/index.ts',
  'src/infra/db/ids.ts',
  'src/infra/db/schema.ts',
  'src/infra/config/index.ts',
];

let fixtureRoot: string;
let eslint: ESLint;

beforeAll(async () => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), 'biddy-module-boundaries-'));
  for (const file of FIXTURE_FILES) {
    const target = path.join(fixtureRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'export {};\n');
  }
  eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: path.join(API_ROOT, 'eslint.config.js'),
    overrideConfig: {
      // Bez typed lintingu (pliki nie należą do tsconfig) i z korzeniem w drzewie testowym.
      languageOptions: { parserOptions: { projectService: false, project: false, program: null } },
      settings: { 'boundaries/root-path': fixtureRoot },
    },
    ruleFilter: ({ ruleId }) => ruleId.startsWith('boundaries/'),
  });
  // Pierwsze lintowanie wczytuje konfigurację i pluginy (ok. 1–2 s): robimy je tutaj, żeby nie
  // liczyło się do limitu czasu pierwszego testu.
  await eslint.lintText('export {};\n', { filePath: path.join(fixtureRoot, 'src/main.ts') });
});

afterAll(() => {
  if (fixtureRoot) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

/**
 * Lintuje kod jako plik `file` (ścieżka jak w apps/api, np. src/modules/auctions/x.ts, w drzewie
 * testowym) i zwraca komunikaty reguł granic.
 */
async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(`${code}\n`, { filePath: path.join(fixtureRoot, file) });
  expect(result?.fatalErrorCount, 'błąd parsowania').toBe(0);
  return (result?.messages ?? []).map((message) => `${message.ruleId}: ${message.message}`);
}

describe('granice modułów: moduł → inny moduł', () => {
  const file = 'src/modules/auctions/auctions.service.ts';

  it('import wewnętrznego pliku innego modułu kończy się błędem', async () => {
    const messages = await lint(file, "import { OrdersModule } from '../orders/orders.module.js';");

    expect(messages).toEqual([
      'boundaries/dependencies: Moduł „auctions” importuje wewnętrzny plik modułu „orders” (../orders/orders.module.js). Korzystaj z publicznego API src/modules/orders/index.ts albo z eventów domenowych (PROJECT.md §10.3).',
    ]);
  });

  it('import przez publiczne API (index.ts) jest dozwolony', async () => {
    expect(await lint(file, "import { OrdersModule } from '../orders/index.js';")).toEqual([]);
  });

  it('import samych typów, re-eksport i import dynamiczny też są sprawdzane', async () => {
    const snippets = [
      "import type { OrdersService } from '../orders/orders.service.js';",
      "export { OrdersService } from '../orders/orders.service.js';",
      "export * from '../orders/orders.service.js';",
      "export const load = () => import('../orders/orders.service.js');",
    ];
    for (const snippet of snippets) {
      expect(await lint(file, snippet), snippet).toHaveLength(1);
    }
  });

  it('tabele innego modułu też są wewnętrzne', async () => {
    expect(
      await lint(file, "import { orders } from '../orders/db/orders.schema.js';"),
    ).toHaveLength(1);
  });

  it('importy wewnątrz modułu i z infra są dozwolone', async () => {
    const code = [
      "import { AuctionsModule } from './auctions.module.js';",
      "import { DbModule } from '../../infra/db/index.js';",
    ].join('\n');

    expect(await lint(file, code)).toEqual([]);
  });
});

describe('granice modułów: moduł → aplikacja i rejestr', () => {
  const file = 'src/modules/auctions/auctions.module.ts';

  it.each([
    ['../../app.module.js', 'plik aplikacji'],
    ['../../main.js', 'entrypoint'],
    ['../index.js', 'rejestr modułów'],
  ])('import %s (%s) kończy się błędem', async (specifier) => {
    const messages = await lint(file, `import { x } from '${specifier}';`);

    expect(messages).toEqual([
      `boundaries/dependencies: Moduł „auctions” nie może importować plików aplikacji ani rejestru modułów (${specifier}). Moduły nie zależą od warstwy, która je składa.`,
    ]);
  });
});

describe('granice modułów: infra', () => {
  it.each([
    '../../modules/orders/index.js',
    '../../modules/orders/orders.module.js',
    '../../modules/index.js',
    '../../app.module.js',
  ])('infra nie importuje modułów ani aplikacji: %s', async (specifier) => {
    const messages = await lint('src/infra/db/database.ts', `import { x } from '${specifier}';`);

    expect(messages).toEqual([
      `boundaries/dependencies: Infrastruktura („db”) nie może importować modułów domenowych ani plików aplikacji (${specifier}). Zależność idzie odwrotnie: moduły korzystają z infra.`,
    ]);
  });

  it('infra może importować inne katalogi infra', async () => {
    const code = "import { envSchema } from '../config/index.js';";

    expect(await lint('src/infra/db/database.ts', code)).toEqual([]);
  });

  it('agregat schematu Drizzle może re-eksportować tabele modułów, i nic więcej', async () => {
    const file = 'src/infra/db/schema.ts';

    expect(await lint(file, "export * from '../../modules/orders/db/orders.schema.js';")).toEqual(
      [],
    );
    expect(
      await lint(file, "export * from '../../modules/orders/orders.service.js';"),
    ).toHaveLength(1);
    // Wyjątek dotyczy tylko agregatu, nie innych plików infra.
    expect(
      await lint(
        'src/infra/db/database.ts',
        "import * as t from '../../modules/orders/db/orders.schema.js';",
      ),
    ).toHaveLength(1);
  });
});

describe('granice modułów: rejestr i aplikacja → moduły', () => {
  it('rejestr i pliki aplikacji importują moduły tylko przez index.ts', async () => {
    expect(await lint('src/modules/index.ts', "import { x } from './orders/index.js';")).toEqual(
      [],
    );
    expect(await lint('src/app.module.ts', "import { x } from './modules/index.js';")).toEqual([]);

    expect(
      await lint('src/modules/index.ts', "import { x } from './orders/orders.module.js';"),
    ).toEqual([
      'boundaries/dependencies: Spoza modułu „orders” importuj wyłącznie jego publiczne API src/modules/orders/index.ts (./orders/orders.module.js).',
    ]);
    expect(
      await lint('src/app.module.ts', "import { x } from './modules/orders/orders.service.js';"),
    ).toHaveLength(1);
  });
});

describe('granice modułów: pliki spoza modułów, infra i aplikacji', () => {
  // Plik w dowolnym innym katalogu (np. src/common) nie może „przemycić” wewnętrznych plików
  // modułu: reguła obejmuje każdy plik źródłowy, a nie tylko znane kategorie.
  it.each([
    ['src/common/leak.ts', '../modules/orders/orders.service.js'],
    ['src/common/nested/leak.ts', '../../modules/orders/db/orders.schema.js'],
    ['src/modules/leak.ts', './orders/orders.service.js'],
    ['src/infra/leak.ts', '../modules/orders/orders.service.js'],
  ])('%s → %s kończy się błędem', async (file, specifier) => {
    const messages = await lint(file, `export * from '${specifier}';`);

    expect(messages).toEqual([
      `boundaries/dependencies: Spoza modułu „orders” importuj wyłącznie jego publiczne API src/modules/orders/index.ts (${specifier}).`,
    ]);
  });

  it('publiczne API modułu (index.ts) jest dostępne także z innych katalogów', async () => {
    expect(
      await lint('src/common/helper.ts', "import { x } from '../modules/orders/index.js';"),
    ).toEqual([]);
  });

  it('pliki .mts i .cts też są sprawdzane', async () => {
    for (const file of ['src/modules/auctions/x.mts', 'src/modules/auctions/x.cts']) {
      const messages = await lint(file, "import { x } from '../orders/orders.service.js';");
      expect(messages, file).toHaveLength(1);
    }
  });
});

describe('granice modułów: agregat schematu Drizzle', () => {
  it('moduł nie importuje agregatu (tabel wszystkich modułów)', async () => {
    const messages = await lint(
      'src/modules/auctions/auctions.service.ts',
      "import * as tables from '../../infra/db/schema.js';",
    );

    expect(messages).toEqual([
      'boundaries/dependencies: Moduł „auctions” nie może importować agregatu schematu src/infra/db/schema.ts (tabele wszystkich modułów, ../../infra/db/schema.js). Własne tabele importuj z ./db/*.schema.ts, a dane innych modułów pobieraj przez ich publiczne API (PROJECT.md §10.3).',
    ]);
  });

  it('pozostałe pliki infra/db (np. ids.ts, index.ts) są dla modułów dostępne', async () => {
    const code = [
      "import { idColumn } from '../../../infra/db/ids.js';",
      "import { DRIZZLE } from '../../../infra/db/index.js';",
    ].join('\n');

    expect(await lint('src/modules/auctions/db/auctions.schema.ts', code)).toEqual([]);
  });
});

describe('granice modułów: testy', () => {
  it('pliki testów mogą importować wewnętrzne pliki innych modułów', async () => {
    const code = "import { OrdersService } from '../orders/orders.service.js';";

    expect(await lint('src/modules/auctions/auctions.service.test.ts', code)).toEqual([]);
  });
});
