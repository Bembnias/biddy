import {
  getPublicProfile,
  getUserRating,
  isApiError,
  listUserReviews,
  type PublicProfileDto,
  type PublicReviewListDto,
  type UserRatingDto,
} from '@biddy/api-client';
import { BadgeCheck, CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { FollowSellerButton } from '@/components/profile/follow-seller-button';
import { UserAvatar } from '@/components/profile/user-avatar';
import { ProfileReviews } from '@/components/reviews/profile-reviews';
import { RatingSummary } from '@/components/reviews/rating-summary';
import { ReviewsInfo } from '@/components/reviews/reviews-info';
import { AuctionGrid } from '@/components/search/auction-card';
import { monthAndYear } from '@/lib/dates';
import { AVERAGE_FORMAT, REVIEWS_ANCHOR } from '@/lib/reviews/reviews';
import { publicProfileUrl } from '@/lib/routes';
import { searchCached } from '@/lib/search/load';
// Klient API po stronie serwera (adres API, także API_INTERNAL_URL); profil bez ciasteczek.
import '@/lib/api/server';

/**
 * Profil publiczny z API (F-10). Jedno zapytanie na żądanie (metadata i strona), z krótkim
 * cache Next.js: profil nie zawiera danych prywatnych.
 */
const loadProfile = cache(async (id: string): Promise<PublicProfileDto> => {
  try {
    return await getPublicProfile(id, { next: { revalidate: 60 } });
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }
});

/**
 * Reputacja z API (F-30): średnie i pierwsza strona ocen. Błąd nie psuje profilu: sekcja ocen
 * pokazuje wtedy komunikat.
 */
async function loadReputation(
  id: string,
): Promise<{ readonly rating: UserRatingDto; readonly reviews: PublicReviewListDto } | null> {
  try {
    const [rating, reviews] = await Promise.all([
      getUserRating(id, { next: { revalidate: 60 } }),
      listUserReviews(id, undefined, { next: { revalidate: 60 } }),
    ]);
    return { rating, reviews };
  } catch {
    return null;
  }
}

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const profile = await loadProfile((await params).id);
  const t = await getTranslations('profile.public');
  const description = t('metaDescription', { name: profile.name });
  const url = publicProfileUrl(profile.id);
  return {
    title: profile.name,
    description,
    alternates: { canonical: url },
    openGraph: { title: profile.name, description, url, type: 'profile' },
  };
}

/**
 * Profil publiczny (układ F-63): okładka, karta profilu ze statystykami (członek od, weryfikacja
 * telefonu, liczba aktywnych aukcji, ocena), siatka aukcji i oceny z informacją o ich weryfikacji
 * (F-30). Bez e-maila, telefonu i adresów (tylko pola z API).
 */
export default async function PublicProfilePage({ params }: PageProps) {
  const profile = await loadProfile((await params).id);
  const t = await getTranslations('profile');
  // Aktywne aukcje sprzedawcy z wyszukiwarki (F-19); bez niej sekcja mówi, że ich nie ma.
  const [auctions, reputation] = await Promise.all([
    searchCached({ seller: profile.id, sort: 'ending', pageSize: 12 }, 60),
    loadReputation(profile.id),
  ]);
  const format = await getFormatter();
  const rating = reputation?.rating;
  return (
    <div className="pb-16 md:pb-22">
      {/* Okładka: ozdobne koła w kolorach marki. */}
      <div aria-hidden className="relative h-36 overflow-hidden bg-primary md:h-42">
        <div className="absolute -top-20 -right-15 size-90 rounded-full border-48 border-ink-800" />
        <div className="absolute right-60 -bottom-30 size-55 rounded-full border-36 border-violet-900 max-md:hidden" />
      </div>
      <div className="mx-auto w-full max-w-page space-y-10 px-4 md:px-10">
        <header className="relative -mt-16 flex flex-wrap items-end gap-x-6 gap-y-5 rounded-2xl border border-border bg-card p-5 shadow-md md:-mt-18 md:p-7">
          <UserAvatar
            userId={profile.id}
            name={profile.name}
            label={t('avatarLabel', { name: profile.name })}
            imageUrl={profile.avatarUrl}
            size="xl"
            className="-mt-16 border-4 border-card shadow-sm md:-mt-18"
          />
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2.5">
            <h1 className="text-h2 break-words md:text-h1">{profile.name}</h1>
            <ul className="flex flex-wrap gap-2">
              {profile.phoneVerified ? (
                <li className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-bold text-green-700">
                  <BadgeCheck aria-hidden className="size-3.5" />
                  {t('public.phoneVerified')}
                </li>
              ) : null}
              <li className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-bold text-ink-700">
                <CalendarDays aria-hidden className="size-3.5" />
                {t('public.memberSince', { date: monthAndYear(new Date(profile.memberSince)) })}
              </li>
            </ul>
          </div>
          {auctions === null && rating === undefined ? null : (
            <dl aria-label={t('public.stats')} className="flex gap-8 px-1">
              {auctions === null ? null : (
                <div className="flex flex-col">
                  <dt className="text-overline text-muted-foreground uppercase">
                    {t('public.statActive')}
                  </dt>
                  <dd className="text-h2 font-extrabold tabular-nums">{auctions.total}</dd>
                </div>
              )}
              {rating === undefined ? null : (
                <div className="flex flex-col">
                  <dt className="text-overline text-muted-foreground uppercase">
                    {t('public.statRating')}
                  </dt>
                  <dd className="flex flex-col">
                    <span className="text-h2 font-extrabold tabular-nums">
                      {rating.average === null
                        ? '—'
                        : format.number(rating.average, AVERAGE_FORMAT)}
                    </span>
                    <a
                      href={`#${REVIEWS_ANCHOR}`}
                      className="text-caption font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
                    >
                      {t('public.statRatingCount', { count: rating.count })}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          )}
          <div className="w-full sm:w-auto">
            <FollowSellerButton sellerId={profile.id} sellerName={profile.name} />
          </div>
        </header>
        <section aria-labelledby="active-auctions">
          <h2 id="active-auctions" className="text-h2">
            {t('public.activeAuctions')}
          </h2>
          {auctions === null || auctions.items.length === 0 ? (
            <p className="mt-3 text-muted-foreground">{t('public.noActiveAuctions')}</p>
          ) : (
            <div className="mt-6">
              <AuctionGrid auctions={auctions.items} />
            </div>
          )}
        </section>
        <section id={REVIEWS_ANCHOR} aria-labelledby="ratings" className="scroll-mt-24 space-y-6">
          <h2 id="ratings" className="text-h2">
            {t('public.ratings')}
          </h2>
          {reputation === null ? (
            <p className="text-muted-foreground">{t('public.ratingsError')}</p>
          ) : reputation.rating.count === 0 ? (
            <p className="text-muted-foreground">{t('public.noRatings')}</p>
          ) : (
            <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <RatingSummary rating={reputation.rating} />
              <ProfileReviews userId={profile.id} initialPage={reputation.reviews} />
            </div>
          )}
          <ReviewsInfo />
        </section>
      </div>
    </div>
  );
}
