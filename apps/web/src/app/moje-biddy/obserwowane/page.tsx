import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Watchlist } from '@/components/my-biddy/watchlist';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBiddy');
  return {
    title: `${t('tabs.watchlist')} · ${t('metaTitle')}`,
    robots: { index: false, follow: false },
  };
}

/** Obserwowane aukcje (F-21). */
export default async function MyWatchlistPage() {
  await loadMeOrRedirect(routes.myWatchlist);
  return <Watchlist />;
}
