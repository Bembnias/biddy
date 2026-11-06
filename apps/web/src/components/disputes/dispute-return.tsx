'use client';

// Zwrot z odesłaniem (F-28, PROJECT.md §7.5): kupujący nadaje przedmiot z etykietą od Biddy
// (formularz „Nadaj” z F-24 z tekstami dla kupującego), a potem widzi kod nadania albo etykietę
// i tracking. Sprzedający widzi tylko tracking zwrotu.
import {
  type DisputeDto,
  getDisputeReturnLabel,
  getGetOrderDisputeQueryKey,
  shipDisputeReturn,
  useGetMyAddresses,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useId } from 'react';

import { track } from '@/analytics/posthog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DispatchForm } from '@/components/shipping/dispatch-form';
import { SHIPMENT_TONES, ShipmentResult } from '@/components/shipping/shipment-result';

type ReturnShipment = NonNullable<NonNullable<DisputeDto['return']>['shipment']>;

export function DisputeReturn({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.returnShipment');
  const titleId = useId();
  const shipment = dispute.return?.shipment ?? null;
  if (shipment === null) {
    return null;
  }
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <h2 id={titleId} className="text-h3">
        {t('title')}
      </h2>
      {dispute.role === 'BUYER' && dispute.actions.shipReturn ? (
        <ReturnDispatch dispute={dispute} shipment={shipment} />
      ) : dispute.role === 'BUYER' && shipment.status !== 'PENDING' ? (
        <ShipmentResult
          shipment={shipment}
          downloadLabel={() =>
            getDisputeReturnLabel(dispute.id, { headers: { accept: 'application/pdf' } })
          }
          labelFilename={`etykieta-zwrot-${dispute.orderPublicId}.pdf`}
        />
      ) : (
        <ReturnTracking shipment={shipment} />
      )}
    </section>
  );
}

function ReturnDispatch({
  dispute,
  shipment,
}: {
  readonly dispute: DisputeDto;
  readonly shipment: ReturnShipment;
}) {
  const t = useTranslations('dispute.returnShipment');
  const queryClient = useQueryClient();
  const addresses = useGetMyAddresses();
  const submit = async (body: Parameters<typeof shipDisputeReturn>[1]) => {
    const updated = await shipDisputeReturn(dispute.id, body);
    track('dispute_return_shipped');
    queryClient.setQueryData(getGetOrderDisputeQueryKey(dispute.orderPublicId), updated);
  };
  return (
    <div className="space-y-4">
      <p className="text-body text-foreground-secondary">
        {t('lead', { carrier: shipment.carrier.name })}
      </p>
      {shipment.lastError === null ? null : (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {shipment.lastError}
        </p>
      )}
      {addresses.isPending ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <DispatchForm
          methods={shipment.dispatchMethods}
          senderAddress={
            addresses.data?.find((address) => address.isDefault) ?? addresses.data?.[0]
          }
          copy={{ lead: t('senderLead'), prefilled: t('prefilled'), missing: t('missing') }}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

/** Tracking zwrotu dla sprzedającego (odbiorcy): przewoźnik, numer i historia. */
function ReturnTracking({ shipment }: { readonly shipment: ReturnShipment }) {
  const t = useTranslations('dispute.returnShipment');
  const status = useTranslations('shipping.status');
  const format = useFormatter();
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-5.5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-title">{shipment.carrier.name}</p>
        <Badge tone={SHIPMENT_TONES[shipment.status]}>{status(shipment.status)}</Badge>
      </div>
      <p className="text-body-sm text-foreground-secondary">
        {shipment.trackingNumber === null
          ? t('notShipped')
          : t('trackingNumber', { number: shipment.trackingNumber })}
      </p>
      {shipment.events.length === 0 ? null : (
        <ol className="space-y-2.5 border-l-2 border-ink-200 pl-4">
          {[...shipment.events].reverse().map((event) => (
            <li key={`${event.status}-${event.occurredAt}`} className="text-body-sm">
              <span className="font-semibold">{status(event.status)}</span>
              <span className="text-muted-foreground">
                {' · '}
                {format.dateTime(new Date(event.occurredAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
