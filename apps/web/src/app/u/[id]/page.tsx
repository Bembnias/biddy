import { getPublicProfile, isApiError, type PublicProfileDto } from '@biddy/api-client';
import { BadgeCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

import { UserAvatar } from '@/components/profile/user-avatar';
import { AuctionGrid } from '@/components/search/auction-card';
import { monthAndYear } from '@/lib/dates';
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

/** Profil publiczny: bez e-maila, telefonu i adresów (tylko pola z API). */
export default async function PublicProfilePage({ params }: PageProps) {
  const profile = await loadProfile((await params).id);
  const t = await getTranslations('profile');
  // Aktywne aukcje sprzedawcy z wyszukiwarki (F-19); bez niej sekcja mówi, że ich nie ma.
  const auctions = await searchCached({ seller: profile.id, sort: 'ending', pageSize: 12 }, 60);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 md:px-6">
      <header className="flex flex-wrap items-center gap-6">
        <UserAvatar
          userId={profile.id}
          name={profile.name}
          label={t('avatarLabel', { name: profile.name })}
          imageUrl={profile.avatarUrl}
          size="lg"
        />
        <div>
          <h1 className="text-3xl font-bold">{profile.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {t('public.memberSince', { date: monthAndYear(new Date(profile.memberSince)) })}
          </p>
          {profile.phoneVerified ? (
            <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-success">
              <BadgeCheck aria-hidden className="size-4" />
              {t('public.phoneVerified')}
            </p>
          ) : null}
        </div>
      </header>
      <section aria-labelledby="active-auctions" className="mt-10">
        <h2 id="active-auctions" className="text-xl font-semibold">
          {t('public.activeAuctions')}
        </h2>
        {auctions === null || auctions.items.length === 0 ? (
          <p className="mt-3 text-muted-foreground">{t('public.noActiveAuctions')}</p>
        ) : (
          <div className="mt-4">
            <AuctionGrid auctions={auctions.items} />
          </div>
        )}
      </section>
      <section aria-labelledby="ratings" className="mt-10">
        <h2 id="ratings" className="text-xl font-semibold">
          {t('public.ratings')}
        </h2>
        <p className="mt-3 text-muted-foreground">{t('public.noRatings')}</p>
      </section>
    </div>
  );
}
