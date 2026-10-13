// Kubełki S3 w RustFS: idempotentne tworzenie i reguła CORS dla uploadu z przeglądarki.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import type { InfraEnv } from '../env.js';
import { CliError, log } from './cli.js';
import { checkStorageSafety } from './storage-safety.js';

/** Sprawdza bezpiecznik S3 i rzuca CliError z powodem odmowy. */
export function assertStorageAllowed(env: InfraEnv): void {
  const safety = checkStorageSafety(env.S3_ENDPOINT, env.NODE_ENV);
  if (!safety.ok) {
    throw new CliError(`Odmowa przygotowania kubełków S3. ${safety.reason}`, [
      '`pnpm storage:setup` działa wyłącznie na lokalnym RustFS z docker compose (S3_ENDPOINT=http://localhost:9000).',
      'Kubełki i CORS w Cloudflare R2 konfiguruje się w panelu Cloudflare, nie tym skryptem.',
    ]);
  }
}

export function createS3Client(env: InfraEnv): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // Lokalny serwer odpowiada od razu albo wcale; nie ma sensu ponawiać kilka razy.
    maxAttempts: 2,
  });
}

function httpStatus(error: unknown): number | undefined {
  return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
}

/** Zamienia błąd SDK na CliError z podpowiedzią (serwer nie działa, złe klucze). */
function storageError(error: unknown, env: InfraEnv, action: string): CliError {
  if (error instanceof S3ServiceException) {
    const status = error.$metadata.httpStatusCode;
    // Odpowiedź na HEAD nie ma treści, więc SDK nie zna kodu błędu ("Unknown"); zostaje status HTTP.
    const known = error.name !== 'Unknown' && error.name !== 'UnknownError';
    const details = known ? `${error.name}, HTTP ${status ?? '?'}` : `HTTP ${status ?? '?'}`;
    const credentialsProblem =
      status === 403 ||
      ['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied'].includes(error.name);
    const hints = credentialsProblem
      ? [
          'Odmowa dostępu: S3_ACCESS_KEY_ID i S3_SECRET_ACCESS_KEY muszą być takie same jak klucze, z którymi działa kontener RustFS.',
          'Po zmianie kluczy w .env uruchom ponownie: pnpm infra:up (compose odtworzy kontener).',
        ]
      : ['Logi RustFS: pnpm infra:logs'];
    return new CliError(`${action}: serwer S3 odrzucił żądanie (${details}).`, hints, {
      cause: error,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new CliError(
    `${action}: brak połączenia z S3 pod adresem ${env.S3_ENDPOINT} (${reason || 'brak szczegółów'}).`,
    [
      'Czy infrastruktura działa? Uruchom: pnpm infra:up',
      'Sprawdź S3_ENDPOINT i RUSTFS_PORT w .env.',
    ],
    { cause: error },
  );
}

async function ensureBucket(client: S3Client, env: InfraEnv, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    log.info(`Kubełek ${bucket}: już istnieje`);
    return;
  } catch (error) {
    if (httpStatus(error) !== 404) {
      throw storageError(error, env, `Sprawdzenie kubełka ${bucket}`);
    }
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    log.info(`Kubełek ${bucket}: utworzony`);
  } catch (error) {
    // Wyścig z innym procesem albo serwer, który mimo 404 z HEAD zna kubełek.
    if (error instanceof S3ServiceException && error.name === 'BucketAlreadyOwnedByYou') {
      log.info(`Kubełek ${bucket}: już istnieje`);
      return;
    }
    throw storageError(error, env, `Tworzenie kubełka ${bucket}`);
  }
}

/** Reguła CORS: przeglądarka wysyła zdjęcia prosto do S3 przez presigned PUT (PROJECT.md §16.1). */
async function applyMediaCors(client: S3Client, env: InfraEnv): Promise<void> {
  const bucket = env.S3_BUCKET_MEDIA;
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: env.S3_CORS_ORIGINS,
              AllowedMethods: ['PUT', 'GET', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    log.info(`Kubełek ${bucket}: CORS dla ${env.S3_CORS_ORIGINS.join(', ')} (PUT, GET, HEAD)`);
  } catch (error) {
    const status = httpStatus(error);
    const unsupported =
      error instanceof S3ServiceException && (error.name === 'NotImplemented' || status === 501);
    if (!unsupported) {
      throw storageError(error, env, `Ustawienie CORS kubełka ${bucket}`);
    }
    log.note(
      `Serwer S3 nie obsługuje PutBucketCors, pomijam regułę CORS dla ${bucket}. Upload z przeglądarki przez presigned URL może być blokowany przez CORS.`,
    );
  }
}

/**
 * Tworzy brakujące kubełki i ustawia CORS. Można uruchamiać wielokrotnie.
 * Odmawia (CliError) dla serwera S3 spoza tej maszyny i dla NODE_ENV=production.
 */
export async function setupStorage(env: InfraEnv): Promise<void> {
  assertStorageAllowed(env);
  const client = createS3Client(env);
  try {
    for (const bucket of [env.S3_BUCKET_MEDIA, env.S3_BUCKET_DOCUMENTS]) {
      await ensureBucket(client, env, bucket);
    }
    await applyMediaCors(client, env);
  } finally {
    client.destroy();
  }
}
