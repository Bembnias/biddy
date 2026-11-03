import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { SellerBalance } from '@/components/payouts/seller-balance';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('balance');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Saldo i wypłaty (F-27): salda, wypłata, wypłata tygodniowa, zamówienia w trakcie i historia. */
export default async function BalancePage() {
  await loadMeOrRedirect(routes.balance);
  const t = await getTranslations('balance');
  return (
    <AccountPage
      title={t('title')}
      text={t('lead')}
      back={{ href: routes.account, label: t('back') }}
    >
      <SellerBalance />
    </AccountPage>
  );
}
