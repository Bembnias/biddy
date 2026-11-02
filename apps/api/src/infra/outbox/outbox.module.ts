import { Global, Module } from '@nestjs/common';

import { Outbox } from './outbox.js';
import { OutboxMaintenance } from './outbox-maintenance.js';

/**
 * Outbox w API i w workerze: Outbox (zapis eventów w transakcji) i sprzątanie tabel (job
 * cykliczny wykonywany przez worker). Moduł globalny; relay i konsumentów uruchamia worker.
 */
@Global()
@Module({
  providers: [Outbox, OutboxMaintenance],
  exports: [Outbox],
})
export class OutboxModule {}
