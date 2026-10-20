import type { AuctionSearchDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { Clock, ImageOff } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { auctionUrl } from '@/lib/routes';

export type AuctionCardData = AuctionSearchDto['items'][number];

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Karta aukcji (F-19, wygląd F-62): kwadratowe zdjęcie z datą końca, tytuł, cena, liczba ofert
 * i Kup teraz. Cała karta jest linkiem. Koniec jako data i godzina, nie licznik: HTML z cache nie
 * może się „cofać”.
 */
export async function AuctionCard({
  auction,
  priority = false,
}: {
  readonly auction: AuctionCardData;
  /** Pierwsze karty nad zgięciem strony (LCP): bez leniwego ładowania. */
  readonly priority?: boolean;
}) {
  const t = await getTranslations('search.card');
  const format = await getFormatter();
  const endsAt = format.dateTime(new Date(auction.endsAt), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <Link
      href={auctionUrl(auction)}
      className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card outline-none transition-[box-shadow,translate,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:shadow-focus-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div>
        {auction.coverUrl === null ? (
          <div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
            <ImageOff aria-hidden className="size-8" />
            <span className="sr-only">{t('noPhoto')}</span>
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
            className="aspect-square w-full bg-muted object-cover"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-label break-words text-foreground group-hover:underline group-hover:underline-offset-3">
          {auction.title}
        </h3>
        <p className="mt-auto pt-1.5">
          <span className="sr-only">
            {auction.currentPrice === null ? t('startPrice') : t('currentPrice')}:{' '}
          </span>
          <span className="text-price tabular-nums">{short(auction.price)}</span>
        </p>
        <p className="text-caption text-muted-foreground">
          {t('bids', { count: auction.bidCount })}
          {auction.buyNowPrice === null ? null : (
            <>
              {' · '}
              <span className="font-semibold text-accent-foreground">
                {t('buyNow', { price: short(auction.buyNowPrice) })}
              </span>
            </>
          )}
        </p>
      </div>
      {/* Na zdjęciu, ale w kodzie po tytule: czytnik ekranu zaczyna od nazwy przedmiotu. */}
      <p className="absolute top-2 left-2 inline-flex h-6 items-center gap-1 rounded-full bg-card px-2 text-caption font-semibold text-foreground shadow-sm">
        <Clock aria-hidden className="size-3.5" />
        {t('endsAt', { date: endsAt })}
      </p>
    </Link>
  );
}

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
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
    >
      {auctions.map((auction, index) => (
        <li key={auction.id}>
          <AuctionCard auction={auction} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
