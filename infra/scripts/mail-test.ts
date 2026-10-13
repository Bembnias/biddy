// `pnpm mail:test`: wysyła testowy mail przez SMTP i sprawdza w API Mailpit, że dotarł.
import { loadInfraEnv } from './env.js';
import { log, runCli } from './lib/cli.js';
import { sendTestMail } from './lib/mail.js';

await runCli(async () => {
  const env = loadInfraEnv();
  log.step(`Wysyłam testowy mail przez SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  const mail = await sendTestMail(env);
  log.success(`Mail dotarł do Mailpit: „${mail.subject}”`);
  log.info(`Podgląd wiadomości: ${mail.viewUrl}`);
  log.info(`Wszystkie maile:    ${env.MAILPIT_UI_URL}`);
});
