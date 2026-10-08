// `pnpm bootstrap`: jednorazowe przygotowanie środowiska dla nowej osoby w zespole.
// (Nie `setup`: `pnpm setup` to wbudowana komenda pnpm, która zmienia konfigurację powłoki.)
//
// Kroki: .env z szablonu → walidacja zmiennych → Docker i usługi → kubełki S3 → baza
// (reset, migracje, seed) → podsumowanie z adresami usług. Ponowne uruchomienie jest
// bezpieczne, ale czyści lokalną bazę (jak `pnpm db:reset`).
import { constants, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { loadInfraEnv, readRawEnv } from './env.js';
import { log, runCli } from './lib/cli.js';
import { assertResetAllowed, resetDatabase } from './lib/database.js';
import { composeUp, ensureDocker } from './lib/docker.js';
import { ENV_EXAMPLE_FILE, ENV_FILE, NVMRC_FILE } from './lib/paths.js';
import { describeServices } from './lib/services.js';
import { assertStorageAllowed, setupStorage } from './lib/storage.js';

function checkNodeVersion(): void {
  const expected = readFileSync(NVMRC_FILE, 'utf8').trim().replace(/^v/, '');
  const expectedMajor = expected.split('.')[0];
  const actualMajor = process.versions.node.split('.')[0];
  if (expectedMajor !== actualMajor) {
    log.warn(
      `Używasz Node ${process.versions.node}, a projekt wymaga Node ${expected} (.nvmrc). Przełącz wersję: nvm use (albo fnm use).`,
    );
  }
}

function ensureEnvFile(): void {
  if (existsSync(ENV_FILE)) {
    log.info('Plik .env już istnieje, zostawiam go bez zmian.');
    return;
  }
  // COPYFILE_EXCL: nigdy nie nadpisujemy istniejącego .env.
  copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE, constants.COPYFILE_EXCL);
  log.success('Utworzono .env z .env.example (wartości działają od razu).');
}

await runCli(async () => {
  const startedAt = performance.now();
  console.log(log.bold('Biddy: przygotowanie lokalnego środowiska'));
  checkNodeVersion();

  log.step('[1/5] Plik .env');
  ensureEnvFile();

  log.step('[2/5] Zmienne środowiskowe');
  const env = loadInfraEnv();
  // Wszystkie bezpieczniki przed jakąkolwiek zmianą: setup kasuje bazę i zmienia kubełki S3,
  // więc dla zdalnych adresów albo NODE_ENV=production odmawia od razu, niczego nie ruszając.
  assertResetAllowed(env);
  assertStorageAllowed(env);
  log.success('Konfiguracja jest poprawna, baza i S3 wskazują na usługi lokalne.');

  log.step('[3/5] Docker i usługi');
  await ensureDocker();
  await composeUp();
  log.success('Wszystkie usługi działają i przeszły healthchecki.');

  log.step('[4/5] Kubełki S3');
  await setupStorage(env);

  log.step('[5/5] Baza danych');
  await resetDatabase(env, { ...process.env, ...readRawEnv().values });

  const seconds = Math.round((performance.now() - startedAt) / 1000);
  log.success(`Środowisko gotowe (${seconds} s).`);
  console.log(`\n${describeServices(env)}\n`);
  console.log(log.bold('Co dalej:'));
  log.info('pnpm dev          infrastruktura i aplikacje w trybie deweloperskim');
  log.info('pnpm mail:test    test poczty (podgląd w Mailpit)');
  log.info('pnpm infra:down   zatrzymanie usług (dane zostają w wolumenach)');
});
