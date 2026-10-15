'use client';

import type { PublicAuctionDto } from '@biddy/api-client';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Galeria przedmiotu (F-18): zdjęcie główne w kwadratowej ramce (bez przeskoku układu), miniatury
 * i przyciski poprzednie/następne. Pierwsze zdjęcie to zwykle LCP strony, więc ładuje się
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
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-muted-foreground">
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
          className="aspect-square w-full rounded-lg bg-muted object-contain"
        />
        {count > 1 ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute top-1/2 left-2 -translate-y-1/2 bg-background/90"
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
              className="absolute top-1/2 right-2 -translate-y-1/2 bg-background/90"
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
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((photo, position) => (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                aria-label={t('show', { index: position + 1 })}
                aria-current={position === index ? 'true' : undefined}
                className={cn(
                  'block size-16 overflow-hidden rounded-md border-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  position === index ? 'border-primary' : 'border-transparent',
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
