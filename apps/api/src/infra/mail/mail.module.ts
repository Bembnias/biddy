import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { MailQueue } from './mail-queue.js';
import { MAIL_SENDER, createMailSender } from './mail-sender.js';

/** E-maile: MailQueue (kolejkowanie w API, wysyłka w workerze) i adapter MAIL_SENDER. */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createMailSender(config.mail),
    },
    MailQueue,
  ],
  exports: [MAIL_SENDER, MailQueue],
})
export class MailModule {}
