import {
  type FeeScheduleDto,
  type PublicAuctionDto,
  getAuction,
  getCurrentFeeSchedule,
  isApiError,
} from '@biddy/api-client';
import { auctionCacheTag, auctionPath, formatMoney, money, parseAuctionPath } from '@biddy/shared';
import type { Metadata } from 'next';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { AuctionDetails } from '@/components/auction/auction-details';
import { AuctionGallery } from '@/components/auction/auction-gallery';
import { AuctionSignals } from '@/components/auction/auction-signals';
import { BidHistory } from '@/components/auction/bid-history';
import { BidPanel } from '@/components/auction/bid-panel';
import { MobileBidBarSlot } from '@/components/auction/mobile-bid-bar-slot';
import { SellerCard } from '@/components/auction/seller-card';
import { Chip } from '@/components/ui/chip';
import { config } from '@/config';
import { jsonLdText, productJsonLd } from '@/lib/auction/structured-data';
import { categoryUrl } from '@/lib/routes';
// Klient API po stronie serwera; strona nie czyta ciasteczek, więc może być w cache (ISR).
import '@/lib/api/server';

/**
 * Strona aukcji (F-18): ISR. Bez rewalidacji na żądanie strona odświeża się co 60 s; po ofercie
 * worker API unieważnia tag `auction:{publicId}` (POST /api/revalidate), więc HTML pokazuje cenę
 * nie starszą niż ok. 10 s. Część zależna od użytkownika (panel licytacji) pobiera dane
 * w przeglądarce.
 */
export const revalidate = 60;

/** Strony nie powstają przy buildzie, tylko przy pierwszym wejściu (i trafiają do cache). */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

const REVALIDATE_SECONDS = 60;

const loadAuction = cache(async (publicId: string): Promise<PublicAuctionDto> => {
  try {
    return await getAuction(publicId, {
      next: { revalidate: REVALIDATE_SECONDS, tags: [auctionCacheTag(publicId)] },
    });
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }
});

/** Cennik POK do ceny łącznej w HTML; bez niego panel pobierze go w przeglądarce. */
const loadFeeSchedule = cache(async (): Promise<FeeScheduleDto | undefined> => {
  try {
    return await getCurrentFeeSchedule(undefined, { next: { revalidate: 300 } });
  } catch {
    return undefined;
  }
});

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/** Aukcja z adresu (404 dla segmentu bez poprawnego publicId) i slug z adresu. */
async function resolveAuction(
  params: PageProps['params'],
): Promise<{ readonly auction: PublicAuctionDto; readonly slug: string }> {
  const parsed = parseAuctionPath((await params).slug);
  if (parsed === null) {
    notFound();
  }
  return { auction: await loadAuction(parsed.publicId), slug: parsed.slug };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { auction } = await resolveAuction(params);
  const t = await getTranslations('auction');
  const format = await getFormatter();
  const url = auctionPath(auction.slug, auction.publicId);
  const description =
    auction.status === 'ACTIVE' && auction.endsAt !== null
      ? t('metaDescription', {
          title: auction.title,
          price: formatMoney(money(auction.currentPrice ?? auction.startPrice)),
          date: format.dateTime(new Date(auction.endsAt), { dateStyle: 'long' }),
        })
      : t('metaDescriptionEnded', { title: auction.title });
  const cover = auction.photos[0];
  return {
    title: auction.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title: auction.title,
      description,
      url,
      // Zdjęcie główne zamiast generowanego obrazka: cena w obrazku i tak byłaby nieaktualna
      // w cache serwisów społecznościowych.
      ...(cover === undefined ? {} : { images: [{ url: cover.urls.large, alt: auction.title }] }),
    },
    ...(auction.status === 'CANCELLED' ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function AuctionPage({ params }: PageProps) {
  const { auction, slug } = await resolveAuction(params);
  // Nieaktualny slug (zmiana tytułu przed pierwszą ofertą): adres kanoniczny. Tylko tutaj, nie
  // w generateMetadata, żeby odpowiedź miała jeden nagłówek Location.
  if (slug !== auction.slug) {
    permanentRedirect(auctionPath(auction.slug, auction.publicId));
  }
  const feeSchedule = await loadFeeSchedule();
  const t = await getTranslations('auction');
  const conditions = await getTranslations('listing.details.conditions');
  const url = new URL(auctionPath(auction.slug, auction.publicId), config.siteUrl).toString();

  return (
    <div className="mx-auto w-full max-w-page px-4 py-6 md:px-10 md:py-8">
      <script
        type="application/ld+json"
        // Treść użytkownika escapowana w jsonLdText (bez `</script>`).
        dangerouslySetInnerHTML={{ __html: jsonLdText(productJsonLd(auction, url)) }}
      />
      <TrackOnMount
        event="auction_viewed"
        properties={{ auctionId: auction.id, status: auction.status }}
      />
      {auction.category.length === 0 ? null : (
        <nav aria-label={t('categoryPath')} className="mb-5 text-body-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {auction.category.map((crumb, index) => (
              <li key={crumb.id} className="flex items-center gap-x-1.5">
                {index === 0 ? null : <ChevronRight aria-hidden className="size-3.5" />}
                <Link
                  href={categoryUrl(
                    auction.category.slice(0, index + 1).map((entry) => entry.slug),
                  )}
                  className="rounded-xs text-foreground-secondary underline-offset-3 outline-none hover:text-foreground hover:underline focus-visible:shadow-focus-ring"
                >
                  {crumb.name}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* Jedna siatka: na telefonie galeria, tytuł z panelem licytacji, historia, opis
          i sprzedawca jedno pod drugim; na desktopie tytuł, panel i historia w prawej kolumnie. */}
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <AuctionGallery
            title={auction.title}
            photos={auction.photos}
            badges={<AuctionSignals initial={auction} />}
          />
        </div>
        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="space-y-3">
            {auction.condition === null && auction.brand === null ? null : (
              <div className="flex flex-wrap gap-2">
                {auction.condition === null ? null : (
                  <Chip>{t('conditionChip', { condition: conditions(auction.condition) })}</Chip>
                )}
                {auction.brand === null ? null : <Chip tone="brand">{auction.brand}</Chip>}
              </div>
            )}
            <h1 className="text-h2 break-words md:text-h1">{auction.title}</h1>
          </div>
          <BidPanel initial={auction} feeSchedule={feeSchedule} />
          <BidHistory initial={auction} />
        </div>
        <div className="min-w-0 space-y-12 lg:col-start-1 lg:row-start-2">
          <AuctionDetails auction={auction} />
          <SellerCard seller={auction.seller} />
        </div>
      </div>
      <MobileBidBarSlot />
    </div>
  );
}
