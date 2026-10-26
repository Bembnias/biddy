'use client';

import {
  type FakeShippingOverviewDto,
  advanceParcel,
  createTestShipment,
  dispatchTestShipment,
  getGetFakeShippingOverviewQueryKey,
  getTestShipmentLabel,
  isApiError,
  setParcelScenario,
  syncShipment,
  useGetCarriers,
  useGetFakeShippingOverview,
  useGetMyAddresses,
  useGetPickupPoints,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

import { DispatchForm } from './dispatch-form';
import { SHIPMENT_TONES, saveFile } from './shipment-result';

type Row = FakeShippingOverviewDto['shipments'][number];
type Parcel = NonNullable<Row['parcel']>;
type ParcelStatus = Parcel['status'];
type Scenario = Parcel['scenario'];
type PackageSize = 'S' | 'M' | 'L' | 'XL';

const REFRESH_MS = 5_000;
const PARCEL_STATUSES: readonly ParcelStatus[] = [
  'confirmed',
  'posted',
  'in_transit',
  'out_for_delivery',
  'awaiting_pickup',
  'delivered',
  'exception',
  'return_expired',
  'returning',
  'returned',
  'cancelled',
];
const SCENARIOS: readonly Scenario[] = ['DELIVERED', 'NOT_PICKED_UP', 'LOST', 'MANUAL'];

function problemDetail(error: unknown): string {
  if (isApiError(error)) {
    const detail = (error.problem as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function FakeShippingBanner() {
  const t = useTranslations('devShipping');
  return (
    <Alert variant="warning" role="note" className="mb-6">
      <FlaskConical aria-hidden />
      <AlertDescription>{t('banner')}</AlertDescription>
    </Alert>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card">
      <h2 id={headingId} className="border-b border-border px-4 py-3 text-title">
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Formularz nowej przesyłki testowej: usługa, gabaryt i punkt (z magicznymi punktami). */
function NewShipment({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: (body: Parameters<typeof createTestShipment>[0]) => void;
}) {
  const t = useTranslations('devShipping.panel');
  const sizes = useTranslations('listing.shipping');
  const carriers = useGetCarriers();
  const [carrierId, setCarrierId] = useState('inpost-paczkomat');
  const [size, setSize] = useState<PackageSize>('M');
  const [pointId, setPointId] = useState('');
  const carrier = carriers.data?.find((candidate) => candidate.id === carrierId);
  const needsPoint = carrier !== undefined && carrier.kind !== 'COURIER';
  const points = useGetPickupPoints(
    { carrier: carrierId, q: 'Warszawa', limit: 10 },
    { query: { enabled: needsPoint } },
  );
  const ids = { carrier: useId(), size: useId(), point: useId() };
  const sizesOf = carrier?.packageSizes ?? ['M'];
  const selectedSize = sizesOf.includes(size) ? size : (sizesOf[0] ?? 'M');
  const selectedPoint = pointId === '' ? points.data?.[0]?.id : pointId;

  return (
    <form
      className="grid gap-4 md:grid-cols-[1fr_8rem_1fr_auto] md:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({
          carrierId,
          packageSize: selectedSize,
          ...(needsPoint && selectedPoint !== undefined ? { pickupPointId: selectedPoint } : {}),
        });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={ids.carrier}>{t('carrier')}</Label>
        <NativeSelect
          id={ids.carrier}
          value={carrierId}
          onChange={(event) => {
            setCarrierId(event.target.value);
            setPointId('');
          }}
        >
          {(carriers.data ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={ids.size}>{t('packageSize')}</Label>
        <NativeSelect
          id={ids.size}
          value={selectedSize}
          onChange={(event) => {
            setSize(event.target.value as PackageSize);
          }}
        >
          {sizesOf.map((option) => (
            <option key={option} value={option}>
              {sizes(`sizes.${option}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor={ids.point}>{t('pickupPoint')}</Label>
        <NativeSelect
          id={ids.point}
          value={selectedPoint ?? ''}
          disabled={!needsPoint}
          onChange={(event) => {
            setPointId(event.target.value);
          }}
        >
          {needsPoint
            ? (points.data ?? []).map((point) => (
                <option key={point.id} value={point.id}>
                  {point.name}
                </option>
              ))
            : [
                <option key="none" value="">
                  —
                </option>,
              ]}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={busy || carriers.isPending}>
        {t('create')}
      </Button>
    </form>
  );
}

/**
 * Panel deweloperski FakeShipping (F-24): przesyłki symulowanego dostawcy ze stanem w Biddy
 * i u dostawcy, przesyłka testowa bez zamówienia z tym samym formularzem „Nadaj” co strona
 * zamówienia, ręczne statusy, scenariusze i synchronizacja bez webhooka.
 */
export function FakeShippingPanel() {
  const t = useTranslations('devShipping');
  const shipping = useTranslations('shipping');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const overview = useGetFakeShippingOverview({ query: { refetchInterval: REFRESH_MS } });
  const addresses = useGetMyAddresses();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ParcelStatus>>({});
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetFakeShippingOverviewQueryKey() });
  const run = async (action: string, operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      setMessage({ ok: true, text: t('panel.done', { action }) });
    } catch (error) {
      setMessage({ ok: false, text: t('panel.failed', { detail: problemDetail(error) }) });
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'medium' });

  if (overview.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('panel.loading')}</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (overview.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {t('panel.error')}
          <Button type="button" variant="outline" size="sm" onClick={() => void overview.refetch()}>
            {t('panel.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  const rows = overview.data.shipments;
  const target = rows.find((row) => row.shipment.id === dispatching);

  const parcelActions = (row: Row, parcel: Parcel) => {
    const status = statuses[parcel.id] ?? 'exception';
    const scenario = scenarios[parcel.id] ?? parcel.scenario;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          disabled={busy}
          onClick={() => void run(t('panel.next'), () => advanceParcel(parcel.id, {}))}
        >
          {t('panel.next')}
        </Button>
        <div className="w-40">
          <NativeSelect
            aria-label={t('panel.newStatus')}
            className="h-8 text-body-sm"
            value={status}
            onChange={(event) => {
              setStatuses({ ...statuses, [parcel.id]: event.target.value as ParcelStatus });
            }}
          >
            {PARCEL_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => void run(t('panel.setStatus'), () => advanceParcel(parcel.id, { status }))}
        >
          {t('panel.setStatus')}
        </Button>
        <div className="w-36">
          <NativeSelect
            aria-label={t('panel.scenario')}
            className="h-8 text-body-sm"
            value={scenario}
            onChange={(event) => {
              setScenarios({ ...scenarios, [parcel.id]: event.target.value as Scenario });
            }}
          >
            {SCENARIOS.map((option) => (
              <option key={option} value={option}>
                {t(`scenarios.${option}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={busy || scenario === parcel.scenario}
          onClick={() =>
            void run(t('panel.setScenario'), () => setParcelScenario(parcel.id, { scenario }))
          }
        >
          {t('panel.setScenario')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void run(t('panel.sync'), () => syncShipment(row.shipment.id))}
        >
          {t('panel.sync')}
        </Button>
        {row.shipment.labelAvailable ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(t('panel.label'), async () => {
                saveFile(
                  await getTestShipmentLabel(row.shipment.id, {
                    headers: { accept: 'application/pdf' },
                  }),
                  `etykieta-${row.shipment.id}.pdf`,
                );
              })
            }
          >
            {t('panel.label')}
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-body-sm text-foreground-secondary">{t('panel.magic')}</p>
      <div role="status" aria-live="polite">
        {message === null ? null : (
          <Alert variant={message.ok ? 'success' : 'destructive'} role="status">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </div>

      <Section title={t('panel.newTitle')}>
        <p className="mb-4 text-body-sm text-muted-foreground">{t('panel.newLead')}</p>
        <NewShipment
          busy={busy}
          onCreate={(body) =>
            void run(t('panel.create'), async () => {
              const created = await createTestShipment(body);
              setDispatching(created.id);
            })
          }
        />
      </Section>

      {target === undefined || target.shipment.status !== 'PENDING' ? null : (
        <section aria-label={t('panel.dispatchTitle')} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h3">{t('panel.dispatchTitle')}</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDispatching(null);
              }}
            >
              {t('panel.close')}
            </Button>
          </div>
          {addresses.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DispatchForm
              key={target.shipment.id}
              methods={target.shipment.dispatchMethods}
              senderAddress={addresses.data?.find((address) => address.isSenderDefault)}
              onSubmit={async (body) => {
                await dispatchTestShipment(target.shipment.id, body);
                setDispatching(null);
                setMessage({ ok: true, text: t('panel.done', { action: t('panel.dispatch') }) });
                await refresh();
              }}
            />
          )}
        </section>
      )}

      <Section title={`${t('panel.shipments')} (${String(rows.length)})`}>
        {rows.length === 0 ? (
          <p className="text-foreground-secondary">{t('panel.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.shipment.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-title">{row.shipment.carrier.name}</span>
                  <Badge tone={SHIPMENT_TONES[row.shipment.status]}>
                    {shipping(`status.${row.shipment.status}`)}
                  </Badge>
                  <Badge tone="neutral" variant="outline">
                    {row.orderId === null ? t('panel.test') : t('panel.order')}
                  </Badge>
                  {row.parcel === null ? null : (
                    <span className="font-mono text-caption text-muted-foreground">
                      {t('panel.providerStatus')}: {row.parcel.status} ·{' '}
                      {t(`scenarios.${row.parcel.scenario}`)}
                    </span>
                  )}
                  <span className="text-caption text-muted-foreground">
                    {time(row.shipment.createdAt)}
                  </span>
                </div>
                <p className="font-mono text-caption text-muted-foreground" title={row.shipment.id}>
                  {row.shipment.trackingNumber ?? row.shipment.id}
                  {row.shipment.pickupPoint === null ? '' : ` · ${row.shipment.pickupPoint.name}`}
                  {row.shipment.dropoffCode === null ? '' : ` · kod ${row.shipment.dropoffCode}`}
                </p>
                {row.shipment.lastError === null ? null : (
                  <p className="text-body-sm text-destructive">{row.shipment.lastError}</p>
                )}
                {row.parcel === null ? (
                  row.shipment.status === 'PENDING' && row.orderId === null ? (
                    <Button
                      size="xs"
                      disabled={busy}
                      onClick={() => {
                        setDispatching(row.shipment.id);
                      }}
                    >
                      {t('panel.dispatch')}
                    </Button>
                  ) : null
                ) : (
                  <>
                    {parcelActions(row, row.parcel)}
                    <p className="text-caption text-muted-foreground">
                      {t('panel.webhooks')}:{' '}
                      {row.parcel.webhooks
                        .map(
                          (webhook) =>
                            `${webhook.deliveredAt === null ? t('panel.notDelivered') : t('panel.delivered')} (${t('panel.attempts', { count: webhook.attempts })})`,
                        )
                        .join(', ') || '—'}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
