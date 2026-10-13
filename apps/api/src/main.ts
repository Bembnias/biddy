// Punkt wejścia API (HTTP). Kolejność: walidacja konfiguracji, dopiero potem import i budowa
// aplikacji, więc przy złej zmiennej środowiskowej nic się nie łączy ani nie startuje.
import 'reflect-metadata';

import {
  type AppConfig,
  ConfigError,
  formatConfigError,
  loadConfig,
} from './infra/config/config.js';

function readConfig(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${formatConfigError(error)}\n`);
      process.exit(1);
    }
    throw error;
  }
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') {
    return 'localhost';
  }
  return host.includes(':') ? `[${host}]` : host;
}

const config = readConfig();

const { Logger } = await import('@nestjs/common');
const { flush } = await import('@sentry/nestjs');
const { createApp } = await import('./create-app.js');
const { handleFatalErrors } = await import('./fatal-errors.js');
const { DOCS_PATH } = await import('./infra/openapi/index.js');

let app: Awaited<ReturnType<typeof createApp>> | undefined;
const processLogger = new Logger('Process');
// Od tej chwili nieobsłużony wyjątek lub odrzucenie obietnicy kończy proces tak samo z Sentry
// i bez niego: log fatal przez pino, łagodne app.close() z limitem czasu, wyjście z kodem 1.
handleFatalErrors(process, {
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
  app = await createApp(config);
  await app.listen(config.http.port, config.http.host);
  const url = `http://${displayHost(config.http.host)}:${config.http.port}`;
  const docs = config.openapi.enabled ? `, dokumentacja: ${url}${DOCS_PATH}` : '';
  new Logger('Bootstrap').log(`API działa pod ${url}${docs}`);
} catch (error) {
  new Logger('Bootstrap').fatal(error, 'Nie udało się uruchomić API');
  process.exitCode = 1;
  // Daje loggerowi (transport pino) chwilę na zapis przed wyjściem.
  setTimeout(() => process.exit(1), 100).unref();
}
