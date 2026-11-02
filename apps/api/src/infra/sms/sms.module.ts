import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { SMS_SENDER, createSmsSender } from './sms-sender.js';

/** SMS-y: adapter SMS_SENDER (SMSAPI albo atrapa). */
@Global()
@Module({
  providers: [
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createSmsSender(config.sms),
    },
  ],
  exports: [SMS_SENDER],
})
export class SmsModule {}
