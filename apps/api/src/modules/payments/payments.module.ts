import { Module } from '@nestjs/common';

import { FeeScheduleService } from './fees/fee-schedule.service.js';
import { FeeSchedulesController } from './fees/fee-schedules.controller.js';

/**
 * Moduł domenowy `payments` (PROJECT.md §10.3, §7.8): cenniki POK (F-13); płatności, zwroty
 * i wypłaty w kolejnych feature'ach. Publiczne API: ./index.ts.
 */
@Module({
  controllers: [FeeSchedulesController],
  providers: [FeeScheduleService],
  exports: [FeeScheduleService],
})
export class PaymentsModule {}
