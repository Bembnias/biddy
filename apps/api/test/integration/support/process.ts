// Procesy potomne w testach integracyjnych: punkty wejścia (src/worker.ts) i proces workera
// z modułem testowym (worker-fixture.ts) uruchamiane tak jak `pnpm dev` (SWC z rejestracji).
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { ENV_KEYS } from '../../../src/infra/config/index.js';

const API_DIR = fileURLToPath(new URL('../../..', import.meta.url));

export interface StartedProcess {
  readonly child: ChildProcess;
  output(): { stdout: string; stderr: string };
}

/** Środowisko bez zmiennych API odziedziczonych z powłoki (np. DATABASE_URL z .env dewelopera). */
function processEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  for (const key of ENV_KEYS) {
    delete inherited[key];
  }
  return { ...inherited, NODE_ENV: 'test', LOG_LEVEL: 'info', ...env };
}

/** Uruchamia plik TypeScript z katalogu apps/api (np. src/worker.ts) w osobnym procesie Node. */
export function startScript(
  script: string,
  env: Record<string, string>,
  args: readonly string[] = [],
): StartedProcess {
  const child = spawn(
    process.execPath,
    ['--import', '@swc-node/register/esm-register', script, ...args],
    {
      cwd: API_DIR,
      env: processEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return { child, output: () => ({ stdout, stderr }) };
}

export interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Czeka na zakończenie procesu; po `timeoutMs` zabija go i odrzuca obietnicę. */
export async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<Exit> {
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

/** Czeka, aż w stdout procesu pojawi się `fragment`; przerywa, gdy proces się zakończy. */
export async function waitForOutput(
  started: StartedProcess,
  fragment: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!started.output().stdout.includes(fragment)) {
    const { child } = started;
    if (child.exitCode !== null || child.signalCode !== null) {
      const { stdout, stderr } = started.output();
      throw new Error(
        `Proces zakończył się (kod ${String(child.exitCode)}) przed „${fragment}”:\n${stdout}\n${stderr}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Brak „${fragment}” w stdout po ${timeoutMs} ms:\n${started.output().stdout}`,
      );
    }
    await delay(100);
  }
}

/** Linie logów JSON z wyjścia procesu (pomija linie, które nie są JSON-em). */
export function jsonLines(output: string): Record<string, unknown>[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Zabija proces, jeśli jeszcze działa (sprzątanie po teście). */
export function killIfRunning(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}
