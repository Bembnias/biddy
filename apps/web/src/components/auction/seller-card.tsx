import type { PublicAuctionDto } from '@biddy/api-client';
import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { UserAvatar } from '@/components/profile/user-avatar';
import { monthAndYear } from '@/lib/dates';
import { publicProfileUrl } from '@/lib/routes';

/**
 * Sprzedawca na stronie aukcji (F-18): profil, weryfikacja telefonu, oceny (F-30) i informacja,
 * że to osoba prywatna (prawo konsumenckie, PROJECT.md §17).
 */
export async function SellerCard({ seller }: { readonly seller: PublicAuctionDto['seller'] }) {
  const t = await getTranslations('auction.seller');
  const profile = await getTranslations('profile.public');
  return (
    <section aria-labelledby="auction-seller" className="rounded-lg border border-border p-4">
      <h2 id="auction-seller" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <UserAvatar
          userId={seller.id}
          name={seller.name}
          label={t('avatar', { name: seller.name })}
          imageUrl={seller.avatarUrl}
        />
        <div className="min-w-0">
          <Link
            href={publicProfileUrl(seller.id)}
            className="font-medium break-words text-primary underline-offset-4 hover:underline"
          >
            {seller.name}
          </Link>
          <p className="text-sm text-muted-foreground">
            {t('private')} ·{' '}
            {profile('memberSince', { date: monthAndYear(new Date(seller.memberSince)) })}
          </p>
        </div>
      </div>
      {seller.phoneVerified ? (
        <p className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-success">
          <BadgeCheck aria-hidden className="size-4" />
          {profile('phoneVerified')}
        </p>
      ) : null}
      <p className="mt-2 text-sm">
        <span className="text-muted-foreground">{t('ratings')}:</span> {t('noRatings')}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">{t('privateNotice')}</p>
    </section>
  );
}
