import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Karta pozycji Moje Biddy (F-62, `ListingCard` z design systemu): u góry stan i informacja
 * z prawej (np. koniec aukcji), w środku przedmiot z ceną, na dole następny krok. Renderuje `<li>`,
 * więc stoi w liście `<ul>`.
 */
export function ListingCard({
  status,
  aside,
  imageUrl,
  noPhotoLabel,
  title,
  meta,
  priceLabel,
  price,
  actions,
  className,
}: {
  readonly status: ReactNode;
  readonly aside?: ReactNode;
  readonly imageUrl: string | null;
  /** Tekst dla czytników, gdy aukcja nie ma zdjęcia. */
  readonly noPhotoLabel: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly priceLabel?: string;
  readonly price?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  return (
    <li className={cn('rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">{status}</div>
        {aside === undefined ? null : (
          <div className="text-body-sm text-muted-foreground">{aside}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:flex-nowrap sm:px-5">
        {imageUrl === null ? (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ImageOff aria-hidden className="size-5" />
            <span className="sr-only">{noPhotoLabel}</span>
          </div>
        ) : (
          // Gotowy wariant WebP z CDN (F-12).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="size-16 shrink-0 rounded-md bg-muted object-cover ring-1 ring-border"
          />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-title break-words">{title}</div>
          {meta === undefined ? null : (
            <div className="text-body-sm text-muted-foreground">{meta}</div>
          )}
        </div>
        {price === undefined ? null : (
          <p className="ml-auto shrink-0 text-right">
            {priceLabel === undefined ? null : (
              <span className="block text-caption text-muted-foreground">{priceLabel}</span>
            )}{' '}
            <span className="block text-price-lg tabular-nums">{price}</span>
          </p>
        )}
      </div>
      {actions === undefined || actions === null ? null : (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3 sm:px-5">
          {actions}
        </div>
      )}
    </li>
  );
}

/** Przycisk filtra listy (pigułka): wybrany ma wypełnienie marki, jak aktywna zakładka. */
export function filterPillClasses(pressed: boolean): string {
  return cn(
    'rounded-full',
    pressed &&
      'border-brand-strong bg-brand-strong text-primary-foreground shadow-sm hover:border-brand-strong hover:bg-brand-strong',
  );
}
