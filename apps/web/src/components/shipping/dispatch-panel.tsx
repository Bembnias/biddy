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
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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

/**
 * Karta zamówienia obok formularza (F-63): przedmiot, usługa z ceną dostawy, punkt odbioru albo
 * odbiorca i gabaryt.
 */
export function ShipmentDestination({
  title,
  shipment,
}: {
  readonly title: string;
  readonly shipment: ShipmentDto;
}) {
  const t = useTranslations('shipping.dispatch');
  const sizes = useTranslations('listing.shipping');
  const row = (label: string, value: ReactNode) => (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-foreground-secondary">{label}</dt>
      <dd className="min-w-0 font-bold break-words">{value}</dd>
    </div>
  );
  return (
    <section
      aria-labelledby="shipment-destination"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5"
    >
      <h2 id="shipment-destination" className="text-overline text-muted-foreground uppercase">
        {t('orderCard')}
      </h2>
      <p className="text-title break-words">{title}</p>
      <dl className="space-y-3 border-t border-ink-100 pt-3.5 text-body-sm">
        {row(
          t('service'),
          <>
            {shipment.carrier.name}
            <span className="block font-medium text-muted-foreground tabular-nums">
              {t('price', { price: formatMoney(money(shipment.price)) })}
            </span>
          </>,
        )}
        {shipment.pickupPoint === null
          ? row(
              t('destination'),
              shipment.recipient.city === null ? t('courier') : shipment.recipient.city,
            )
          : row(
              t('destination'),
              <>
                {shipment.pickupPoint.name}
                <span className="block font-medium text-muted-foreground">
                  {shipment.pickupPoint.address}
                </span>
              </>,
            )}
        {row(t('recipient'), shipment.recipient.name)}
        {row(
          t('packageSize'),
          `${shipment.packageSize} · ${sizes(`sizeHints.${shipment.packageSize}`)}`,
        )}
      </dl>
    </section>
  );
}

/**
 * Strona nadania paczki (F-24, układ F-63): sprzedający opłaconego zamówienia podaje dane
 * nadawcy i sposób nadania, a po utworzeniu przesyłki u przewoźnika dostaje kod nadania albo
 * etykietę. Od 1024 px formularz albo wynik obok karty zamówienia. Strona odświeża się sama,
 * dopóki przewoźnik przygotowuje przesyłkę.
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

  const header = (number?: string) => (
    <div className="space-y-1">
      <h1 className="text-h2 md:text-h1">{t('title')}</h1>
      {number === undefined ? null : (
        <p className="text-body font-semibold text-foreground-secondary tabular-nums">
          {t('order', { number })}
        </p>
      )}
    </div>
  );

  if (order.isPending) {
    return (
      <div className="space-y-6">
        {header()}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (order.isError) {
    const missing = isApiError(order.error) && order.error.status === 404;
    return (
      <div className="space-y-6">
        {header()}
        <Alert variant={missing ? 'default' : 'destructive'}>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            {missing ? t('notFound') : t('loadError')}
            {missing ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void order.refetch()}
              >
                {t('retry')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { order: summary, shipment } = order.data;
  if (summary.role !== 'SELLER') {
    return (
      <div className="space-y-6">
        {header()}
        <Alert>
          <AlertDescription>{t('notFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (shipment === null || (shipment.status === 'PENDING' && summary.status !== 'PAID')) {
    return (
      <div className="space-y-6">
        {header(summary.publicId)}
        <p className="text-title break-words">{summary.title}</p>
        <Alert>
          <AlertTitle>{t('notAwaiting')}</AlertTitle>
          <AlertDescription>{t('notAwaitingHint')}</AlertDescription>
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
      {header(summary.publicId)}
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          {shipment.status === 'PENDING' ? (
            <>
              {shipment.lastError === null ? null : (
                <Alert variant="destructive">
                  <AlertTitle>{t('carrierError')}</AlertTitle>
                  <AlertDescription>{shipment.lastError}</AlertDescription>
                </Alert>
              )}
              {addresses.isPending ? (
                <Skeleton className="h-96 w-full rounded-2xl" />
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
              downloadLabel={() =>
                getOrderLabel(publicId, { headers: { accept: 'application/pdf' } })
              }
              labelFilename={`etykieta-${summary.publicId}.pdf`}
            />
          )}
        </div>
        <ShipmentDestination title={summary.title} shipment={shipment} />
      </div>
    </div>
  );
}
