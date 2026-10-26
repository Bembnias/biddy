'use client';

import {
  type OrderShipmentDto,
  type ShipmentDto,
  dispatchOrderShipment,
  getGetOrderShipmentQueryKey,
  getOrderLabel,
  isApiError,
  useGetMyAddresses,
  useGetOrderShipment,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';

import { DispatchForm } from './dispatch-form';
import { ShipmentResult } from './shipment-result';

const POLL_MS = 2_000;

/** Czekamy na przewoźnika: przesyłka w przygotowaniu albo etykieta jeszcze niegotowa. */
function waiting(data: OrderShipmentDto | undefined): boolean {
  const shipment = data?.shipment;
  return (
    shipment !== null &&
    shipment !== undefined &&
    (shipment.status === 'REQUESTED' ||
      (shipment.status === 'CREATED' && shipment.dropoffCode === null && !shipment.labelAvailable))
  );
}

/** Dokąd jedzie paczka: usługa, punkt odbioru albo odbiorca, gabaryt. */
export function ShipmentDestination({ shipment }: { readonly shipment: ShipmentDto }) {
  const t = useTranslations('shipping.dispatch');
  const sizes = useTranslations('listing.shipping');
  return (
    <section
      aria-labelledby="shipment-destination"
      className="space-y-3 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 id="shipment-destination" className="text-h3">
        {t('destination')}
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[12rem_1fr]">
        <dt className="text-foreground-secondary">{t('service')}</dt>
        <dd className="font-semibold">{shipment.carrier.name}</dd>
        {shipment.pickupPoint === null ? (
          <>
            <dt className="text-foreground-secondary">{t('recipient')}</dt>
            <dd>
              {shipment.recipient.name}
              {shipment.recipient.city === null ? null : `, ${shipment.recipient.city}`}
            </dd>
          </>
        ) : (
          <>
            <dt className="text-foreground-secondary">{t('pickupPoint')}</dt>
            <dd>
              <span className="block">{shipment.pickupPoint.name}</span>
              <span className="block text-body-sm text-muted-foreground">
                {shipment.pickupPoint.address}
              </span>
            </dd>
          </>
        )}
        <dt className="text-foreground-secondary">{t('packageSize')}</dt>
        <dd>{sizes(`sizes.${shipment.packageSize}`)}</dd>
      </dl>
    </section>
  );
}

/**
 * Strona nadania paczki (F-24, PROJECT.md §8.3): sprzedający opłaconego zamówienia podaje dane
 * nadawcy i sposób nadania, a po utworzeniu przesyłki u przewoźnika dostaje kod nadania albo
 * etykietę. Strona odświeża się sama, dopóki przewoźnik przygotowuje przesyłkę.
 */
export function DispatchPanel({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('shipping.dispatch');
  const queryClient = useQueryClient();
  const order = useGetOrderShipment(publicId, {
    query: {
      refetchInterval: (query) => (waiting(query.state.data) ? POLL_MS : false),
      retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
    },
  });
  const addresses = useGetMyAddresses();

  if (order.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (order.isError) {
    const missing = isApiError(order.error) && order.error.status === 404;
    return (
      <Alert variant={missing ? 'default' : 'destructive'}>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {missing ? t('notFound') : t('loadError')}
          {missing ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => void order.refetch()}>
              {t('retry')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const { order: summary, shipment } = order.data;
  const backLink = (
    <Link href={routes.mySales} className="text-link underline-offset-3 hover:underline">
      {t('back')}
    </Link>
  );
  if (summary.role !== 'SELLER') {
    return (
      <Alert>
        <AlertDescription>{t('notFound')}</AlertDescription>
      </Alert>
    );
  }
  const header = (
    <div className="space-y-1">
      <p className="text-title break-words">{summary.title}</p>
      <p className="text-body-sm text-muted-foreground">
        {t('order', { number: summary.publicId })}
      </p>
    </div>
  );
  if (shipment === null || (shipment.status === 'PENDING' && summary.status !== 'PAID')) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>
          <AlertTitle>{t('notAwaiting')}</AlertTitle>
          <AlertDescription>
            {t('notAwaitingHint')} {backLink}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const submit = async (body: Parameters<typeof dispatchOrderShipment>[1]) => {
    const result = await dispatchOrderShipment(publicId, body);
    queryClient.setQueryData(getGetOrderShipmentQueryKey(publicId), result);
  };

  return (
    <div className="space-y-6">
      {header}
      <ShipmentDestination shipment={shipment} />
      {shipment.status === 'PENDING' ? (
        <>
          {shipment.lastError === null ? null : (
            <Alert variant="destructive">
              <AlertTitle>{t('carrierError')}</AlertTitle>
              <AlertDescription>{shipment.lastError}</AlertDescription>
            </Alert>
          )}
          {addresses.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DispatchForm
              methods={shipment.dispatchMethods}
              senderAddress={addresses.data?.find((address) => address.isSenderDefault)}
              onSubmit={submit}
            />
          )}
        </>
      ) : (
        <ShipmentResult
          shipment={shipment}
          downloadLabel={() => getOrderLabel(publicId, { headers: { accept: 'application/pdf' } })}
          labelFilename={`etykieta-${summary.publicId}.pdf`}
        />
      )}
    </div>
  );
}
