import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { PayoutProfileForms } from '@/components/payouts/payout-profile-forms';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('payoutProfile');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Dane do wypłat (F-27): dane osobowe do DAC7 i rachunek, oba zaszyfrowane w API. */
export default async function PayoutProfilePage() {
  await loadMeOrRedirect(routes.payoutProfile);
  const t = await getTranslations('payoutProfile');
  return (
    <AccountPage
      title={t('title')}
      text={t('lead')}
      back={{ href: routes.balance, label: t('back') }}
    >
      <PayoutProfileForms />
    </AccountPage>
  );
}
