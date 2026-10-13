// Punkt wejścia workera (PROJECT.md §10.4): joby BullMQ, konsumenci eventów domenowych, joby
// cykliczne i relay outboxa, bez HTTP. Kolejność jak w main.ts: walidacja konfiguracji, dopiero
// potem import i budowa aplikacji. Worker nie startuje, gdy Redis kolejek nie ma
// maxmemory-policy noeviction.
import 'reflect-metadata';

import { loadConfigOrExit } from './infra/config/config.js';

const config = loadConfigOrExit(process.env, 'worker');

const { Logger } = await import('@nestjs/common');
const { flush, getGlobalScope } = await import('@sentry/nestjs');
const { createWorker } = await import('./create-worker.js');
const { handleFatalErrors } = await import('./fatal-errors.js');

// API i worker dzielą projekt Sentry; tag odróżnia zdarzenia procesów.
getGlobalScope().setTag('process', 'worker');

let app: Awaited<ReturnType<typeof createWorker>> | undefined;
const processLogger = new Logger('Process');
handleFatalErrors(process, {
  label: 'worker',
  log: (error, message) => {
    processLogger.fatal(error, message);
  },
  shutdown: async () => {
    await app?.close();
  },
  flush,
  exit: (code) => process.exit(code),
});

try {
  app = await createWorker(config);
} catch (error) {
  new Logger('Bootstrap').fatal(error, 'Nie udało się uruchomić workera');
  process.exitCode = 1;
  // Daje loggerowi (transport pino) chwilę na zapis przed wyjściem.
  setTimeout(() => process.exit(1), 100).unref();
}
