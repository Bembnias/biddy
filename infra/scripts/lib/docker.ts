// Docker i docker compose: sprawdzenie dostępności oraz start usług z infra/docker-compose.yml.
import { existsSync } from 'node:fs';

import { CliError, log } from './cli.js';
import { COMPOSE_FILE, ENV_FILE, ROOT_DIR } from './paths.js';
import { CommandNotFoundError, run } from './process.js';

/** Ile sekund czekamy na healthchecki wszystkich usług. */
const WAIT_TIMEOUT_SECONDS = 180;

const INSTALL_HINT =
  'Zainstaluj Docker Desktop (macOS, Windows) albo Docker Engine z wtyczką compose v2 (Linux): https://docs.docker.com/get-started/get-docker/';

/** Sprawdza, czy działa polecenie docker, jego demon i compose v2. Rzuca CliError z instrukcją. */
export async function ensureDocker(): Promise<void> {
  let daemon;
  try {
    daemon = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { output: 'capture' });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new CliError('Nie znaleziono Dockera (polecenie docker).', [INSTALL_HINT]);
    }
    throw error;
  }
  if (daemon.exitCode !== 0) {
    throw new CliError('Docker jest zainstalowany, ale nie można połączyć się z jego demonem.', [
      'Uruchom Docker Desktop albo usługę Dockera (Linux: sudo systemctl start docker).',
      'Na Linuksie bez sudo: dodaj użytkownika do grupy docker i zaloguj się ponownie.',
      `Szczegóły: ${firstLine(daemon.stderr) || 'brak'}`,
    ]);
  }

  const compose = await run('docker', ['compose', 'version', '--short'], { output: 'capture' });
  if (compose.exitCode !== 0) {
    throw new CliError('Brak wtyczki docker compose v2 (polecenie `docker compose`).', [
      'Stare `docker-compose` (v1) nie jest obsługiwane.',
      INSTALL_HINT,
    ]);
  }
  log.info(
    log.dim(
      `Docker ${daemon.stdout.trim()}, docker compose ${compose.stdout.trim().replace(/^v/, '')}`,
    ),
  );
}

/** Argumenty wspólne dla wszystkich poleceń compose (projekt `biddy` z pliku infra/). */
export function composeArgs(): string[] {
  // Bez .env (np. zmienne tylko z powłoki w CI) compose użyje wartości domyślnych z pliku.
  const envFileArgs = existsSync(ENV_FILE) ? ['--env-file', ENV_FILE] : [];
  return ['compose', '-f', COMPOSE_FILE, ...envFileArgs];
}

/** `docker compose up -d --wait`: startuje usługi i czeka, aż wszystkie healthchecki przejdą. */
export async function composeUp(): Promise<void> {
  const result = await run(
    'docker',
    [...composeArgs(), 'up', '--detach', '--wait', '--wait-timeout', String(WAIT_TIMEOUT_SECONDS)],
    { cwd: ROOT_DIR, output: 'tee' },
  );
  if (result.exitCode === 0) {
    return;
  }

  const hints: string[] = [];
  if (
    /address already in use|port is already allocated|ports are not available/i.test(result.stderr)
  ) {
    hints.push(
      'Któryś port jest zajęty przez inny program (np. lokalny Postgres lub Redis).',
      'Zmień w .env odpowiednią zmienną *_PORT oraz ten sam port w powiązanym adresie URL, np. POSTGRES_PORT=5433 i DATABASE_URL=postgres://biddy:biddy@localhost:5433/biddy, potem `pnpm env:check`.',
    );
  }
  hints.push(
    'Stan usług: docker compose -f infra/docker-compose.yml ps',
    'Logi usług: pnpm infra:logs',
  );
  throw new CliError(
    `Nie udało się uruchomić infrastruktury (docker compose zakończył się kodem ${result.exitCode}).`,
    hints,
  );
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}
