'use client';

import type { PublicAuctionDto } from '@biddy/api-client';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Galeria przedmiotu (F-18, wygląd F-62): zdjęcie główne w kwadratowej ramce (bez przeskoku
 * układu, całe zdjęcie widoczne), licznik zdjęć, miniatury i przyciski poprzednie/następne. Pierwsze zdjęcie to zwykle LCP strony, więc ładuje się
 * z wysokim priorytetem; warianty WebP 800 i 1600 px (F-12) wybiera przeglądarka.
 */
export function AuctionGallery({
  title,
  photos,
}: {
  readonly title: string;
  readonly photos: PublicAuctionDto['photos'];
}) {
  const t = useTranslations('auction.gallery');
  const [index, setIndex] = useState(0);
  const count = photos.length;
  const current = photos[Math.min(index, count - 1)];

  if (current === undefined) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground">
        <ImageOff aria-hidden className="size-10" />
        <p>{t('noPhotos')}</p>
      </div>
    );
  }

  const show = (next: number) => {
    setIndex((next + count) % count);
  };

  return (
    <section aria-label={t('label')} className="space-y-3">
      <div className="relative">
        {/* Gotowe warianty WebP z CDN (F-12); optymalizacja Next.js tylko by je przeliczała. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.id}
          src={current.urls.medium}
          srcSet={`${current.urls.medium} 800w, ${current.urls.large} 1600w`}
          sizes="(min-width: 1024px) 640px, 100vw"
          alt={t('photo', { index: index + 1, count, title })}
          fetchPriority={index === 0 ? 'high' : 'auto'}
          decoding="async"
          className="aspect-square w-full rounded-xl bg-muted object-contain"
        />
        {count > 1 ? (
          <span
            aria-hidden
            className="absolute right-4 bottom-4 rounded-full bg-ink-950/60 px-2.5 py-0.5 text-caption text-primary-foreground tabular-nums"
          >
            {index + 1} / {count}
          </span>
        ) : null}
        {count > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute top-1/2 left-3 -translate-y-1/2 border-transparent bg-card shadow-sm hover:bg-card hover:text-brand-strong"
              aria-label={t('previous')}
              onClick={() => {
                show(index - 1);
              }}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute top-1/2 right-3 -translate-y-1/2 border-transparent bg-card shadow-sm hover:bg-card hover:text-brand-strong"
              aria-label={t('next')}
              onClick={() => {
                show(index + 1);
              }}
            >
              <ChevronRight aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <ul className="flex gap-3 overflow-x-auto p-0.5 pb-1">
          {photos.map((photo, position) => (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                aria-label={t('show', { index: position + 1 })}
                aria-current={position === index ? 'true' : undefined}
                className={cn(
                  'block size-18 overflow-hidden rounded-md border-2 bg-muted outline-none focus-visible:shadow-focus-ring',
                  position === index
                    ? 'border-brand'
                    : 'border-transparent opacity-80 hover:opacity-100',
                )}
                onClick={() => {
                  show(position);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.urls.thumb}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
