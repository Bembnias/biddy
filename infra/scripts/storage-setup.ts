// `pnpm storage:setup`: tworzy brakujące kubełki S3 (media, dokumenty) i regułę CORS.
// Idempotentny, można go uruchamiać wielokrotnie.
import { loadInfraEnv } from './env.js';
import { log, runCli } from './lib/cli.js';
import { setupStorage } from './lib/storage.js';

await runCli(async () => {
  const env = loadInfraEnv();
  log.step(`Kubełki S3 w ${env.S3_ENDPOINT}`);
  await setupStorage(env);
  log.success('Kubełki S3 są gotowe.');
});
