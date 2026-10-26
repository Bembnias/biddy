import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Kwota w karcie: etykieta nad liczbą („Aktualna cena”, „Twoje maksimum”). */
export interface ListingPrice {
  readonly label: string;
  readonly value: string;
  /** Kwota pomocnicza (np. Twoje maksimum): spokojniejszy kolor. */
  readonly muted?: boolean;
}

/** Miniatura pozycji listy: gotowy wariant WebP z CDN (F-12) albo ikona „brak zdjęcia”. */
export function ListingThumb({
  imageUrl,
  noPhotoLabel,
  className,
}: {
  readonly imageUrl: string | null;
  /** Tekst dla czytników, gdy aukcja nie ma zdjęcia. */
  readonly noPhotoLabel: string;
  readonly className?: string;
}) {
  return imageUrl === null ? (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground',
        className,
      )}
    >
      <ImageOff aria-hidden className="size-5" />
      <span className="sr-only">{noPhotoLabel}</span>
    </div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      className={cn('shrink-0 rounded-lg bg-muted object-cover ring-1 ring-border', className)}
    />
  );
}

/**
 * Karta pozycji Moje Biddy (F-62, układ „Puls licytacji” F-63): u góry pasek stanu z licznikiem
 * po prawej, w środku przedmiot z kwotami, na dole następny krok. Ton `urgent` (przebito Cię)
 * dostaje czerwoną ramkę i tło paska. Renderuje `<li>`, więc stoi w liście `<ul>`.
 */
export function ListingCard({
  tone = 'default',
  status,
  aside,
  imageUrl,
  noPhotoLabel,
  title,
  meta,
  prices = [],
  actions,
  className,
}: {
  readonly tone?: 'default' | 'urgent';
  readonly status: ReactNode;
  readonly aside?: ReactNode;
  readonly imageUrl: string | null;
  readonly noPhotoLabel: string;
  readonly title: ReactNode;
  readonly meta?: ReactNode;
  readonly prices?: readonly ListingPrice[];
  readonly actions?: ReactNode;
  readonly className?: string;
}) {
  const urgent = tone === 'urgent';
  return (
    <li
      data-tone={tone}
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        urgent ? 'border-red-200' : 'border-border',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-2.5 sm:px-5 sm:py-3',
          urgent ? 'border-red-100 bg-red-50' : 'border-ink-100',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">{status}</div>
        {aside === undefined || aside === null ? null : <div className="shrink-0">{aside}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5">
        <ListingThumb
          imageUrl={imageUrl}
          noPhotoLabel={noPhotoLabel}
          className="size-16 sm:size-22"
        />
        <div className="min-w-0 flex-[1_1_12rem] space-y-0.5">
          <div className="text-title break-words">{title}</div>
          {meta === undefined ? null : (
            <div className="text-body-sm text-muted-foreground">{meta}</div>
          )}
        </div>
        {prices.length === 0 ? null : (
          <dl className="flex flex-wrap gap-x-7 gap-y-2">
            {prices.map((price) => (
              <div key={price.label} className="flex flex-col">
                <dt className="text-overline text-muted-foreground uppercase">{price.label}</dt>
                <dd
                  className={cn(
                    'text-price-lg tabular-nums',
                    price.muted === true && 'text-foreground-secondary',
                  )}
                >
                  {price.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {actions === undefined || actions === null ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2.5 px-4 pb-4 max-sm:*:flex-1 sm:px-5">
          {actions}
        </div>
      )}
    </li>
  );
}

/**
 * Zwarta pozycja listy (F-63): przegrane licytacje i sprzedane. Kafelek stanu, miniatura, tytuł
 * z linią stanu w tonie, kwota i jedna akcja.
 */
export function CompactRow({
  tile,
  imageUrl,
  noPhotoLabel,
  title,
  line,
  price,
  action,
  dimmed = false,
  className,
}: {
  readonly tile?: ReactNode;
  readonly imageUrl: string | null;
  readonly noPhotoLabel: string;
  readonly title: ReactNode;
  readonly line: ReactNode;
  readonly price?: string;
  readonly action?: ReactNode;
  /** Zakończona bez wygranej: przygaszona miniatura. */
  readonly dimmed?: boolean;
  readonly className?: string;
}) {
  return (
    <li
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5', className)}
    >
      {tile}
      <ListingThumb
        imageUrl={imageUrl}
        noPhotoLabel={noPhotoLabel}
        className={cn('size-12 sm:size-14', dimmed && 'opacity-85')}
      />
      <div className="min-w-0 flex-[1_1_12rem]">
        <div className="text-title break-words">{title}</div>
        <div className="text-body-sm">{line}</div>
      </div>
      {price === undefined ? null : (
        <p className="text-price tabular-nums max-sm:ml-auto">{price}</p>
      )}
      {action === undefined || action === null ? null : (
        <div className="max-sm:w-full max-sm:*:w-full">{action}</div>
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
