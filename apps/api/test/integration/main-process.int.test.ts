// Kryterium akceptacji F-03 na poziomie procesu: prawdziwy punkt wejścia (src/main.ts, tak jak
// `pnpm dev`) nie startuje przy brakującej lub błędnej zmiennej środowiskowej, a z poprawną
// konfiguracją (baza w kontenerze) nasłuchuje i kończy się po SIGTERM.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { ENV_KEYS } from '../../src/infra/config/index.js';
import { databaseUrl } from './support/database.js';

const API_DIR = fileURLToPath(new URL('../..', import.meta.url));
const NODE_ARGS = ['--import', '@swc-node/register/esm-register', 'src/main.ts'];
/** Limit na odmowę startu: walidacja dzieje się przed importem NestJS, więc to sekundy. */
const EXIT_TIMEOUT_MS = 30_000;

/** Środowisko bez zmiennych API odziedziczonych z powłoki (np. DATABASE_URL z .env dewelopera). */
function processEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  for (const key of ENV_KEYS) {
    delete inherited[key];
  }
  return { ...inherited, NODE_ENV: 'test', LOG_LEVEL: 'info', ...env };
}

function startMain(env: Record<string, string>): {
  child: ChildProcess;
  output: () => { stdout: string; stderr: string };
} {
  const child = spawn(process.execPath, NODE_ARGS, {
    cwd: API_DIR,
    env: processEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return { child, output: () => ({ stdout, stderr }) };
}

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Czeka na zakończenie procesu; po `timeoutMs` zabija go i odrzuca obietnicę. */
async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<Exit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  const timer = new AbortController();
  const timeout = delay(timeoutMs, 'timeout' as const, { signal: timer.signal });
  try {
    const result = await Promise.race([exited, timeout]);
    if (result === 'timeout') {
      child.kill('SIGKILL');
      throw new Error(`Proces nie zakończył się w ciągu ${timeoutMs} ms`);
    }
    const [code, signal] = result;
    return { code, signal };
  } finally {
    // Odrzucenie przerwanego opóźnienia (AbortError) obsługuje już Promise.race.
    timer.abort();
  }
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

/** Odpytuje adres, aż odpowie 200; przerywa, gdy proces się zakończy albo minie limit. */
async function pollUntilOk(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Proces API zakończył się przed startem (kod ${String(child.exitCode)})`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) {
        return;
      }
    } catch {
      // Serwer jeszcze nie nasłuchuje.
    }
    await delay(200);
  }
  throw new Error(`${url} nie odpowiedział 200 w ciągu ${timeoutMs} ms`);
}

describe('src/main.ts: konfiguracja walidowana przy starcie', () => {
  it.each([
    ['brak DATABASE_URL', {}, 'DATABASE_URL: brak zmiennej'],
    ['pusty DATABASE_URL', { DATABASE_URL: '' }, 'DATABASE_URL: brak zmiennej'],
    [
      'DATABASE_URL z innym protokołem',
      { DATABASE_URL: 'mysql://biddy:biddy@127.0.0.1:3306/biddy' },
      'DATABASE_URL: oczekiwano adresu postgres://',
    ],
    [
      'DATABASE_URL, który nie jest adresem',
      { DATABASE_URL: 'biddy@localhost/biddy' },
      'DATABASE_URL: oczekiwano adresu postgres://',
    ],
    [
      'DATABASE_URL bez nazwy bazy',
      { DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:5432' },
      'DATABASE_URL: oczekiwano adresu postgres://',
    ],
  ])(
    '%s → kod wyjścia 1, nazwa zmiennej na stderr, nic nie startuje',
    async (_case, env, expected) => {
      const { child, output } = startMain(env);
      const exit = await waitForExit(child, EXIT_TIMEOUT_MS);
      const { stdout, stderr } = output();

      // Proces kończy się sam (kod 1), a nie przez sygnał po przekroczeniu limitu.
      expect(exit, stderr).toEqual({ code: 1, signal: null });
      expect(stderr).toContain('Nieprawidłowa konfiguracja API');
      expect(stderr).toContain(`• ${expected}`);
      // Ani jednej linii logów NestJS: aplikacja nie została nawet zaimportowana.
      expect(stdout).toBe('');
    },
    EXIT_TIMEOUT_MS + 10_000,
  );

  it('poprawna konfiguracja (baza w kontenerze): nasłuchuje, /health i /ready → 200, SIGTERM kończy proces', async () => {
    const port = await freePort();
    const { child, output } = startMain({
      DATABASE_URL: databaseUrl(),
      API_HOST: '127.0.0.1',
      API_PORT: String(port),
    });
    const base = `http://127.0.0.1:${port}`;
    try {
      await pollUntilOk(`${base}/health`, child, 60_000);

      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });

      child.kill('SIGTERM');
      const exit = await waitForExit(child, 15_000);
      // Po łagodnym zamknięciu NestJS ponawia sygnał, więc proces kończy SIGTERM (kod 143).
      expect(exit.code === 0 || exit.signal === 'SIGTERM', JSON.stringify(exit)).toBe(true);

      const { stdout, stderr } = output();
      expect(stdout).toContain('API działa pod');
      // Logi w JSON (NODE_ENV=test): żadnego błędu ani przy starcie, ani przy zamykaniu.
      expect(stdout).not.toMatch(/"level":"(error|fatal)"/);
      expect(stderr).toBe('');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 90_000);
});
