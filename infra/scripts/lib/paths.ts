// Ścieżki liczone względem położenia tego pliku, a nie katalogu roboczego: skrypty działają
// tak samo z katalogu głównego (`pnpm db:reset`) i z infra/ (`pnpm --filter @biddy/infra ...`).
import { fileURLToPath } from 'node:url';

/** Katalog główny repozytorium. */
export const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));

/** Katalog pakietu @biddy/infra. */
export const INFRA_DIR = fileURLToPath(new URL('../../', import.meta.url));

export const COMPOSE_FILE = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));

/** Plik .env w katalogu głównym (nie w infra/). */
export const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

export const ENV_EXAMPLE_FILE = fileURLToPath(new URL('../../../.env.example', import.meta.url));

export const NVMRC_FILE = fileURLToPath(new URL('../../../.nvmrc', import.meta.url));
