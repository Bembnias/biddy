// Zdjęcia (F-12): upload przez presigned PUT do prywatnego kubełka, przetwarzanie w workerze
// (kolejka `media`), moderacja, publikacja wariantów w publicznym kubełku i sprzątanie. Zdjęcia ze
// sporu (F-28) nie mają publicznych adresów: ich warianty zostają w prywatnym kubełku, a wydaje je
// moduł disputes (`privateVariant`) stronom sporu.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../infra/config/index.js';
import { type Database, DRIZZLE, newId, type Transaction } from '../../infra/db/index.js';
import { DomainError } from '../../infra/http/index.js';
import { Outbox } from '../../infra/outbox/index.js';
import { JobHandler, JobQueues, type JobRun, ScheduledJob } from '../../infra/queues/index.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infra/storage/index.js';
import {
  type Media,
  type MediaPurpose,
  type MediaStatus,
  media,
  PRIVATE_MEDIA_PURPOSES,
} from './db/media.schema.js';
import { MediaFlagged } from './media.events.js';
import { incomingKey, quarantineKey, variantKey } from './media-keys.js';
import { IMAGE_MODERATOR, type ImageModerator } from './processing/image-moderator.js';
import { ImageRejectedError, PURPOSE_SPECS, processImage } from './processing/image-processing.js';

/** Typy przyjmowane przy uploadzie (HEIC z iPhone'a Safari zamienia na JPEG). */
export const ACCEPTED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedContentType = (typeof ACCEPTED_CONTENT_TYPES)[number];

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const UPLOADS_PER_HOUR = 50;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const HOUR_MS = 60 * 60 * 1_000;
/** Nieprzypisane zdjęcia znikają po dobie; zatrzymane przez moderację czekają 30 dni (F-35). */
const ORPHAN_AGE_MS = 24 * HOUR_MS;
const FLAGGED_RETENTION_MS = 30 * 24 * HOUR_MS;
const CLEANUP_BATCH = 500;
/** Warianty mają klucze z identyfikatorem zdjęcia, więc nigdy się nie zmieniają. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

export const PROCESS_MEDIA_JOB = 'media.process';

export interface UploadTarget {
  readonly url: string;
  readonly method: 'PUT';
  /** Nagłówki, które klient musi wysłać (Content-Length ustawia przeglądarka). */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zdjęcia.' });
}

/** Zdjęcie z publicznymi adresami wariantów (null, gdy nie jest READY). */
export interface MediaDescription {
  readonly id: string;
  readonly purpose: MediaPurpose;
  readonly status: MediaStatus;
  readonly urls: Record<string, string> | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IMAGE_MODERATOR) private readonly moderator: ImageModerator,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queues: JobQueues,
    private readonly outbox: Outbox,
  ) {}

  /** Nowe zdjęcie i adres presigned PUT do prywatnego kubełka (ważny 15 minut). */
  async createUpload(
    ownerId: string,
    input: {
      readonly purpose: MediaPurpose;
      readonly contentType: AcceptedContentType;
      readonly sizeBytes: number;
    },
    now = new Date(),
  ): Promise<{ media: Media; upload: UploadTarget }> {
    const [{ count } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(media)
      .where(
        and(eq(media.ownerId, ownerId), gte(media.createdAt, new Date(now.getTime() - HOUR_MS))),
      );
    if (count >= UPLOADS_PER_HOUR) {
      throw new DomainError({
        code: 'RATE_LIMITED',
        detail: `Możesz dodać najwyżej ${String(UPLOADS_PER_HOUR)} zdjęć na godzinę. Spróbuj później.`,
        headers: { 'retry-after': '3600' },
      });
    }
    const [created] = await this.db
      .insert(media)
      .values({
        id: newId(),
        ownerId,
        purpose: input.purpose,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        createdAt: now,
      })
      .returning();
    if (created === undefined) {
      throw new Error('INSERT zdjęcia nie zwrócił wiersza');
    }
    const url = await this.storage.presignPut(
      this.config.storage.uploadsBucket,
      incomingKey(ownerId, created.id),
      {
        contentType: input.contentType,
        contentLength: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      },
    );
    return {
      media: created,
      upload: {
        url,
        method: 'PUT',
        headers: { 'content-type': input.contentType },
        expiresAt: new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1_000),
      },
    };
  }

  /**
   * Plik jest w magazynie: zdjęcie trafia do przetwarzania. Idempotentne: zdjęcie w trakcie
   * przetwarzania albo przetworzone zwraca bez zmian.
   */
  async complete(ownerId: string, mediaId: string): Promise<Media> {
    const item = await this.owned(ownerId, mediaId);
    if (item.status !== 'PENDING_UPLOAD') {
      return item;
    }
    const stored = await this.storage.head(
      this.config.storage.uploadsBucket,
      incomingKey(ownerId, mediaId),
    );
    if (stored === undefined) {
      throw new DomainError({ code: 'MEDIA_NOT_UPLOADED' });
    }
    const [updated] = await this.db
      .update(media)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(eq(media.id, mediaId), eq(media.status, 'PENDING_UPLOAD')))
      .returning();
    await this.queues.add('media', PROCESS_MEDIA_JOB, { mediaId }, { jobId: `media-${mediaId}` });
    return updated ?? (await this.owned(ownerId, mediaId));
  }

  /** Zdjęcie właściciela; cudze albo nieistniejące: 404. */
  async owned(ownerId: string, mediaId: string): Promise<Media> {
    const [item] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, mediaId), eq(media.ownerId, ownerId)));
    if (item === undefined) {
      throw notFound();
    }
    return item;
  }

  /** Publiczne adresy wariantów; tylko dla zdjęć READY, które nie są prywatne. */
  publicUrls(item: Pick<Media, 'id' | 'purpose' | 'status'>): Record<string, string> | null {
    if (item.status !== 'READY' || PRIVATE_MEDIA_PURPOSES.has(item.purpose)) {
      return null;
    }
    return Object.fromEntries(
      PURPOSE_SPECS[item.purpose].variants.map((variant) => [
        variant.name,
        this.variantUrl(item.purpose, item.id, variant.name),
      ]),
    );
  }

  /** Publiczny adres wariantu (bez sprawdzania stanu; dla zdjęć przypisanych jako READY). */
  variantUrl(purpose: MediaPurpose, mediaId: string, variant: string): string {
    return `${this.config.storage.mediaPublicUrl}/${variantKey(purpose, mediaId, variant)}`;
  }

  /** Usunięcie nieprzypisanego zdjęcia przez właściciela. */
  async delete(ownerId: string, mediaId: string): Promise<void> {
    const item = await this.owned(ownerId, mediaId);
    if (item.attachedAt !== null) {
      throw new DomainError({
        code: 'CONFLICT',
        detail: 'Zdjęcie jest używane (np. w ofercie albo jako zdjęcie profilowe).',
      });
    }
    await this.removeFiles([item]);
    await this.db.delete(media).where(eq(media.id, mediaId));
  }

  /**
   * Oznacza zdjęcia jako użyte (przedmiot w F-14, zdjęcie profilowe). Każde musi należeć do
   * właściciela, mieć przeznaczenie `purpose` i status READY; inaczej 400 VALIDATION_FAILED.
   * Z `tx` działa w transakcji wywołującego (np. zapis szkicu aukcji).
   */
  async attach(
    ownerId: string,
    mediaIds: readonly string[],
    purpose: MediaPurpose,
    tx?: Transaction,
  ): Promise<void> {
    if (mediaIds.length === 0) {
      return;
    }
    const db = tx ?? this.db;
    const rows = await db
      .select({ id: media.id, status: media.status, purpose: media.purpose })
      .from(media)
      .where(and(eq(media.ownerId, ownerId), inArray(media.id, [...mediaIds])));
    const usable = new Set(
      rows.filter((row) => row.status === 'READY' && row.purpose === purpose).map((row) => row.id),
    );
    const invalid = mediaIds.filter((id) => !usable.has(id));
    if (invalid.length > 0) {
      throw new DomainError({
        code: 'VALIDATION_FAILED',
        detail: 'Część zdjęć nie jest gotowa albo nie należy do Ciebie.',
        errors: invalid.map((id) => ({
          path: 'mediaIds',
          code: 'custom',
          message: `Zdjęcie ${id} nie jest gotowe do użycia.`,
        })),
      });
    }
    await db
      .update(media)
      .set({ attachedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(media.id, [...mediaIds]), isNull(media.attachedAt)));
  }

  /** Zdjęcia przestają być użyte; znikną z kolejnym sprzątaniem. */
  async detach(ownerId: string, mediaIds: readonly string[], tx?: Transaction): Promise<void> {
    if (mediaIds.length === 0) {
      return;
    }
    await (tx ?? this.db)
      .update(media)
      .set({ attachedAt: null, updatedAt: new Date() })
      .where(and(eq(media.ownerId, ownerId), inArray(media.id, [...mediaIds])));
  }

  /**
   * Stan i publiczne adresy zdjęć właściciela w kolejności `mediaIds` (np. zdjęcia szkicu
   * aukcji). Zdjęć cudzych albo nieistniejących nie ma w wyniku.
   */
  async describe(
    ownerId: string,
    mediaIds: readonly string[],
    tx?: Transaction,
  ): Promise<MediaDescription[]> {
    if (mediaIds.length === 0) {
      return [];
    }
    const rows = await (tx ?? this.db)
      .select({ id: media.id, purpose: media.purpose, status: media.status })
      .from(media)
      .where(and(eq(media.ownerId, ownerId), inArray(media.id, [...mediaIds])));
    const byId = new Map(rows.map((row) => [row.id, row]));
    return mediaIds.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined
        ? []
        : [{ id, purpose: row.purpose, status: row.status, urls: this.publicUrls(row) }];
    });
  }

  /**
   * Wariant prywatnego zdjęcia READY (np. dowód w sporze) albo undefined. Bez sprawdzania
   * właściciela: dostęp sprawdza moduł, który zdjęcie przypisał (strony sporu).
   */
  async privateVariant(
    mediaId: string,
    variant: string,
  ): Promise<{ readonly data: Buffer; readonly contentType: string } | undefined> {
    const [item] = await this.db
      .select({ id: media.id, purpose: media.purpose, status: media.status })
      .from(media)
      .where(eq(media.id, mediaId));
    if (
      item?.status !== 'READY' ||
      !PRIVATE_MEDIA_PURPOSES.has(item.purpose) ||
      !PURPOSE_SPECS[item.purpose].variants.some((spec) => spec.name === variant)
    ) {
      return undefined;
    }
    const data = await this.storage.get(
      this.config.storage.uploadsBucket,
      variantKey(item.purpose, item.id, variant),
    );
    return data === undefined ? undefined : { data, contentType: 'image/webp' };
  }

  @JobHandler('media', PROCESS_MEDIA_JOB)
  async process(job: JobRun<{ mediaId: string }>): Promise<void> {
    const [item] = await this.db.select().from(media).where(eq(media.id, job.data.mediaId));
    if (item?.status !== 'PROCESSING') {
      return;
    }
    const { uploadsBucket, mediaBucket } = this.config.storage;
    const sourceKey = incomingKey(item.ownerId, item.id);
    const original = await this.storage.get(uploadsBucket, sourceKey);
    if (original === undefined) {
      await this.reject(item.id, 'Nie udało się odczytać pliku. Dodaj zdjęcie ponownie.');
      return;
    }
    let processed;
    try {
      processed = await processImage(original, item.purpose);
    } catch (error) {
      if (!(error instanceof ImageRejectedError)) {
        throw error;
      }
      await this.reject(item.id, error.reason);
      await this.storage.delete(uploadsBucket, [sourceKey]);
      return;
    }
    const { flagged, labels } = await this.moderator.moderate(processed.largest.data);
    const now = new Date();
    const dimensions = { width: processed.largest.width, height: processed.largest.height };
    if (flagged) {
      // Kopia do wglądu moderatora w prywatnym kubełku; nic nie trafia do publicznego.
      await this.storage.put(uploadsBucket, quarantineKey(item.id), processed.largest.data, {
        contentType: 'image/webp',
      });
      await this.db.transaction(async (tx) => {
        await tx
          .update(media)
          .set({
            status: 'FLAGGED',
            moderationLabels: [...labels],
            ...dimensions,
            processedAt: now,
            updatedAt: now,
          })
          .where(eq(media.id, item.id));
        await this.outbox.add(
          tx,
          MediaFlagged.create({
            aggregateId: item.id,
            payload: { ownerId: item.ownerId, purpose: item.purpose, labels: [...labels] },
          }),
        );
      });
      this.logger.warn({ mediaId: item.id, labels }, 'Zdjęcie zatrzymane przez moderację');
    } else {
      const isPrivate = PRIVATE_MEDIA_PURPOSES.has(item.purpose);
      for (const variant of processed.variants) {
        await this.storage.put(
          isPrivate ? uploadsBucket : mediaBucket,
          variantKey(item.purpose, item.id, variant.name),
          variant.data,
          isPrivate
            ? { contentType: 'image/webp' }
            : { contentType: 'image/webp', cacheControl: IMMUTABLE },
        );
      }
      await this.db
        .update(media)
        .set({ status: 'READY', ...dimensions, processedAt: now, updatedAt: now })
        .where(eq(media.id, item.id));
    }
    // Oryginał z EXIF nie jest już potrzebny.
    await this.storage.delete(uploadsBucket, [sourceKey]);
  }

  /**
   * Usuwa nieprzypisane zdjęcia starsze niż doba (zatrzymane przez moderację: 30 dni) razem
   * z plikami w obu kubełkach.
   */
  @ScheduledJob({ queue: 'maintenance', name: 'media.orphans-cleanup', every: HOUR_MS })
  async cleanup(): Promise<number> {
    const now = Date.now();
    const orphans = await this.db
      .select()
      .from(media)
      .where(
        and(
          isNull(media.attachedAt),
          or(
            and(ne(media.status, 'FLAGGED'), lt(media.createdAt, new Date(now - ORPHAN_AGE_MS))),
            and(
              eq(media.status, 'FLAGGED'),
              lt(media.createdAt, new Date(now - FLAGGED_RETENTION_MS)),
            ),
          ),
        ),
      )
      .limit(CLEANUP_BATCH);
    if (orphans.length === 0) {
      return 0;
    }
    await this.removeFiles(orphans);
    await this.db.delete(media).where(
      inArray(
        media.id,
        orphans.map((item) => item.id),
      ),
    );
    return orphans.length;
  }

  private async reject(mediaId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(media)
      .set({ status: 'REJECTED', rejectionReason: reason, processedAt: now, updatedAt: now })
      .where(eq(media.id, mediaId));
  }

  /** Pliki zdjęć we wszystkich miejscach: oryginał, kwarantanna, warianty. */
  private async removeFiles(items: readonly Media[]): Promise<void> {
    const { uploadsBucket, mediaBucket } = this.config.storage;
    const variants = (item: Media) =>
      PURPOSE_SPECS[item.purpose].variants.map((variant) =>
        variantKey(item.purpose, item.id, variant.name),
      );
    await this.storage.delete(
      uploadsBucket,
      items.flatMap((item) => [
        incomingKey(item.ownerId, item.id),
        quarantineKey(item.id),
        ...(PRIVATE_MEDIA_PURPOSES.has(item.purpose) ? variants(item) : []),
      ]),
    );
    await this.storage.delete(
      mediaBucket,
      items.flatMap((item) => (PRIVATE_MEDIA_PURPOSES.has(item.purpose) ? [] : variants(item))),
    );
  }
}
