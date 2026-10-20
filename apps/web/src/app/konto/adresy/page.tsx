import { getMyAddresses } from '@biddy/api-client';
import type { Metadata } from 'next';
import { MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AddressList } from '@/components/addresses/address-list';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { routes } from '@/lib/routes';

/** Limit adresów na konto (API: 409 ADDRESS_LIMIT_REACHED). */
const MAX_ADDRESSES = 10;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addresses');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Adresy dostawy i nadania (F-10), renderowane na serwerze z sesją. */
export default async function AddressesPage() {
  await loadMeOrRedirect(routes.addresses);
  const addresses = await getMyAddresses(await withSessionCookies());
  const t = await getTranslations('addresses');
  const full = addresses.length >= MAX_ADDRESSES;
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.account, label: t('back') }}
    >
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {full ? (
          <p className="text-body-sm text-muted-foreground">{t('limit', { max: MAX_ADDRESSES })}</p>
        ) : (
          <Button asChild variant="accent">
            <Link href={routes.newAddress}>
              <Plus aria-hidden />
              {t('add')}
            </Link>
          </Button>
        )}
      </div>
      {addresses.length === 0 ? (
        <EmptyState icon={MapPin} title={t('empty')} />
      ) : (
        <AddressList addresses={addresses} />
      )}
    </AccountPage>
  );
}
