import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MyBids } from '@/components/my-biddy/my-bids';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBiddy');
  return {
    title: `${t('tabs.wins')} · ${t('metaTitle')}`,
    robots: { index: false, follow: false },
  };
}

/** Wygrane (F-21): kwota i termin płatności, akcja „Zapłać” (F-25). */
export default async function MyWinsPage() {
  await loadMeOrRedirect(routes.myWins);
  return <MyBids status="WON" />;
}
