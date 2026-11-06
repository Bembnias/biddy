import { getUserRating, type PublicAuctionDto, type UserRatingDto } from '@biddy/api-client';
import { BadgeCheck, Star } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { AskSellerButton } from '@/components/messaging/ask-seller-button';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { monthAndYear } from '@/lib/dates';
import { AVERAGE_FORMAT, profileReviewsUrl } from '@/lib/reviews/reviews';
import { publicProfileUrl } from '@/lib/routes';

/** Ocena sprzedawcy (krótki cache jak profil); błąd ukrywa wiersz ocen zamiast psuć stronę. */
async function sellerRating(sellerId: string): Promise<UserRatingDto | null> {
  try {
    return await getUserRating(sellerId, { next: { revalidate: 60 } });
  } catch {
    return null;
  }
}

/**
 * Sprzedawca na stronie aukcji (F-18, wygląd F-62): profil, weryfikacja telefonu, oceny jako
 * sprzedający z linkiem do ocen na profilu (F-30) i informacja, że to osoba prywatna (prawo
 * konsumenckie, PROJECT.md §17). Przy aktywnej aukcji „Zapytaj sprzedającego” (F-29).
 */
export async function SellerCard({
  seller,
  auctionId,
  askable,
}: {
  readonly seller: PublicAuctionDto['seller'];
  readonly auctionId: string;
  /** Aukcja aktywna: można zapytać sprzedającego. */
  readonly askable: boolean;
}) {
  const t = await getTranslations('auction.seller');
  const profile = await getTranslations('profile.public');
  const format = await getFormatter();
  const rating = await sellerRating(seller.id);
  const asSeller = rating?.asSeller;
  return (
    <section
      aria-labelledby="auction-seller"
      className="space-y-4 rounded-xl border border-border bg-canvas p-6"
    >
      <h2 id="auction-seller" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      <div className="flex items-center gap-3">
        <UserAvatar
          userId={seller.id}
          name={seller.name}
          label={t('avatar', { name: seller.name })}
          imageUrl={seller.avatarUrl}
        />
        <div className="min-w-0">
          <p className="text-title break-words">{seller.name}</p>
          <p className="text-body-sm text-muted-foreground">
            {t('private')} ·{' '}
            {profile('memberSince', { date: monthAndYear(new Date(seller.memberSince)) })}
          </p>
        </div>
      </div>
      <ul className="space-y-2 text-body-sm">
        {seller.phoneVerified ? (
          <li className="flex items-center gap-2 font-semibold text-success">
            <BadgeCheck aria-hidden className="size-4" />
            {profile('phoneVerified')}
          </li>
        ) : null}
        {asSeller === undefined ? null : (
          <li className="flex items-center gap-2 text-foreground-secondary">
            <Star aria-hidden className="size-4 fill-current text-rating" />
            <span>
              {t('ratings')}:{' '}
              {asSeller.average === null ? (
                <span className="font-semibold text-foreground">{t('noRatings')}</span>
              ) : (
                <Link
                  href={profileReviewsUrl(seller.id)}
                  className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
                >
                  {t('ratingSummary', {
                    average: format.number(asSeller.average, AVERAGE_FORMAT),
                    count: asSeller.count,
                  })}
                </Link>
              )}
            </span>
          </li>
        )}
      </ul>
      <p className="text-caption text-muted-foreground">{t('privateNotice')}</p>
      {askable ? <AskSellerButton auctionId={auctionId} sellerId={seller.id} /> : null}
      <Button asChild variant="outline" className="w-full">
        <Link href={publicProfileUrl(seller.id)}>
          {t('profile')}
          <span className="sr-only">{t('profileOf', { name: seller.name })}</span>
        </Link>
      </Button>
    </section>
  );
}
