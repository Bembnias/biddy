// RustFS w kontenerze dla testów zdjęć (F-12): ten sam obraz co infra/docker-compose.yml,
// kubełki jak po `pnpm storage:setup` (media z publicznym odczytem, uploads prywatny).
import {
  CreateBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

const RUSTFS_IMAGE = 'rustfs/rustfs:1.0.1';
const ACCESS_KEY = 'biddy-test';
const SECRET_KEY = 'biddy-test-secret';
export const MEDIA_BUCKET = 'biddy-media';
export const UPLOADS_BUCKET = 'biddy-uploads';

export interface TestS3 {
  readonly endpoint: string;
  /** Zmienne konfiguracji API i workera dla tego magazynu. */
  readonly env: Record<string, string>;
  readonly client: S3Client;
  /** Czy obiekt istnieje (zapytanie z kluczami, nie anonimowe). */
  exists(bucket: string, key: string): Promise<boolean>;
  stop(): Promise<void>;
}

export async function startS3(): Promise<TestS3> {
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(RUSTFS_IMAGE)
      .withEnvironment({ RUSTFS_ACCESS_KEY: ACCESS_KEY, RUSTFS_SECRET_KEY: SECRET_KEY })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/health/ready', 9000).forStatusCode(200))
      .start();
  } catch (error) {
    throw new Error(
      `Nie udało się uruchomić kontenera ${RUSTFS_IMAGE} (przyczyna niżej). Testy zdjęć wymagają Dockera.`,
      { cause: error },
    );
  }
  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(9000))}`;
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  for (const bucket of [MEDIA_BUCKET, UPLOADS_BUCKET]) {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: MEDIA_BUCKET,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${MEDIA_BUCKET}/*`],
          },
        ],
      }),
    }),
  );
  return {
    endpoint,
    client,
    env: {
      S3_ENDPOINT: endpoint,
      S3_ACCESS_KEY_ID: ACCESS_KEY,
      S3_SECRET_ACCESS_KEY: SECRET_KEY,
      S3_BUCKET_MEDIA: MEDIA_BUCKET,
      S3_BUCKET_UPLOADS: UPLOADS_BUCKET,
    },
    exists: async (bucket, key) => {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    stop: async () => {
      client.destroy();
      await container.stop();
    },
  };
}
