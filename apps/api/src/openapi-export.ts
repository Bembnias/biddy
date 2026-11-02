// `pnpm --filter @biddy/api openapi:export [plik]`: zapisuje dokument OpenAPI API do pliku
// (domyślnie apps/api/openapi.json), z którego orval generuje klienta (packages/api-client,
// `pnpm api:generate`). Buduje aplikację tak jak przy starcie, ale bez nasłuchiwania i bez
// połączeń: pula bazy i Redis kolejek łączą się leniwie, a nic ich tu nie używa.
//
// Wynik nie zależy od środowiska (stała konfiguracja, wersja z package.json), więc plik w
// repozytorium zmienia się tylko razem z kontraktem API.
import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createApp } from './create-app.js';
import { loadConfig } from './infra/config/index.js';
import { createOpenApiDocument } from './infra/openapi/index.js';

/** Domyślny plik dokumentu: apps/api/openapi.json (ten sam poziom katalogów w src/ i dist/). */
export const DEFAULT_OPENAPI_FILE = fileURLToPath(new URL('../openapi.json', import.meta.url));

const output = path.resolve(process.argv[2] ?? DEFAULT_OPENAPI_FILE);

const config = loadConfig({
  NODE_ENV: 'test',
  // Adres bez serwera: aplikacja nie łączy się z bazą, dopóki nikt nie wyśle zapytania.
  DATABASE_URL: 'postgres://openapi@127.0.0.1:1/openapi',
  OPENAPI_ENABLED: 'true',
  LOG_LEVEL: 'silent',
});
const app = await createApp(config, {
  logDestination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
});
try {
  const document = createOpenApiDocument(app, config);
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`[openapi:export] Zapisano dokument OpenAPI: ${output}`);
} finally {
  await app.close();
}
