import {
  type FeeScheduleDto,
  type PublicAuctionDto,
  getAuction,
  getCurrentFeeSchedule,
  isApiError,
} from '@biddy/api-client';
import { auctionCacheTag, auctionPath, formatMoney, money, parseAuctionPath } from '@biddy/shared';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { AuctionDetails } from '@/components/auction/auction-details';
import { AuctionGallery } from '@/components/auction/auction-gallery';
import { BidHistory } from '@/components/auction/bid-history';
import { BidPanel } from '@/components/auction/bid-panel';
import { SellerCard } from '@/components/auction/seller-card';
import { config } from '@/config';
import { jsonLdText, productJsonLd } from '@/lib/auction/structured-data';
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
  const url = new URL(auctionPath(auction.slug, auction.publicId), config.siteUrl).toString();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
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
        <nav aria-label={t('categoryPath')} className="mb-3 text-sm text-muted-foreground">
          <ol className="flex flex-wrap gap-x-2">
            {auction.category.map((crumb, index) => (
              <li key={crumb.id} className="flex gap-x-2">
                {index === 0 ? null : <span aria-hidden>›</span>}
                {crumb.name}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <h1 className="text-2xl font-bold break-words md:text-3xl">{auction.title}</h1>

      {/* Jedna siatka: na telefonie galeria, panel, opis i historia jedno pod drugim; na desktopie
          panel i sprzedawca w prawej kolumnie, przyklejone przy przewijaniu. */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <AuctionGallery title={auction.title} photos={auction.photos} />
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="space-y-6 lg:sticky lg:top-6">
            <BidPanel initial={auction} feeSchedule={feeSchedule} />
            <SellerCard seller={auction.seller} />
          </div>
        </div>
        <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-2">
          <AuctionDetails auction={auction} />
          <BidHistory initial={auction} />
        </div>
      </div>
    </div>
  );
}
