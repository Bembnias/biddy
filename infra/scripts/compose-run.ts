// `pnpm infra:down | infra:logs | infra:reset`: docker compose dla projektu `biddy`
// z argumentami przekazanymi z linii poleceń (np. `down -v`, `logs -f`).
// Plik .env jest opcjonalny: bez niego compose użyje wartości domyślnych z docker-compose.yml.
import { runCli } from './lib/cli.js';
import { composeArgs } from './lib/docker.js';
import { ROOT_DIR } from './lib/paths.js';
import { run } from './lib/process.js';

await runCli(async () => {
  const result = await run('docker', [...composeArgs(), ...process.argv.slice(2)], {
    cwd: ROOT_DIR,
  });
  process.exitCode = result.exitCode;
});
