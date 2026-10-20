import { getMyAuctions } from '@biddy/api-client';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MyAuctions } from '@/components/listing/my-auctions';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.mine');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Moje aukcje (F-14, w Moje Biddy od F-21): szkice, aktywne, w moderacji, zakończone
 * i anulowane.
 */
export default async function MyAuctionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly opublikowano?: string | string[] }>;
}) {
  await loadMeOrRedirect(routes.myAuctions);
  const [auctions, query, t] = await Promise.all([
    getMyAuctions(undefined, await withSessionCookies()),
    searchParams,
    getTranslations('listing.mine'),
  ]);
  const published = typeof query.opublikowano === 'string' ? query.opublikowano : undefined;
  return (
    <div>
      <p className="mb-5 text-body text-foreground-secondary">{t('text')}</p>
      <MyAuctions initial={auctions} publishedId={published} />
    </div>
  );
}
