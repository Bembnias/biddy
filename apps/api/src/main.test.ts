// main.ts w osobnym procesie (jak `pnpm dev`): zła konfiguracja kończy start kodem 1 z listą
// błędów, poprawna uruchamia serwer, który zamyka się sam po SIGTERM.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENV_KEYS } from './infra/config/index.js';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const NODE_ARGS = ['--import', '@swc-node/register/esm-register', 'src/main.ts'];

/** Środowisko procesu bez zmiennych API z powłoki (np. DATABASE_URL dewelopera) plus podane. */
function cleanEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  for (const key of ENV_KEYS) {
    delete inherited[key];
  }
  return { ...inherited, NODE_ENV: 'test', ...env };
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  server.close();
  await once(server, 'close');
  if (address === null || typeof address === 'string') {
    throw new Error('Nie udało się zarezerwować portu');
  }
  return address.port;
}

async function waitForOutput(child: ChildProcess, fragment: string, timeoutMs: number) {
  let output = '';
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Brak „${fragment}” w wyjściu po ${timeoutMs} ms:\n${output}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(fragment)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Proces zakończył się (kod ${String(code)}) przed „${fragment}”:\n${output}`),
      );
    });
  });
}

describe('main.ts', () => {
  it('brakująca i błędna zmienna: kod 1, lista błędów po polsku, nic nie startuje', () => {
    const result = spawnSync(process.execPath, NODE_ARGS, {
      cwd: API_DIR,
      env: cleanEnv({ PORT: 'abc', LOG_LEVEL: 'głośno' }),
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Nieprawidłowa konfiguracja API');
    expect(result.stderr).toContain('• DATABASE_URL: brak zmiennej');
    expect(result.stderr).toContain('• PORT: oczekiwano numeru portu');
    expect(result.stderr).toContain('• LOG_LEVEL: oczekiwano jednej z wartości');
    expect(result.stderr).toContain('.env.example');
    // Żadnych logów NestJS: aplikacja nie została nawet zaimportowana.
    expect(result.stdout).toBe('');
  }, 60_000);

  it('poprawna konfiguracja: nasłuchuje, odpowiada na /health i kończy się po SIGTERM', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, NODE_ARGS, {
      cwd: API_DIR,
      env: cleanEnv({
        // Baza nie musi działać: pula łączy się dopiero przy pierwszym zapytaniu.
        DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:1/biddy',
        API_PORT: String(port),
        LOG_LEVEL: 'info',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const output = await waitForOutput(child, 'API działa pod', 60_000);
      expect(output).toContain(`http://127.0.0.1:${port}`);
      expect(output).toContain(`http://127.0.0.1:${port}/docs`);

      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).not.toBeNull();

      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const [code, signal] = (await exited) as [number | null, NodeJS.Signals | null];
      // NestJS po zamknięciu aplikacji ponawia sygnał, więc proces kończy SIGTERM, nie SIGKILL.
      expect(code === 0 || signal === 'SIGTERM').toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 90_000);

  it('nieobsłużone odrzucenie obietnicy: log fatal przez pino, zamknięcie i kod 1', async () => {
    const port = await freePort();
    // Tylko w teście: po SIGUSR2 proces tworzy „pływające” odrzucenie obietnicy.
    const trigger = `process.on('SIGUSR2', () => { void Promise.reject(new Error('sztuczny błąd testu')); });`;
    const child = spawn(
      process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(trigger)}`, ...NODE_ARGS],
      {
        cwd: API_DIR,
        env: cleanEnv({
          DATABASE_URL: 'postgres://biddy:biddy@127.0.0.1:1/biddy',
          API_PORT: String(port),
          LOG_LEVEL: 'info',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    try {
      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      await waitForOutput(child, 'API działa pod', 60_000);

      const exited = once(child, 'exit');
      child.kill('SIGUSR2');
      const [code] = (await exited) as [number | null, NodeJS.Signals | null];

      expect(code).toBe(1);
      const fatal = stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line['level'] === 'fatal');
      expect(fatal).toMatchObject({
        context: 'Process',
        msg: 'Nieobsłużone odrzucenie obietnicy (unhandledRejection): zamykam API',
        err: expect.objectContaining({ message: 'sztuczny błąd testu' }) as unknown,
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 90_000);
});
