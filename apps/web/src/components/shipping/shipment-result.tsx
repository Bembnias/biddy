'use client';

import type { ShipmentDto } from '@biddy/api-client';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Status = ShipmentDto['status'];

/** Kolor statusu przesyłki (§8.3). */
export const SHIPMENT_TONES: Readonly<
  Record<Status, 'neutral' | 'info' | 'success' | 'warning' | 'danger'>
> = {
  PENDING: 'neutral',
  REQUESTED: 'neutral',
  CREATED: 'info',
  DROPPED_OFF: 'info',
  IN_TRANSIT: 'info',
  OUT_FOR_DELIVERY: 'info',
  READY_FOR_PICKUP: 'warning',
  DELIVERED: 'success',
  EXCEPTION: 'danger',
  RETURNING: 'warning',
  RETURNED: 'neutral',
  CANCELLED: 'neutral',
};

/** Zapisuje plik z pamięci przeglądarki (etykieta PDF pobrana przez API z sesją). */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Przesyłka po „Nadaj” (F-24): przygotowanie u przewoźnika, potem kod nadania albo etykieta
 * do pobrania, numer przesyłki, status i historia trackingu.
 */
export function ShipmentResult({
  shipment,
  downloadLabel,
  labelFilename,
}: {
  readonly shipment: ShipmentDto;
  readonly downloadLabel: () => Promise<Blob>;
  readonly labelFilename: string;
}) {
  const t = useTranslations('shipping');
  const format = useFormatter();
  const [downloading, setDownloading] = useState(false);
  const [labelError, setLabelError] = useState(false);

  if (shipment.status === 'REQUESTED') {
    return (
      <div
        role="status"
        className="space-y-1 rounded-xl border border-border bg-card p-5 sm:p-6"
        aria-busy="true"
      >
        <p className="text-title">{t('dispatch.preparing')}</p>
        <p className="text-body-sm text-muted-foreground">{t('dispatch.preparingHint')}</p>
      </div>
    );
  }

  const download = async () => {
    setDownloading(true);
    setLabelError(false);
    try {
      saveFile(await downloadLabel(), labelFilename);
    } catch {
      setLabelError(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      aria-labelledby="shipment-result-title"
      className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="shipment-result-title" className="text-h3">
          {t('dispatch.ready')}
        </h2>
        <Badge tone={SHIPMENT_TONES[shipment.status]}>{t(`status.${shipment.status}`)}</Badge>
      </div>

      {shipment.dropoffCode === null ? null : (
        <div className="space-y-1">
          <p className="text-label text-foreground-secondary">{t('dispatch.dropoffCode')}</p>
          <p className="font-mono text-price-xl tracking-widest" data-testid="dropoff-code">
            {shipment.dropoffCode}
          </p>
          <p className="text-body-sm text-muted-foreground">{t('dispatch.dropoffHint')}</p>
        </div>
      )}

      {shipment.labelAvailable ? (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Download aria-hidden />
            {downloading ? t('dispatch.labelDownloading') : t('dispatch.label')}
          </Button>
          {shipment.dropoffCode === null ? (
            <p className="text-body-sm text-muted-foreground">{t('dispatch.labelHint')}</p>
          ) : null}
          {labelError ? (
            <p role="alert" className="text-body-sm text-destructive">
              {t('dispatch.labelError')}
            </p>
          ) : null}
        </div>
      ) : shipment.status === 'CREATED' ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {t('dispatch.labelPending')}
        </p>
      ) : null}

      {shipment.trackingNumber === null ? null : (
        <dl className="grid gap-1 text-body sm:grid-cols-[12rem_1fr]">
          <dt className="text-foreground-secondary">{t('dispatch.trackingNumber')}</dt>
          <dd className="font-mono break-all">{shipment.trackingNumber}</dd>
        </dl>
      )}

      {shipment.events.length === 0 ? null : (
        <div className="space-y-2">
          <h3 className="text-title">{t('dispatch.history')}</h3>
          <ol className="space-y-2 border-l border-border pl-4">
            {[...shipment.events].reverse().map((event) => (
              <li key={`${event.status}-${event.occurredAt}`} className="text-body-sm">
                <span className="font-semibold">{t(`status.${event.status}`)}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {format.dateTime(new Date(event.occurredAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {event.description === null ? null : (
                  <span className="block text-muted-foreground">{event.description}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
