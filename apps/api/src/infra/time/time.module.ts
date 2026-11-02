import { Module } from '@nestjs/common';

import { TimeController } from './time.controller.js';

/** GET /v1/time: czas serwera dla synchronizacji zegara klientów. */
@Module({ controllers: [TimeController] })
export class TimeModule {}
