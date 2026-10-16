import type { AuctionSearchDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { auctionUrl } from '@/lib/routes';

export type AuctionCardData = AuctionSearchDto['items'][number];

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Karta aukcji (F-19): zdjęcie, tytuł, cena, liczba ofert, koniec i Kup teraz. Cała karta jest
 * linkiem. Koniec jako data i godzina, nie licznik: HTML z cache nie może się „cofać”.
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
  return (
    <Link
      href={auctionUrl(auction)}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
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
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 font-medium break-words group-hover:underline">
          {auction.title}
        </h3>
        <p className="mt-auto pt-2">
          <span className="sr-only">
            {auction.currentPrice === null ? t('startPrice') : t('currentPrice')}:{' '}
          </span>
          <span className="text-lg font-bold tabular-nums">{short(auction.price)}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {t('bids', { count: auction.bidCount })}
          {auction.buyNowPrice === null ? null : (
            <> · {t('buyNow', { price: short(auction.buyNowPrice) })}</>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('endsAt', {
            date: format.dateTime(new Date(auction.endsAt), {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </p>
      </div>
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
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4 xl:grid-cols-4"
    >
      {auctions.map((auction, index) => (
        <li key={auction.id}>
          <AuctionCard auction={auction} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
