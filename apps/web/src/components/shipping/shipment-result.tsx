'use client';

import type { ShipmentDto } from '@biddy/api-client';
import { Check, Copy, Download, PackageCheck } from 'lucide-react';
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
 * Przesyłka po „Nadaj” (F-24, układ F-63): przygotowanie u przewoźnika, potem ciemna karta
 * „Przesyłka gotowa do nadania” z kodem nadania („Kopiuj kod”) albo etykietą do pobrania, pod
 * nią numer przesyłki, status i historia trackingu.
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
  const [copied, setCopied] = useState(false);

  if (shipment.status === 'REQUESTED') {
    return (
      <div
        role="status"
        className="space-y-1 rounded-2xl border border-border bg-card p-5 sm:p-7"
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

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Schowek niedostępny (np. bez HTTPS): kod widać na ekranie.
    }
  };

  return (
    <div className="space-y-5">
      <section
        aria-labelledby="shipment-result-title"
        className="space-y-4 rounded-2xl bg-primary p-5.5 text-primary-foreground sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="shipment-result-title" className="flex items-center gap-2.5 text-h3">
            <PackageCheck aria-hidden className="size-5.5 shrink-0" />
            {t('dispatch.ready')}
          </h2>
          <Badge tone={SHIPMENT_TONES[shipment.status]}>{t(`status.${shipment.status}`)}</Badge>
        </div>

        {shipment.dropoffCode === null ? null : (
          <>
            <div className="flex flex-col items-center gap-1 rounded-xl bg-card px-4 py-4.5 text-foreground">
              <p className="text-overline text-muted-foreground uppercase">
                {t('dispatch.dropoffCode')}
              </p>
              <p className="text-price-xl tracking-widest tabular-nums" data-testid="dropoff-code">
                {shipment.dropoffCode}
              </p>
            </div>
            <p className="text-body-sm text-ink-300">{t('dispatch.dropoffHint')}</p>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {shipment.dropoffCode === null ? null : (
            <Button
              type="button"
              className="flex-1 bg-card text-foreground hover:bg-ink-100"
              onClick={() => void copy(shipment.dropoffCode ?? '')}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t('dispatch.copied') : t('dispatch.copy')}
            </Button>
          )}
          {shipment.labelAvailable ? (
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-ink-600 bg-transparent text-primary-foreground shadow-none hover:border-ink-400 hover:bg-ink-800"
              disabled={downloading}
              onClick={() => void download()}
            >
              <Download aria-hidden />
              {downloading ? t('dispatch.labelDownloading') : t('dispatch.label')}
            </Button>
          ) : null}
        </div>
        <p role="status" className="sr-only">
          {copied ? t('dispatch.copiedStatus') : ''}
        </p>
        {shipment.labelAvailable && shipment.dropoffCode === null ? (
          <p className="text-body-sm text-ink-300">{t('dispatch.labelHint')}</p>
        ) : null}
        {!shipment.labelAvailable && shipment.status === 'CREATED' ? (
          <p role="status" className="text-body-sm text-ink-300">
            {t('dispatch.labelPending')}
          </p>
        ) : null}
        {labelError ? (
          <p role="alert" className="text-body-sm font-semibold text-red-300">
            {t('dispatch.labelError')}
          </p>
        ) : null}
      </section>

      {shipment.trackingNumber === null && shipment.events.length === 0 ? null : (
        <section
          aria-labelledby="shipment-history-title"
          className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7"
        >
          <h2 id="shipment-history-title" className="text-h3">
            {t('dispatch.history')}
          </h2>
          {shipment.trackingNumber === null ? null : (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body">
              <dt className="text-foreground-secondary">{t('dispatch.trackingNumber')}</dt>
              <dd className="font-bold break-all tabular-nums">{shipment.trackingNumber}</dd>
            </dl>
          )}
          {shipment.events.length === 0 ? null : (
            <ol className="space-y-2.5 border-l-2 border-ink-200 pl-4">
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
          )}
        </section>
      )}
    </div>
  );
}
