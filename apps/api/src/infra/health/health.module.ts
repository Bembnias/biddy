import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

/** Sondy /health i /ready. DatabaseHealth pochodzi z globalnego DbModule. */
@Module({ controllers: [HealthController] })
export class HealthModule {}
