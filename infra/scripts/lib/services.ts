// Podsumowanie lokalnych usług (adresy i dane logowania) wypisywane po starcie infrastruktury.
import type { InfraEnv } from '../env.js';
import { formatTable } from './cli.js';

function withoutPassword(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.password = '';
  return url.href;
}

export function describeServices(env: InfraEnv): string {
  const s3Login = `${env.S3_ACCESS_KEY_ID} / ${env.S3_SECRET_ACCESS_KEY}`;
  const rows = [
    [
      'PostgreSQL 17',
      withoutPassword(env.DATABASE_URL),
      `${env.POSTGRES_USER} / ${env.POSTGRES_PASSWORD}`,
    ],
    ['Redis: kolejki (BullMQ)', env.REDIS_QUEUE_URL, 'bez hasła'],
    ['Redis: cache i pub/sub', env.REDIS_CACHE_URL, 'bez hasła'],
    ['Meilisearch', env.MEILI_URL, `klucz: ${env.MEILI_MASTER_KEY}`],
    ['RustFS: API S3', env.S3_ENDPOINT, s3Login],
    ['RustFS: konsola', `http://localhost:${env.RUSTFS_CONSOLE_PORT}/rustfs/console/`, s3Login],
    ['Mailpit: SMTP', `${env.SMTP_HOST}:${env.SMTP_PORT}`, 'dowolne albo brak'],
    ['Mailpit: podgląd maili', env.MAILPIT_UI_URL, 'bez logowania'],
  ];
  return formatTable(['Usługa', 'Adres', 'Dane logowania'], rows);
}
