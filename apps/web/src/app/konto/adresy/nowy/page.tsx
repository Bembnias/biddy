import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AddressForm } from '@/components/addresses/address-form';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addresses.form');
  return { title: t('newTitle'), robots: { index: false } };
}

/** Nowy adres (F-10); telefon podpowiadamy numerem zweryfikowanym w F-08. */
export default async function NewAddressPage() {
  const me = await loadMeOrRedirect(routes.newAddress);
  const t = await getTranslations('addresses');
  return (
    <AccountPage title={t('form.newTitle')} back={{ href: routes.addresses, label: t('title') }}>
      <AddressForm defaultPhone={me.phoneNumber} />
    </AccountPage>
  );
}
