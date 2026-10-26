import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { SellStart } from '@/components/listing/sell-start';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.start');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Start wystawiania (F-14): szkice i nowa aukcja. Wymaga zalogowania. */
export default async function SellPage() {
  const me = await loadMeOrRedirect(routes.sell);
  const t = await getTranslations('listing.start');
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.myAuctions, label: t('myAuctions') }}
      compact
    >
      <SellStart phoneVerified={me.phoneVerified} />
    </AccountPage>
  );
}
