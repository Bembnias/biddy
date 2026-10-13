// `pnpm --filter @biddy/api dev:board` (uruchamia go też `pnpm dev`): Bull Board pod
// http://localhost:3002 (BULL_BOARD_PORT), tylko poza produkcją. Czyta wyłącznie Redis kolejek
// (REDIS_QUEUE_URL, QUEUE_PREFIX), więc nie wymaga bazy ani działającego API.
import { ConfigError, formatConfigError, loadBullBoardConfig } from './infra/config/config.js';
import { startBullBoard } from './infra/queues/bull-board.js';

const PREFIX = '[bull-board]';

let config;
try {
  config = loadBullBoardConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${formatConfigError(error)}\n`);
    process.exit(1);
  }
  throw error;
}

try {
  const board = await startBullBoard(config);
  console.log(`${PREFIX} Kolejki BullMQ (prefiks ${config.prefix}): ${board.url}`);
  const shutdown = () => {
    void board.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(
    `${PREFIX} Nie udało się uruchomić: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(
    `${PREFIX} Sprawdź, czy port ${config.port} jest wolny (BULL_BOARD_PORT) i czy Redis kolejek działa (pnpm infra:up).`,
  );
  process.exitCode = 1;
}
