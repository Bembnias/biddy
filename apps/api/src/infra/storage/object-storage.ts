// Magazyn plików S3 (F-12): Cloudflare R2 na produkcji, lokalnie RustFS. Moduły używają
// interfejsu ObjectStorage (OBJECT_STORAGE), a nie SDK AWS, więc w testach i przy zmianie
// dostawcy wystarczy inna implementacja.
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { StorageConfig } from '../config/index.js';

export interface PresignPutOptions {
  readonly contentType: string;
  /** Dokładny rozmiar pliku w bajtach (podpisany: inny rozmiar magazyn odrzuci). */
  readonly contentLength: number;
  readonly expiresInSeconds: number;
}

export interface StoredObject {
  readonly size: number;
  readonly contentType: string | undefined;
}

export interface ObjectStorage {
  /** Adres presigned PUT: klient musi wysłać dokładnie te nagłówki Content-Type i Content-Length. */
  presignPut(bucket: string, key: string, options: PresignPutOptions): Promise<string>;
  head(bucket: string, key: string): Promise<StoredObject | undefined>;
  get(bucket: string, key: string): Promise<Buffer | undefined>;
  put(
    bucket: string,
    key: string,
    body: Buffer,
    options: { readonly contentType: string; readonly cacheControl?: string },
  ): Promise<void>;
  /** Usuwa obiekty (brakujące pomija). */
  delete(bucket: string, keys: readonly string[]): Promise<void>;
}

/** Token DI {@link ObjectStorage}. */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NotFound' ||
      error.name === 'NoSuchKey' ||
      error.$metadata.httpStatusCode === 404)
  );
}

/** Limit DeleteObjects (S3 i R2). */
const DELETE_BATCH = 1000;

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Bez domyślnych sum kontrolnych SDK: presigned PUT z przeglądarki nie zna sumy pliku,
      // a R2 zaleca to ustawienie dla zgodności.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  presignPut(bucket: string, key: string, options: PresignPutOptions): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
      }),
      {
        expiresIn: options.expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  async head(bucket: string, key: string): Promise<StoredObject | undefined> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async get(bucket: string, key: string): Promise<Buffer | undefined> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await result.Body?.transformToByteArray();
      return bytes === undefined ? undefined : Buffer.from(bytes);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async put(
    bucket: string,
    key: string,
    body: Buffer,
    options: { readonly contentType: string; readonly cacheControl?: string },
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ...(options.cacheControl === undefined ? {} : { CacheControl: options.cacheControl }),
      }),
    );
  }

  async delete(bucket: string, keys: readonly string[]): Promise<void> {
    for (let start = 0; start < keys.length; start += DELETE_BATCH) {
      const batch = keys.slice(start, start + DELETE_BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
    }
  }

  destroy(): void {
    this.client.destroy();
  }
}
