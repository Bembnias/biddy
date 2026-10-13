// `pnpm db:reset`: usuwa i tworzy od nowa LOKALNĄ bazę, potem uruchamia migracje i seed.
// Bezpiecznik (lib/db-safety.ts) odmawia dla hostów innych niż localhost i dla NODE_ENV=production.
import { loadInfraEnv, readRawEnv } from './env.js';
import { log, runCli } from './lib/cli.js';
import { resetDatabase } from './lib/database.js';

await runCli(async () => {
  const env = loadInfraEnv();
  log.step('Reset lokalnej bazy danych');
  // Migracje i seed (turbo run --env-mode=loose) dostają zmienne procesu i .env, a DATABASE_URL
  // zbudowany z celu sprawdzonego przez bezpiecznik (lib/database.ts, workspaceTaskEnv).
  await resetDatabase(env, { ...process.env, ...readRawEnv().values });
  log.success('Baza odtworzona.');
});
