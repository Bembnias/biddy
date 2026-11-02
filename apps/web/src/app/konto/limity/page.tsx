import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AccountStanding } from '@/components/account/standing/account-standing';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('standing');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Limity i strike'i (F-61): poziomy konta, blokady z uzasadnieniem i odwołania. */
export default async function AccountStandingPage() {
  await loadMeOrRedirect(routes.accountStanding);
  const t = await getTranslations('standing');
  return (
    <AccountPage
      title={t('title')}
      text={t('lead')}
      back={{ href: routes.account, label: t('back') }}
    >
      <AccountStanding />
    </AccountPage>
  );
}
