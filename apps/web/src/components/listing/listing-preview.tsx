'use client';

import type { ListingDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { CircleCheck, ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { type ListingFormValues, type ListingStepId, parsePrice } from '@/lib/listing/form';
import { cn } from '@/lib/utils';

/** Kroki z polami oferty (bez podglądu) i ich podpis na liście obok podglądu. */
const CHECKLIST: readonly Exclude<ListingStepId, 'podglad'>[] = [
  'zdjecia',
  'kategoria',
  'opis',
  'dostawa',
  'cena',
];

/**
 * Podgląd aukcji obok kreatora od 1024 px (F-63, D5): karta, jak zobaczą ją kupujący (zdjęcie
 * główne, czas trwania, tytuł, kategoria, marka i stan, cena wywoławcza; puste pola jako szare
 * paski), i lista kroków z ✓ dla kroków bez braków.
 */
export function ListingPreview({
  listing,
  values,
  categoryName,
  completed,
}: {
  readonly listing: ListingDto;
  readonly values: ListingFormValues;
  readonly categoryName: string | undefined;
  /** Kroki bez braków (undefined, dopóki kreator nie ma kategorii i przewoźników). */
  readonly completed: ReadonlySet<ListingStepId> | undefined;
}) {
  const t = useTranslations('listing.preview');
  const pricing = useTranslations('listing.pricing');
  const details = useTranslations('listing.details');
  const cover = listing.photos.find((photo) => photo.id === values.mediaIds[0])?.urls?.medium;
  const days = Number(values.durationDays);
  const price = parsePrice(values.startPrice);
  const title = values.title.trim();
  const meta = [
    categoryName,
    values.brand.trim(),
    values.condition === '' ? '' : details(`conditions.${values.condition as 'NEW'}`),
  ]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ');
  return (
    <aside
      aria-labelledby="listing-preview-title"
      className="sticky top-22 hidden flex-col gap-3.5 lg:flex"
    >
      <h2 id="listing-preview-title" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-3 pb-4">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
          {cover === undefined ? (
            <span className="grid size-full place-items-center text-muted-foreground">
              <ImageOff aria-hidden className="size-8" />
            </span>
          ) : (
            // Zdjęcie WebP z CDN.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="size-full object-cover" />
          )}
          {Number.isInteger(days) && days > 0 ? (
            <span className="absolute top-2.5 left-2.5 rounded-full bg-card px-2.5 py-1 text-caption font-bold shadow-xs">
              {pricing('days', { count: days })}
            </span>
          ) : null}
        </div>
        <div className="space-y-1.5 px-1">
          {title === '' ? (
            <span aria-hidden className="block h-3.5 w-4/5 rounded-md bg-ink-200" />
          ) : (
            <p className="line-clamp-2 text-title break-words">{title}</p>
          )}
          {meta === '' ? null : <p className="text-body-sm text-muted-foreground">{meta}</p>}
          {typeof price === 'number' ? (
            <p className="text-price tabular-nums">
              {formatMoney(money(price), { trailingZeroDisplay: 'stripIfInteger' })}
            </p>
          ) : (
            <span aria-hidden className="mt-1 block h-5.5 w-2/5 rounded-md bg-ink-200" />
          )}
        </div>
      </div>
      <ul className="space-y-2.5 rounded-2xl border border-border bg-card p-4.5">
        {CHECKLIST.map((step) => {
          const done = completed?.has(step) === true;
          return (
            <li
              key={step}
              className={cn(
                'flex items-center gap-2.5 text-label',
                done ? 'text-success' : 'text-foreground-secondary',
              )}
            >
              {done ? (
                <CircleCheck aria-hidden className="size-4.5 shrink-0" />
              ) : (
                <span
                  aria-hidden
                  className="size-4.5 shrink-0 rounded-full border-2 border-border-strong"
                />
              )}
              <span className="sr-only">{done ? t('done') : t('todo')} </span>
              {step === 'zdjecia' && values.mediaIds.length > 0
                ? t('photos', { count: values.mediaIds.length })
                : t(`steps.${step}`)}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
