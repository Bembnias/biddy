// Błędy krytyczne procesu: nieobsłużony wyjątek (uncaughtException) i nieobsłużone odrzucenie
// obietnicy (unhandledRejection). Zasada „crash-only”: log przez pino (z kontekstem), próba
// łagodnego zamknięcia aplikacji z limitem czasu (pula bazy, trwające żądania), wysłanie
// zaległych zdarzeń do Sentry i wyjście z kodem 1; platforma uruchamia instancję od nowa.
// Zachowanie jest takie samo z Sentry i bez niego: instrument.ts ustawia Sentry tak, żeby tylko
// zgłaszało zdarzenie (bez własnego wypisywania na stderr i bez kończenia procesu).

export interface FatalErrorOptions {
  /** Log krytyczny, np. Logger NestJS (pino). */
  readonly log: (error: Error, message: string) => void;
  /** Łagodne zamknięcie aplikacji (app.close()). */
  readonly shutdown: () => Promise<unknown>;
  /** Wysłanie zaległych zdarzeń Sentry (bez Sentry od razu się kończy). */
  readonly flush: (timeoutMs: number) => Promise<unknown>;
  readonly exit: (code: number) => void;
  /** Limit czasu na łagodne zamknięcie; domyślnie {@link FATAL_SHUTDOWN_TIMEOUT_MS}. */
  readonly shutdownTimeoutMs?: number;
  /** Nazwa procesu w komunikatach („API” albo „worker”); domyślnie API. */
  readonly label?: string;
}

/** Proces Node (albo jego zastępstwo w testach). */
export type FatalErrorSource = Pick<NodeJS.EventEmitter, 'on' | 'off'>;

export const FATAL_SHUTDOWN_TIMEOUT_MS = 10_000;
export const SENTRY_FLUSH_TIMEOUT_MS = 2_000;

/** Komunikaty logów krytycznych dla procesu o danej nazwie. */
export function fatalMessages(label: string) {
  return {
    unhandledRejection: `Nieobsłużone odrzucenie obietnicy (unhandledRejection): zamykam ${label}`,
    uncaughtException: `Nieobsłużony wyjątek (uncaughtException): zamykam ${label}`,
    shutdownFailed: `Nie udało się łagodnie zamknąć ${label} po błędzie krytycznym`,
    shutdownTimeout: (ms: number) => `Zamykanie ${label} przekroczyło ${ms} ms`,
  };
}

export const UNHANDLED_REJECTION_MESSAGE = fatalMessages('API').unhandledRejection;
export const UNCAUGHT_EXCEPTION_MESSAGE = fatalMessages('API').uncaughtException;

/** Odrzucenie wartością, która nie jest błędem (np. `Promise.reject('x')`), jako Error. */
function asError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return Object.assign(new Error(`Odrzucenie wartością niebędącą błędem: ${String(reason)}`), {
    reason,
  });
}

async function shutdownWithin(
  shutdown: () => Promise<unknown>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    await Promise.race([shutdown(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rejestruje obsługę błędów krytycznych. Pierwszy błąd uruchamia zamykanie, kolejne (np. z
 * trwających żądań) są tylko logowane. Zwraca funkcję, która wyrejestrowuje obsługę.
 */
export function handleFatalErrors(
  source: FatalErrorSource,
  options: FatalErrorOptions,
): () => void {
  let terminating = false;
  const messages = fatalMessages(options.label ?? 'API');
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? FATAL_SHUTDOWN_TIMEOUT_MS;

  const onFatal = (message: string) => (reason: unknown) => {
    options.log(asError(reason), message);
    if (terminating) {
      return;
    }
    terminating = true;
    void (async () => {
      try {
        await shutdownWithin(
          options.shutdown,
          shutdownTimeoutMs,
          messages.shutdownTimeout(shutdownTimeoutMs),
        );
      } catch (shutdownError) {
        options.log(asError(shutdownError), messages.shutdownFailed);
      }
      await options.flush(SENTRY_FLUSH_TIMEOUT_MS).catch(() => undefined);
      options.exit(1);
    })();
  };

  const onRejection = onFatal(messages.unhandledRejection);
  const onException = onFatal(messages.uncaughtException);
  source.on('unhandledRejection', onRejection);
  source.on('uncaughtException', onException);
  return () => {
    source.off('unhandledRejection', onRejection);
    source.off('uncaughtException', onException);
  };
}
