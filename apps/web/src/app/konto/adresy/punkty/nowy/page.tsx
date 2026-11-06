import { getCarriers, getMyAddresses, getMyPickupPoints } from '@biddy/api-client';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { NewPickupPointForm } from '@/components/pickup-points/new-pickup-point-form';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addresses.points.form');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Nowy punkt odbioru (F-64): usługi z punktami, mapa startuje w mieście domyślnego adresu
 * dostawy (bez ulicy).
 */
export default async function NewPickupPointPage() {
  await loadMeOrRedirect(routes.newPickupPoint);
  const session = await withSessionCookies();
  const [carriers, saved, addresses] = await Promise.all([
    getCarriers(),
    getMyPickupPoints(session),
    getMyAddresses(session),
  ]);
  const t = await getTranslations('addresses.points.form');
  const home = addresses.find((address) => address.isDefault);
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.addresses, label: t('back') }}
    >
      <NewPickupPointForm
        carriers={carriers.filter((carrier) => carrier.kind !== 'COURIER')}
        saved={saved}
        near={home === undefined ? undefined : { city: home.city, postcode: home.postalCode }}
      />
    </AccountPage>
  );
}
