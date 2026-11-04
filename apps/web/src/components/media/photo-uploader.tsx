'use client';

import {
  type CreateUploadDtoPurpose,
  type MediaDto,
  deleteMedia,
  isApiError,
} from '@biddy/api-client';
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { ACCEPTED_IMAGE_TYPES, UploadError, uploadPhoto } from '@/lib/media/upload';
import { cn } from '@/lib/utils';

export const MAX_ITEM_PHOTOS = 20;

type EntryState = 'uploading' | 'processing' | 'ready' | 'flagged' | 'failed';

interface Entry {
  readonly key: string;
  readonly name: string;
  readonly state: EntryState;
  readonly progress: number;
  readonly media?: Pick<MediaDto, 'id'> & { readonly urls?: { readonly thumb?: string } | null };
  /** Podgląd z pliku w przeglądarce: zdjęcia prywatne (spory) nie mają adresów publicznych. */
  readonly preview?: string;
  readonly error?: string;
}

/** Zdjęcie już zapisane (np. w szkicu aukcji): identyfikator i miniatura. */
export interface ExistingPhoto {
  readonly id: string;
  readonly thumbUrl: string;
}

let counter = 0;

/** Adres podglądu pliku albo undefined (np. środowisko bez `URL.createObjectURL`). */
function filePreview(file: File): string | undefined {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
}

function revokePreview(entry: Entry): void {
  if (entry.preview !== undefined && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(entry.preview);
  }
}

/**
 * Zdjęcia przedmiotu (F-12; kreator w F-14): wiele plików naraz, postęp, przetwarzanie
 * w workerze, zdjęcie główne (pierwsze), kolejność przyciskami i usuwanie. `onChange` dostaje
 * identyfikatory gotowych zdjęć w kolejności. `initial`: zdjęcia już zapisane (szkic aukcji);
 * `deleteOnRemove={false}`: usunięte zdjęcie zwalnia dopiero zapis właściciela (szkic).
 * Zdjęcia ze sporu (F-28, `purpose="DISPUTE_EVIDENCE"`) i z wiadomości (F-29, `MESSAGE_PHOTO`) są
 * prywatne: bez zdjęcia głównego i kolejności, z podglądem z pliku.
 */
export function PhotoUploader({
  max = MAX_ITEM_PHOTOS,
  initial = [],
  deleteOnRemove = true,
  purpose = 'ITEM_PHOTO',
  hint,
  onChange,
  describedBy,
}: {
  readonly max?: number;
  readonly initial?: readonly ExistingPhoto[];
  readonly deleteOnRemove?: boolean;
  readonly purpose?: Extract<
    CreateUploadDtoPurpose,
    'ITEM_PHOTO' | 'DISPUTE_EVIDENCE' | 'MESSAGE_PHOTO'
  >;
  /** Podpowiedź pod przyciskiem zamiast domyślnej (zdjęcia przedmiotu). */
  readonly hint?: string;
  readonly onChange?: (mediaIds: string[]) => void;
  /** Dodatkowy opis pola dodawania (np. błąd kroku kreatora). */
  readonly describedBy?: string | undefined;
}) {
  const ordered = purpose === 'ITEM_PHOTO';
  const t = useTranslations('media');
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<readonly Entry[]>(() =>
    initial.map((photo) => ({
      key: `saved-${photo.id}`,
      name: photo.id,
      state: 'ready',
      progress: 1,
      media: { id: photo.id, urls: { thumb: photo.thumbUrl } },
    })),
  );
  const notify = useEffectEvent((mediaIds: string[]) => {
    onChange?.(mediaIds);
  });
  // Podglądy z plików zwalniamy przy odmontowaniu (ostatni znany stan listy).
  const previews = useRef<readonly Entry[]>([]);
  useEffect(() => {
    previews.current = entries;
  }, [entries]);
  useEffect(
    () => () => {
      previews.current.forEach(revokePreview);
    },
    [],
  );

  const readyIds = entries
    .filter((entry) => entry.state === 'ready' && entry.media !== undefined)
    .map((entry) => entry.media?.id ?? '');
  const readyKey = readyIds.join(',');
  useEffect(() => {
    notify(readyKey === '' ? [] : readyKey.split(','));
  }, [readyKey]);

  const update = (key: string, patch: Partial<Entry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  };

  const start = (file: File) => {
    counter += 1;
    const key = `photo-${String(counter)}`;
    const preview = ordered ? undefined : filePreview(file);
    setEntries((current) => [
      ...current,
      {
        key,
        name: file.name,
        state: 'uploading',
        progress: 0,
        ...(preview === undefined ? {} : { preview }),
      },
    ]);
    uploadPhoto(
      file,
      purpose,
      (progress) => {
        update(key, progress >= 1 ? { progress, state: 'processing' } : { progress });
      },
      (media) => {
        update(key, { media });
      },
    )
      .then((media) => {
        if (media.status === 'READY') {
          update(key, { media, state: 'ready' });
          track('photo_uploaded', { purpose });
        } else if (media.status === 'FLAGGED') {
          update(key, { media, state: 'flagged' });
        } else {
          update(key, {
            media,
            state: 'failed',
            error: media.rejectionReason ?? t('errors.upload'),
          });
          track('photo_rejected', { reason: 'processing' });
        }
      })
      .catch((caught: unknown) => {
        const error =
          caught instanceof UploadError
            ? t(`errors.${caught.kind}`)
            : isApiError(caught) && caught.problem !== undefined
              ? caught.problem.detail
              : t('errors.upload');
        update(key, { state: 'failed', error });
      });
  };

  const add = (files: FileList | null) => {
    const room = max - entries.length;
    for (const file of [...(files ?? [])].slice(0, Math.max(0, room))) {
      start(file);
    }
    if (input.current !== null) {
      input.current.value = '';
    }
  };

  const move = (index: number, offset: -1 | 1) => {
    setEntries((current) => {
      const next = [...current];
      const [entry] = next.splice(index, 1);
      if (entry !== undefined) {
        next.splice(index + offset, 0, entry);
      }
      return next;
    });
  };

  const remove = (entry: Entry) => {
    revokePreview(entry);
    setEntries((current) => current.filter((candidate) => candidate.key !== entry.key));
    if (entry.media !== undefined && deleteOnRemove) {
      // Nieużyte zdjęcie i tak zniknie przy sprzątaniu po dobie; błąd usunięcia pomijamy.
      deleteMedia(entry.media.id).catch(() => undefined);
    }
  };

  const full = entries.length >= max;
  const hintId = `${inputId}-hint`;
  return (
    <section aria-labelledby={`${inputId}-title`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${inputId}-title`} className="text-title tabular-nums">
          {t('uploader.count', { count: entries.length, max })}
        </h3>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          className="sr-only"
          aria-label={t('uploader.add')}
          aria-describedby={describedBy === undefined ? hintId : `${hintId} ${describedBy}`}
          disabled={full}
          onChange={(event) => {
            add(event.target.files);
          }}
        />
        <Button
          type="button"
          variant="accent"
          disabled={full}
          onClick={() => input.current?.click()}
          aria-controls={inputId}
        >
          <ImagePlus aria-hidden />
          {t('uploader.add')}
        </Button>
      </div>
      <p id={hintId} className="text-body-sm text-muted-foreground">
        {full ? t('uploader.limit', { max }) : (hint ?? t('uploader.hint'))}
      </p>
      {entries.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {entries.map((entry, index) => {
            const position = index + 1;
            return (
              <li
                key={entry.key}
                className={cn(
                  'space-y-2 rounded-xl border border-border bg-card p-2 shadow-xs',
                  ordered &&
                    index === 0 &&
                    entry.state === 'ready' &&
                    'border-brand ring-2 ring-brand',
                )}
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted text-center text-body-sm">
                  {entry.state === 'ready' &&
                  (entry.media?.urls?.thumb ?? entry.preview) !== undefined ? (
                    // Gotowa miniatura WebP z CDN albo podgląd pliku (zdjęcia prywatne).
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.media?.urls?.thumb ?? entry.preview}
                      alt={t('uploader.photo', { position })}
                      className="size-full object-cover"
                    />
                  ) : entry.state === 'uploading' ? (
                    <div className="w-full space-y-2 px-3">
                      <div
                        role="progressbar"
                        aria-label={t('uploader.uploading', { name: entry.name })}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(entry.progress * 100)}
                        className="h-2 w-full overflow-hidden rounded-full bg-ink-200"
                      >
                        <div
                          className="h-full bg-brand-strong"
                          style={{ width: `${String(Math.round(entry.progress * 100))}%` }}
                        />
                      </div>
                    </div>
                  ) : entry.state === 'processing' ? (
                    <span>{t('uploader.processing')}</span>
                  ) : entry.state === 'flagged' ? (
                    <span className="px-2">{t('uploader.flagged')}</span>
                  ) : (
                    <span role="alert" className="px-2 text-destructive">
                      {entry.error}
                    </span>
                  )}
                  {ordered && index === 0 && entry.state === 'ready' ? (
                    <span className="absolute top-2 left-2 rounded-full bg-brand-strong px-2.5 py-0.5 text-caption font-extrabold text-primary-foreground">
                      {t('uploader.cover')}
                    </span>
                  ) : null}
                </div>
                <div className={cn('flex gap-1', ordered ? 'justify-between' : 'justify-end')}>
                  <div className={cn('flex gap-1', !ordered && 'hidden')}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={t('uploader.moveLeft', { position })}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      <ArrowLeft aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === entries.length - 1}
                      aria-label={t('uploader.moveRight', { position })}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      <ArrowRight aria-hidden />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('uploader.remove', { position })}
                    onClick={() => {
                      remove(entry);
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
