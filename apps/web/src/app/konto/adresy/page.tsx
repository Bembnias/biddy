import { getCarriers, getMyAddresses, getMyPickupPoints } from '@biddy/api-client';
import type { Metadata } from 'next';
import { MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AddressList } from '@/components/addresses/address-list';
import { SavedPickupPointList } from '@/components/pickup-points/saved-pickup-point-list';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { routes } from '@/lib/routes';

/** Limit adresów na konto (API: 409 ADDRESS_LIMIT_REACHED). */
const MAX_ADDRESSES = 10;

/** Limit punktów odbioru na konto (API: 409 PICKUP_POINT_LIMIT_REACHED). */
const MAX_PICKUP_POINTS = 10;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('addresses');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Adresy dostawy i nadania (F-10, siatka kart F-63) oraz zapisane punkty odbioru (F-64),
 * renderowane na serwerze z sesją.
 */
export default async function AddressesPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  await loadMeOrRedirect(routes.addresses);
  const session = await withSessionCookies();
  const [addresses, points, carriers] = await Promise.all([
    getMyAddresses(session),
    getMyPickupPoints(session),
    getCarriers(),
  ]);
  const t = await getTranslations('addresses');
  const full = addresses.length >= MAX_ADDRESSES;
  const pointsFull = points.length >= MAX_PICKUP_POINTS;
  const pointSaved = (await searchParam(searchParams, 'punkt')) === 'zapisany';
  const carrierNames = Object.fromEntries(carriers.map((carrier) => [carrier.id, carrier.name]));
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.account, label: t('back') }}
    >
      {full ? (
        <p className="mb-4 text-body-sm text-muted-foreground">
          {t('limit', { max: MAX_ADDRESSES })}
        </p>
      ) : null}
      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('empty')}
          action={
            <Button asChild variant="accent">
              <Link href={routes.newAddress}>
                <Plus aria-hidden />
                {t('add')}
              </Link>
            </Button>
          }
        />
      ) : (
        <AddressList addresses={addresses} canAdd={!full} />
      )}

      <section aria-labelledby="pickup-points-title" className="mt-10 space-y-4">
        <div className="space-y-1">
          <h2 id="pickup-points-title" className="text-h3">
            {t('points.title')}
          </h2>
          <p className="text-body text-foreground-secondary">{t('points.text')}</p>
        </div>
        <p role="status" className="text-body font-semibold text-success empty:hidden">
          {pointSaved ? t('points.saved') : null}
        </p>
        {pointsFull ? (
          <p className="text-body-sm text-muted-foreground">
            {t('points.limit', { max: MAX_PICKUP_POINTS })}
          </p>
        ) : null}
        {points.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title={t('points.empty')}
            action={
              <Button asChild variant="accent">
                <Link href={routes.newPickupPoint}>
                  <Plus aria-hidden />
                  {t('points.add')}
                </Link>
              </Button>
            }
          />
        ) : (
          <SavedPickupPointList points={points} carrierNames={carrierNames} canAdd={!pointsFull} />
        )}
      </section>
    </AccountPage>
  );
}
