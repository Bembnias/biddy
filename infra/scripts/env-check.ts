// `pnpm env:check`: waliduje zmienne z .env (szablon: .env.example) i wypisuje wszystkie błędy naraz.
import { INFRA_ENV_KEYS, loadInfraEnv, readRawEnv } from './env.js';
import { log, runCli } from './lib/cli.js';

await runCli(() => {
  const { envFile, envFileFound } = readRawEnv();
  const env = loadInfraEnv();
  if (!envFileFound) {
    log.note(`Nie ma pliku ${envFile}; zmienne pochodzą wyłącznie ze środowiska procesu.`);
  }
  log.success(
    `Konfiguracja środowiska jest poprawna (${INFRA_ENV_KEYS.length} zmiennych, NODE_ENV=${env.NODE_ENV}).`,
  );
});
