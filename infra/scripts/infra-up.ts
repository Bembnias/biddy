// `pnpm infra:up`: sprawdza Dockera, startuje usługi z docker-compose.yml, czeka na ich
// healthchecki i przygotowuje kubełki S3. Uruchamiany też przez `pnpm dev`.
import { loadInfraEnv } from './env.js';
import { log, runCli } from './lib/cli.js';
import { composeUp, ensureDocker } from './lib/docker.js';
import { describeServices } from './lib/services.js';
import { checkStorageSafety } from './lib/storage-safety.js';
import { setupStorage } from './lib/storage.js';

await runCli(async () => {
  const env = loadInfraEnv();
  // Sprawdzamy przed startem usług: S3_ENDPOINT spoza tej maszyny (np. R2 ze zmiennych powłoki)
  // nie może zostać zmieniony. `pnpm dev` ma wtedy działać dalej, więc tylko pomijamy ten krok.
  const storageSafety = checkStorageSafety(env.S3_ENDPOINT, env.NODE_ENV);

  log.step('Docker');
  await ensureDocker();

  log.step('Usługi (docker compose up --wait)');
  await composeUp();

  log.step('Kubełki S3');
  if (storageSafety.ok) {
    await setupStorage(env);
  } else {
    log.warn(`Pomijam przygotowanie kubełków S3. ${storageSafety.reason}`);
  }

  log.success('Infrastruktura działa.');
  console.log(`\n${describeServices(env)}\n`);
});
