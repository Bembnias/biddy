// Publiczne API e-maili: MailQueue.enqueue (moduły), MailModule, adaptery SMTP i Resend.
export { MailQueue, SEND_EMAIL_JOB } from './mail-queue.js';
export {
  MAIL_SENDER,
  ResendMailSender,
  SmtpMailSender,
  createMailSender,
  type MailMessage,
  type MailSender,
} from './mail-sender.js';
export { MailModule } from './mail.module.js';
