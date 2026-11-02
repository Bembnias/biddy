// API (apps/api, src/main.ts) jako proces dla testów klienta, tak jak w `pnpm dev`. Baza nie
// jest potrzebna: GET /v1/time i odpowiedzi z błędem nie wysyłają zapytań (pula łączy się
// leniwie), więc DATABASE_URL wskazuje na port, na którym nic nie słucha.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// W środowisku happy-dom globalny URL pochodzi z DOM, więc ścieżkę liczymy przez node:path.
const API_DIR = path.resolve(import.meta.dirname, '../../../../apps/api');

/** Origin aplikacji web w development (domyślne CORS_ORIGINS API). */
export const WEB_ORIGIN = 'http://localhost:3000';

/** Zmienne konfigurujące API (np. z .env dewelopera w powłoce); test podaje własne. */
const API_VARIABLE =
  /^(?:NODE_ENV|PORT|API_|DATABASE_|REDIS_|QUEUE_|OUTBOX_|SENTRY_|LOG_|CORS_|OPENAPI_|TRUST_PROXY|APP_RELEASE|BULL_BOARD_)/;

export interface ApiProcess {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('Nie udało się zarezerwować wolnego portu');
  }
  return address.port;
}

/** Status GET przez Node (bez CORS): sonda z procesu testu, a nie ze „strony”. */
function statusOf(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    }).on('error', reject);
  });
}

async function waitForHealth(api: ChildProcess, baseUrl: string, output: () => string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(
        `API zakończyło się przed startem (kod ${String(api.exitCode)}):\n${output()}`,
      );
    }
    if ((await statusOf(`${baseUrl}/health`).catch(() => 0)) === 200) {
      return;
    }
    await delay(200);
  }
  throw new Error(`API nie wystartowało w ciągu minuty:\n${output()}`);
}

/** Uruchamia API na wolnym porcie i czeka, aż /health odpowie 200. */
export async function startApi(env: Record<string, string> = {}): Promise<ApiProcess> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !API_VARIABLE.test(key)),
  );
  const api = spawn(
    process.execPath,
    ['--import', '@swc-node/register/esm-register', 'src/main.ts'],
    {
      cwd: API_DIR,
      env: {
        ...inherited,
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        CORS_ORIGINS: WEB_ORIGIN,
        DATABASE_URL: 'postgres://biddy@127.0.0.1:1/biddy',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  api.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  api.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  try {
    await waitForHealth(api, baseUrl, () => output);
  } catch (error) {
    api.kill('SIGKILL');
    throw error;
  }
  return {
    baseUrl,
    stop: async () => {
      if (api.exitCode === null && api.signalCode === null) {
        const exited = once(api, 'exit');
        api.kill('SIGTERM');
        await exited;
      }
    },
  };
}
