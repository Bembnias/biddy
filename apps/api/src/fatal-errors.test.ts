import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FATAL_SHUTDOWN_TIMEOUT_MS,
  handleFatalErrors,
  SENTRY_FLUSH_TIMEOUT_MS,
  UNCAUGHT_EXCEPTION_MESSAGE,
  UNHANDLED_REJECTION_MESSAGE,
} from './fatal-errors.js';

function setup(shutdown: () => Promise<unknown> = () => Promise.resolve()) {
  const source = new EventEmitter();
  const calls: string[] = [];
  const log = vi.fn((error: Error, message: string) => {
    calls.push(`log: ${message} (${error.message})`);
  });
  const options = {
    log,
    shutdown: vi.fn(async () => {
      calls.push('shutdown');
      await shutdown();
    }),
    flush: vi.fn((timeoutMs: number) => {
      calls.push(`flush ${timeoutMs}`);
      return Promise.resolve(true);
    }),
    exit: vi.fn((code: number) => {
      calls.push(`exit ${code}`);
    }),
  };
  const dispose = handleFatalErrors(source, options);
  return { source, calls, options, dispose };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('handleFatalErrors', () => {
  it('unhandledRejection: log fatal, łagodne zamknięcie, Sentry flush, wyjście z kodem 1', async () => {
    const { source, calls, options } = setup();

    source.emit('unhandledRejection', new Error('pływająca obietnica'));

    await vi.waitFor(() => expect(options.exit).toHaveBeenCalled());
    expect(calls).toEqual([
      `log: ${UNHANDLED_REJECTION_MESSAGE} (pływająca obietnica)`,
      'shutdown',
      `flush ${SENTRY_FLUSH_TIMEOUT_MS}`,
      'exit 1',
    ]);
  });

  it('uncaughtException: ten sam przebieg z własnym komunikatem', async () => {
    const { source, calls, options } = setup();

    source.emit('uncaughtException', new TypeError('boom'));

    await vi.waitFor(() => expect(options.exit).toHaveBeenCalledWith(1));
    expect(calls[0]).toBe(`log: ${UNCAUGHT_EXCEPTION_MESSAGE} (boom)`);
  });

  it('odrzucenie wartością niebędącą błędem loguje Error z tą wartością', async () => {
    const { source, options } = setup();

    source.emit('unhandledRejection', 'tekst zamiast błędu');

    await vi.waitFor(() => expect(options.exit).toHaveBeenCalled());
    const [error] = options.log.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('tekst zamiast błędu');
    expect(error).toMatchObject({ reason: 'tekst zamiast błędu' });
  });

  it('kolejne błędy w trakcie zamykania są tylko logowane (jedno zamknięcie, jedno wyjście)', async () => {
    let finishShutdown: () => void = () => undefined;
    const { source, options } = setup(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve;
        }),
    );

    source.emit('unhandledRejection', new Error('pierwszy'));
    source.emit('uncaughtException', new Error('drugi'));
    finishShutdown();

    await vi.waitFor(() => expect(options.exit).toHaveBeenCalled());
    expect(options.log).toHaveBeenCalledTimes(2);
    expect(options.shutdown).toHaveBeenCalledTimes(1);
    expect(options.exit).toHaveBeenCalledTimes(1);
  });

  it('zawieszone zamykanie: po limicie czasu i tak kończy proces', async () => {
    vi.useFakeTimers();
    const { source, options, calls } = setup(() => new Promise(() => undefined));

    source.emit('unhandledRejection', new Error('zawieszenie'));
    await vi.advanceTimersByTimeAsync(FATAL_SHUTDOWN_TIMEOUT_MS);

    expect(options.exit).toHaveBeenCalledWith(1);
    expect(calls).toContain(
      `log: Nie udało się łagodnie zamknąć API po błędzie krytycznym (Zamykanie API przekroczyło ${FATAL_SHUTDOWN_TIMEOUT_MS} ms)`,
    );
  });

  it('błąd zamykania i błąd Sentry nie blokują wyjścia', async () => {
    const { source, options } = setup(() => Promise.reject(new Error('pula już zamknięta')));
    options.flush.mockRejectedValueOnce(new Error('Sentry niedostępne'));

    source.emit('unhandledRejection', new Error('x'));

    await vi.waitFor(() => expect(options.exit).toHaveBeenCalledWith(1));
  });

  it('funkcja zwrotna wyrejestrowuje obsługę', () => {
    const { source, dispose } = setup();

    dispose();

    expect(source.listenerCount('unhandledRejection')).toBe(0);
    expect(source.listenerCount('uncaughtException')).toBe(0);
  });
});
