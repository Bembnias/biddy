// Proces workera z modułem testowym (OutboxTestModule) dla testów, które zabijają worker
// sygnałem SIGKILL w trakcie joba. Konfiguracja ze zmiennych środowiskowych, jak w worker.ts;
// krótka blokada joba, żeby po „awarii” job szybko wrócił do kolejki.
import 'reflect-metadata';

import { createWorker } from '../../../src/create-worker.js';
import { loadConfigOrExit } from '../../../src/infra/config/config.js';
import { OutboxTestModule } from './outbox-test.module.js';

const config = loadConfigOrExit(process.env, 'worker');

await createWorker(config, {
  extraModules: [OutboxTestModule],
  tuning: { lockDurationMs: 2_000, stalledIntervalMs: 500 },
});
