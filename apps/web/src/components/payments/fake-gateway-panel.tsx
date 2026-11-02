'use client';

import {
  type FakeGatewayOverviewDto,
  completeFakePayment,
  failFakePayout,
  fakeChargeback,
  getGetFakeGatewayOverviewQueryKey,
  isApiError,
  redeliverFakeEvent,
  setFakeSellerStatus,
  useGetFakeGatewayOverview,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fakePayUrl } from '@/lib/routes';

type Payment = FakeGatewayOverviewDto['payments'][number];
type Seller = FakeGatewayOverviewDto['sellers'][number];
type Payout = FakeGatewayOverviewDto['payouts'][number];
type WebhookEvent = FakeGatewayOverviewDto['events'][number];

const REFRESH_MS = 5_000;

const PAYMENT_TONES = { PENDING: 'warning', SUCCEEDED: 'success', FAILED: 'danger' } as const;
const KYC_TONES = { PENDING: 'warning', VERIFIED: 'success', REJECTED: 'danger' } as const;
const PAYOUT_TONES = { PENDING: 'warning', PAID: 'success', FAILED: 'danger' } as const;

function problemDetail(error: unknown): string {
  if (isApiError(error)) {
    const detail = (error.problem as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function amountOf(value: number, currency: 'PLN'): string {
  return formatMoney(money(value, currency));
}

/** Krótki identyfikator do tabeli (pełny w atrybucie title). */
function ShortId({ id }: { readonly id: string }) {
  return (
    <span className="font-mono text-caption" title={id}>
      {id.length > 18 ? `${id.slice(0, 9)}…${id.slice(-6)}` : id}
    </span>
  );
}

function Section({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card">
      <h2 id={headingId} className="border-b border-border px-4 py-3 text-title">
        {title} <span className="text-foreground-secondary">({count})</span>
      </h2>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Table({
  headers,
  children,
}: {
  readonly headers: string[];
  readonly children: ReactNode;
}) {
  return (
    <table className="w-full min-w-[640px] text-left text-body-sm">
      <thead className="text-label text-foreground-secondary">
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col" className="px-4 py-2 font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  );
}

function Cell({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <td className={`px-4 py-2 align-middle ${className ?? ''}`}>{children}</td>;
}

/**
 * Panel deweloperski FakeGateway (F-23): ostatnie płatności, sprzedawcy, wypłaty i webhooki
 * symulowanego operatora oraz zdarzenia, które u prawdziwego operatora zdarzają się rzadko
 * (chargeback, odrzucona wypłata, zmiana weryfikacji, ponowny webhook, zaginiony webhook).
 */
export function FakeGatewayPanel() {
  const t = useTranslations('devPayments');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const overview = useGetFakeGatewayOverview({ query: { refetchInterval: REFRESH_MS } });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Seller['status']>>({});

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
      await queryClient.invalidateQueries({ queryKey: getGetFakeGatewayOverviewQueryKey() });
    }
  };
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'medium' });

  if (overview.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('panel.loading')}</span>
        <Skeleton className="h-40 w-full" />
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
  const { payments, sellers, payouts, events } = overview.data;
  const empty = (columns: number) => (
    <tr>
      <td colSpan={columns} className="px-4 py-4 text-foreground-secondary">
        {t('panel.empty')}
      </td>
    </tr>
  );

  const paymentActions = (payment: Payment) => {
    if (payment.status === 'PENDING') {
      return (
        <>
          <Button
            size="xs"
            disabled={busy}
            onClick={() =>
              void run(t('panel.pay'), () =>
                completeFakePayment(payment.id, { outcome: 'SUCCEEDED' }),
              )
            }
          >
            {t('panel.pay')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(t('panel.decline'), () =>
                completeFakePayment(payment.id, { outcome: 'FAILED' }),
              )
            }
          >
            {t('panel.decline')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(t('panel.settleSilently'), () =>
                completeFakePayment(payment.id, { outcome: 'SUCCEEDED', deliverWebhook: false }),
              )
            }
          >
            {t('panel.settleSilently')}
          </Button>
          <Link href={fakePayUrl(payment.id)} className="text-caption text-link underline">
            {t('pay.title')}
          </Link>
        </>
      );
    }
    if (payment.status === 'SUCCEEDED' && payment.chargebackStatus === null) {
      return (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(t('panel.openChargeback'), () =>
              fakeChargeback(payment.id, { action: 'OPEN' }),
            )
          }
        >
          {t('panel.openChargeback')}
        </Button>
      );
    }
    if (payment.chargebackStatus === 'OPEN') {
      return (
        <>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(t('panel.chargebackWon'), () =>
                fakeChargeback(payment.id, { action: 'WON' }),
              )
            }
          >
            {t('panel.chargebackWon')}
          </Button>
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy}
            onClick={() =>
              void run(t('panel.chargebackLost'), () =>
                fakeChargeback(payment.id, { action: 'LOST' }),
              )
            }
          >
            {t('panel.chargebackLost')}
          </Button>
        </>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-body-sm text-foreground-secondary">
        <p>{t('panel.blikCodes')}</p>
        <p>{t('panel.kycEmails')}</p>
      </div>
      <div role="status" aria-live="polite">
        {message === null ? null : (
          <Alert variant={message.ok ? 'success' : 'destructive'} role="status">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </div>

      <Section title={t('panel.payments')} count={payments.length}>
        <Table
          headers={[
            t('panel.id'),
            t('panel.amount'),
            t('panel.method'),
            t('panel.status'),
            t('panel.created'),
            t('panel.actions'),
          ]}
        >
          {payments.length === 0
            ? empty(6)
            : payments.map((payment) => (
                <tr key={payment.id}>
                  <Cell>
                    <ShortId id={payment.id} />
                  </Cell>
                  <Cell className="tabular-nums">{amountOf(payment.amount, payment.currency)}</Cell>
                  <Cell>{t(`methods.${payment.method}`)}</Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={PAYMENT_TONES[payment.status]}>
                        {t(`paymentStatus.${payment.status}`)}
                      </Badge>
                      {payment.chargebackStatus === null ? null : (
                        <Badge tone="info">
                          {t(`chargebackStatus.${payment.chargebackStatus}`)}
                        </Badge>
                      )}
                    </div>
                  </Cell>
                  <Cell>{time(payment.createdAt)}</Cell>
                  <Cell>
                    <div className="flex flex-wrap items-center gap-2">
                      {paymentActions(payment)}
                    </div>
                  </Cell>
                </tr>
              ))}
        </Table>
      </Section>

      <Section title={t('panel.sellers')} count={sellers.length}>
        <Table
          headers={[
            t('panel.seller'),
            t('panel.verification'),
            t('panel.balance'),
            t('panel.created'),
            t('panel.actions'),
          ]}
        >
          {sellers.length === 0
            ? empty(5)
            : sellers.map((seller) => {
                const selected =
                  statuses[seller.id] ?? (seller.status === 'VERIFIED' ? 'REJECTED' : 'VERIFIED');
                return (
                  <tr key={seller.id}>
                    <Cell>
                      <div>{seller.displayName}</div>
                      <ShortId id={seller.id} />
                    </Cell>
                    <Cell>
                      <Badge tone={KYC_TONES[seller.status]}>
                        {t(`kycStatus.${seller.status}`)}
                      </Badge>
                    </Cell>
                    <Cell className="tabular-nums">
                      {amountOf(seller.balance, seller.currency)}
                    </Cell>
                    <Cell>{time(seller.createdAt)}</Cell>
                    <Cell>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-40">
                          <NativeSelect
                            aria-label={t('panel.newStatus')}
                            className="h-8 text-body-sm"
                            value={selected}
                            onChange={(event) => {
                              setStatuses({
                                ...statuses,
                                [seller.id]: event.target.value as Seller['status'],
                              });
                            }}
                          >
                            {(['PENDING', 'VERIFIED', 'REJECTED'] as const).map((status) => (
                              <option key={status} value={status}>
                                {t(`kycStatus.${status}`)}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy || selected === seller.status}
                          onClick={() =>
                            void run(t('panel.newStatus'), () =>
                              setFakeSellerStatus(seller.id, { status: selected }),
                            )
                          }
                        >
                          {t('panel.newStatus')}
                        </Button>
                      </div>
                    </Cell>
                  </tr>
                );
              })}
        </Table>
      </Section>

      <Section title={t('panel.payouts')} count={payouts.length}>
        <Table
          headers={[
            t('panel.id'),
            t('panel.amount'),
            t('panel.status'),
            t('panel.created'),
            t('panel.actions'),
          ]}
        >
          {payouts.length === 0
            ? empty(5)
            : payouts.map((payout: Payout) => (
                <tr key={payout.id}>
                  <Cell>
                    <ShortId id={payout.id} />
                  </Cell>
                  <Cell className="tabular-nums">{amountOf(payout.amount, payout.currency)}</Cell>
                  <Cell>
                    <Badge tone={PAYOUT_TONES[payout.status]}>
                      {t(`payoutStatus.${payout.status}`)}
                    </Badge>
                  </Cell>
                  <Cell>{time(payout.createdAt)}</Cell>
                  <Cell>
                    {payout.status === 'FAILED' ? null : (
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        disabled={busy}
                        onClick={() =>
                          void run(t('panel.failPayout'), () => failFakePayout(payout.id))
                        }
                      >
                        {t('panel.failPayout')}
                      </Button>
                    )}
                  </Cell>
                </tr>
              ))}
        </Table>
      </Section>

      <Section title={t('panel.events')} count={events.length}>
        <Table
          headers={[
            t('panel.type'),
            t('panel.object'),
            t('panel.created'),
            t('panel.delivery'),
            t('panel.actions'),
          ]}
        >
          {events.length === 0
            ? empty(5)
            : events.map((event: WebhookEvent) => (
                <tr key={event.id}>
                  <Cell className="font-mono text-caption">{event.type}</Cell>
                  <Cell>
                    <ShortId id={event.objectId} />
                  </Cell>
                  <Cell>{time(event.createdAt)}</Cell>
                  <Cell>
                    <div className="flex flex-col gap-0.5">
                      <Badge tone={event.deliveredAt === null ? 'warning' : 'success'}>
                        {event.deliveredAt === null
                          ? t('panel.notDelivered')
                          : t('panel.delivered')}
                      </Badge>
                      <span className="text-caption text-foreground-secondary">
                        {t('panel.attempts', { count: event.attempts })}
                      </span>
                      {event.lastError === null ? null : (
                        <span className="text-caption break-all text-destructive">
                          {event.lastError}
                        </span>
                      )}
                    </div>
                  </Cell>
                  <Cell>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(t('panel.redeliver'), () => redeliverFakeEvent(event.id))
                      }
                    >
                      {t('panel.redeliver')}
                    </Button>
                  </Cell>
                </tr>
              ))}
        </Table>
      </Section>
    </div>
  );
}
