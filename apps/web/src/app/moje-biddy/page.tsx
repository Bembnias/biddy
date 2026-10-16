import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MyBids } from '@/components/my-biddy/my-bids';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBiddy');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Licytuję (F-21): trwające licytacje (prowadzę / przebito) i przegrane. */
export default async function MyBiddingPage() {
  await loadMeOrRedirect(routes.myBiddy);
  const t = await getTranslations('myBiddy');
  return (
    <>
      <MyBids status="ACTIVE" />
      <MyBids status="LOST" heading={t('lostTitle')} />
    </>
  );
}
