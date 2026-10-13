// Wspólne wyjście konsolowe i obsługa błędów skryptów deweloperskich.
import { styleText } from 'node:util';

/**
 * Błąd przewidziany przez skrypt (brak Dockera, zła konfiguracja, usługa nie działa).
 * Wypisujemy go bez stack trace'a, za to ze wskazówkami, co zrobić dalej.
 */
export class CliError extends Error {
  readonly hints: readonly string[];

  constructor(message: string, hints: readonly string[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.hints = hints;
  }
}

type Style = Parameters<typeof styleText>[0];

// styleText sam pomija kolory, gdy wyjście nie jest terminalem albo ustawiono NO_COLOR.
function paint(style: Style, text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return styleText(style, text, { stream });
}

export const log = {
  step(text: string): void {
    console.log(`\n${paint('bold', `▸ ${text}`)}`);
  },
  info(text: string): void {
    console.log(`  ${text}`);
  },
  success(text: string): void {
    console.log(`${paint('green', '✔')} ${text}`);
  },
  note(text: string): void {
    console.log(`${paint('cyan', 'ℹ')} ${text}`);
  },
  warn(text: string): void {
    console.warn(`${paint('yellow', '⚠', process.stderr)} ${text}`);
  },
  error(text: string): void {
    console.error(`${paint('red', '✖', process.stderr)} ${text}`);
  },
  dim(text: string): string {
    return paint('dim', text);
  },
  bold(text: string): string {
    return paint('bold', text);
  },
};

export function printError(error: unknown): void {
  if (error instanceof CliError) {
    log.error(error.message);
    for (const hint of error.hints) {
      console.error(`  → ${hint}`);
    }
    return;
  }
  log.error('Nieoczekiwany błąd skryptu:');
  console.error(error);
}

/** Uruchamia główną funkcję skryptu; przy błędzie wypisuje go po polsku i ustawia kod wyjścia 1. */
export async function runCli(main: () => void | Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

/** Prosta tabela tekstowa z wyrównanymi kolumnami (bez kolumny indeksu jak w console.table). */
export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  const separator = widths.map((width) => '─'.repeat(width)).join('  ');
  return [line(headers), separator, ...rows.map(line)].join('\n');
}
