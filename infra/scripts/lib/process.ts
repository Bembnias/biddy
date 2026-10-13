// Uruchamianie poleceń zewnętrznych (docker, pnpm) bez powłoki.
import { spawn } from 'node:child_process';

import { CliError } from './cli.js';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * - `inherit`: wyjście trafia prosto do terminala,
   * - `capture`: wyjście jest tylko zbierane (np. do parsowania JSON-a),
   * - `tee`: stdout do terminala, stderr do terminala i jednocześnie zbierany (do diagnozy błędu).
   */
  output?: 'inherit' | 'capture' | 'tee';
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Polecenie nie istnieje w PATH (ENOENT). */
export class CommandNotFoundError extends CliError {
  readonly command: string;

  constructor(command: string, hints: readonly string[] = []) {
    super(`Nie znaleziono polecenia „${command}” w PATH.`, hints);
    this.name = 'CommandNotFoundError';
    this.command = command;
  }
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const output = options.output ?? 'inherit';
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [
        'inherit',
        output === 'capture' ? 'pipe' : 'inherit',
        output === 'inherit' ? 'inherit' : 'pipe',
      ],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
      if (output === 'tee') {
        process.stderr.write(chunk);
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new CommandNotFoundError(command) : error);
    });
    child.on('close', (code, signal) => {
      // Zabicie sygnałem traktujemy jak błąd (kod 128 + numer sygnału byłby nieczytelny).
      resolve({ exitCode: code ?? (signal ? 1 : 0), stdout, stderr });
    });
  });
}
