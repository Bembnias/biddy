import type { AuctionSearchDto } from '@biddy/api-client';
import { ImageOff, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { shortMoney } from '@/lib/auction/auction-state';
import { auctionUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { CardHotBadge, CardHourBar, CardTimeBadge, CardTimer } from './card-signals';

export type AuctionCardData = AuctionSearchDto['items'][number];

/**
 * Karta aukcji (F-19, „Puls licytacji” F-63): kwadratowe zdjęcie z licznikiem w tonie (LIVE
 * w ostatniej godzinie) i „Gorąca”, tytuł, stan, cena z liczbą ofert i Kup teraz. Cała karta jest
 * linkiem. Licznik liczy przeglądarka; HTML z cache pokazuje datę końca, bo nie może się „cofać”.
 * Wariant `dark` to karta z ciemnego pasa „Kończą się wkrótce” (D3) z licznikiem pod ceną.
 */
export async function AuctionCard({
  auction,
  priority = false,
  variant = 'default',
}: {
  readonly auction: AuctionCardData;
  /** Pierwsze karty nad zgięciem strony (LCP): bez leniwego ładowania. */
  readonly priority?: boolean;
  readonly variant?: 'default' | 'dark';
}) {
  const t = await getTranslations('search.card');
  const format = await getFormatter();
  const dark = variant === 'dark';
  const endsAtLabel = t('endsAt', {
    date: format.dateTime(new Date(auction.endsAt), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
  });
  return (
    <Link
      href={auctionUrl(auction)}
      className={cn(
        'group relative flex h-full flex-col gap-3 outline-none transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:shadow-focus-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        dark
          ? 'rounded-2xl border border-ink-800 bg-ink-900 p-3 pb-4 text-primary-foreground'
          : 'rounded-xl',
      )}
    >
      <div
        className={cn(
          'overflow-hidden bg-muted transition-shadow duration-200 ease-out group-hover:shadow-lg motion-reduce:transition-none',
          dark ? 'rounded-lg bg-ink-800' : 'rounded-xl',
        )}
      >
        {auction.coverUrl === null ? (
          <div className="flex aspect-square flex-col items-center justify-center gap-2 text-body-sm text-muted-foreground">
            <ImageOff aria-hidden className="size-8" />
            {t('noPhoto')}
          </div>
        ) : (
          // Gotowe warianty WebP z CDN (F-12); optymalizacja Next.js tylko by je przeliczała.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={auction.coverThumbUrl ?? auction.coverUrl}
            srcSet={
              auction.coverThumbUrl === null
                ? undefined
                : `${auction.coverThumbUrl} 320w, ${auction.coverUrl} 800w`
            }
            sizes="(min-width: 1024px) 280px, (min-width: 640px) 33vw, 50vw"
            alt=""
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="aspect-square w-full object-cover"
          />
        )}
      </div>
      <div className={cn('flex flex-1 flex-col gap-0.5', dark ? 'px-1' : 'px-0.5')}>
        <h3
          className={cn(
            'line-clamp-2 text-body font-bold break-words group-hover:underline group-hover:underline-offset-3',
            dark ? 'text-primary-foreground' : 'text-foreground',
          )}
        >
          {auction.title}
        </h3>
        {auction.condition === null ? null : (
          <p className={cn('text-body-sm', dark ? 'text-ink-300' : 'text-muted-foreground')}>
            {t(`conditions.${auction.condition}`)}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
          <p className="flex min-w-0 flex-col">
            <span className="sr-only">
              {auction.currentPrice === null ? t('startPrice') : t('currentPrice')}:{' '}
            </span>
            <span className="text-price-lg tabular-nums">{shortMoney(auction.price)}</span>
            {dark ? (
              <span className="text-body-sm text-ink-300">
                {t('bids', { count: auction.bidCount })}
              </span>
            ) : null}
          </p>
          {dark ? (
            <CardTimer endsAt={auction.endsAt} />
          ) : (
            <span className="pb-1 text-body-sm font-semibold whitespace-nowrap text-foreground-secondary">
              {t('bids', { count: auction.bidCount })}
            </span>
          )}
        </div>
        {auction.buyNowPrice === null ? null : (
          <p
            className={cn(
              'inline-flex items-center gap-1.5 text-body-sm font-bold',
              dark ? 'text-green-300' : 'text-success',
            )}
          >
            <ShoppingBag aria-hidden className="size-4 shrink-0" />
            {t('buyNow', { price: shortMoney(auction.buyNowPrice) })}
          </p>
        )}
        {dark ? (
          <div className="pt-2.5">
            <CardHourBar endsAt={auction.endsAt} />
          </div>
        ) : null}
      </div>
      {/* Na zdjęciu, ale w kodzie po tytule: czytnik ekranu zaczyna od nazwy przedmiotu. */}
      <div
        className={cn(
          'pointer-events-none absolute flex aspect-square flex-col justify-between p-2.5',
          dark ? 'inset-x-3 top-3' : 'inset-x-0 top-0',
        )}
      >
        <span className="flex">
          <CardTimeBadge endsAt={auction.endsAt} endsAtLabel={endsAtLabel} liveOnly={dark} />
        </span>
        <span className="flex">
          <CardHotBadge endsAt={auction.endsAt} bidCount={auction.bidCount} />
        </span>
      </div>
    </Link>
  );
}

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-8 xl:grid-cols-4';

/** Siatka kart: 2 kolumny na telefonie, 3 na tablecie, 4 na szerokim ekranie. */
export function AuctionGrid({
  auctions,
  label,
  priorityCount = 0,
}: {
  readonly auctions: readonly AuctionCardData[];
  /** Nazwa listy dla czytników ekranu (np. tytuł sekcji). */
  readonly label?: string;
  readonly priorityCount?: number;
}) {
  return (
    <ul aria-label={label} className={GRID}>
      {auctions.map((auction, index) => (
        <li key={auction.id}>
          <AuctionCard auction={auction} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
