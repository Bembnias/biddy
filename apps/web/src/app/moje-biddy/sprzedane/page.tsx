import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Sales } from '@/components/my-biddy/sales';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myBiddy');
  return {
    title: `${t('tabs.sales')} · ${t('metaTitle')}`,
    robots: { index: false, follow: false },
  };
}

/** Sprzedane (F-21): stan zamówienia i następny krok sprzedającego. */
export default async function MySalesPage() {
  await loadMeOrRedirect(routes.mySales);
  return <Sales />;
}
