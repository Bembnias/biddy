import { getMyAddresses } from '@biddy/api-client';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AddressForm } from '@/components/addresses/address-form';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { editAddressUrl, routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addresses.form');
  return { title: t('editTitle'), robots: { index: false } };
}

/** Edycja adresu (F-10); cudzy albo nieistniejący adres to 404. */
export default async function EditAddressPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  await loadMeOrRedirect(editAddressUrl(id));
  const addresses = await getMyAddresses(await withSessionCookies());
  const address = addresses.find((candidate) => candidate.id === id);
  if (address === undefined) {
    notFound();
  }
  const t = await getTranslations('addresses');
  return (
    <AccountPage title={t('form.editTitle')} back={{ href: routes.addresses, label: t('title') }}>
      <AddressForm address={address} />
    </AccountPage>
  );
}
