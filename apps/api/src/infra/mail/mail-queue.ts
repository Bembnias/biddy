import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { JobHandler, JobQueues, type JobRun } from '../queues/index.js';
import { MAIL_SENDER, type MailMessage, type MailSender } from './mail-sender.js';

export const SEND_EMAIL_JOB = 'email.send';

const mailMessageSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string(),
  html: z.string(),
});

/**
 * E-maile przez kolejkę `emails`: `enqueue` w API (np. link weryfikacyjny przy rejestracji),
 * wysyłka w workerze z ponowieniami. Job znika po wysłaniu (link z tokenem nie zostaje w Redisie).
 */
@Injectable()
export class MailQueue {
  constructor(
    private readonly queues: JobQueues,
    @Inject(MAIL_SENDER) private readonly sender: MailSender,
  ) {}

  async enqueue(message: MailMessage): Promise<void> {
    await this.queues.add('emails', SEND_EMAIL_JOB, mailMessageSchema.parse(message));
  }

  @JobHandler('emails', SEND_EMAIL_JOB)
  async send(job: JobRun<unknown>): Promise<void> {
    await this.sender.send(mailMessageSchema.parse(job.data));
  }
}
