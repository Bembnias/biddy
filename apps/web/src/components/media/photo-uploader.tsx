'use client';

import { type MediaDto, deleteMedia, isApiError } from '@biddy/api-client';
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ACCEPTED_IMAGE_TYPES, UploadError, uploadPhoto } from '@/lib/media/upload';

export const MAX_ITEM_PHOTOS = 20;

type EntryState = 'uploading' | 'processing' | 'ready' | 'flagged' | 'failed';

interface Entry {
  readonly key: string;
  readonly name: string;
  readonly state: EntryState;
  readonly progress: number;
  readonly media?: MediaDto;
  readonly error?: string;
}

let counter = 0;

/**
 * Zdjęcia przedmiotu (F-12; kreator w F-14): wiele plików naraz, postęp, przetwarzanie
 * w workerze, zdjęcie główne (pierwsze), kolejność przyciskami i usuwanie. `onChange` dostaje
 * identyfikatory gotowych zdjęć w kolejności.
 */
export function PhotoUploader({
  max = MAX_ITEM_PHOTOS,
  onChange,
}: {
  readonly max?: number;
  readonly onChange?: (mediaIds: string[]) => void;
}) {
  const t = useTranslations('media');
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const notify = useEffectEvent((mediaIds: string[]) => {
    onChange?.(mediaIds);
  });

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
    setEntries((current) => [
      ...current,
      { key, name: file.name, state: 'uploading', progress: 0 },
    ]);
    uploadPhoto(
      file,
      'ITEM_PHOTO',
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
          track('photo_uploaded', { purpose: 'ITEM_PHOTO' });
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
    setEntries((current) => current.filter((candidate) => candidate.key !== entry.key));
    if (entry.media !== undefined) {
      // Nieużyte zdjęcie i tak zniknie przy sprzątaniu po dobie; błąd usunięcia pomijamy.
      deleteMedia(entry.media.id).catch(() => undefined);
    }
  };

  const full = entries.length >= max;
  const hintId = `${inputId}-hint`;
  return (
    <section aria-labelledby={`${inputId}-title`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${inputId}-title`} className="text-lg font-semibold">
          {t('uploader.count', { count: entries.length, max })}
        </h2>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          multiple
          className="sr-only"
          aria-label={t('uploader.add')}
          aria-describedby={hintId}
          disabled={full}
          onChange={(event) => {
            add(event.target.files);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={full}
          onClick={() => input.current?.click()}
          aria-controls={inputId}
        >
          <ImagePlus aria-hidden />
          {t('uploader.add')}
        </Button>
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        {full ? t('uploader.limit', { max }) : t('uploader.hint')}
      </p>
      {entries.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {entries.map((entry, index) => {
            const position = index + 1;
            return (
              <li key={entry.key} className="space-y-2 rounded-lg border border-border bg-card p-2">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted text-center text-sm">
                  {entry.state === 'ready' && entry.media?.urls?.thumb !== undefined ? (
                    // Gotowa miniatura WebP z CDN.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.media.urls.thumb}
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
                        className="h-2 w-full overflow-hidden rounded-full bg-border"
                      >
                        <div
                          className="h-full bg-primary"
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
                  {index === 0 && entry.state === 'ready' ? (
                    <Badge className="absolute top-2 left-2">{t('uploader.cover')}</Badge>
                  ) : null}
                </div>
                <div className="flex justify-between gap-1">
                  <div className="flex gap-1">
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
