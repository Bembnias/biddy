'use client';

import { type OrderDetailsDto, isApiError, useGetOrder } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { Check, ImageOff, MessagesSquare, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { track } from '@/analytics/posthog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ORDER_TONES, orderProgress } from '@/lib/orders/order-view';
import {
  auctionUrl,
  checkoutUrl,
  dispatchUrl,
  disputeUrl,
  newConversationUrl,
  routes,
} from '@/lib/routes';
import { cn } from '@/lib/utils';

import { ConfirmReceipt, ReportNotReceived } from './order-actions';
import { SecondChanceCard } from './second-chance-card';

type Order = OrderDetailsDto;

/**
 * Strona zamówienia dla obu stron (F-26): stan w pigułce, karta „Co teraz” z jedną główną akcją
 * dla oglądającego, postęp z datami, przesyłka z historią trackingu, podsumowanie kwot i (dla
 * sprzedającego po braku płatności) druga szansa.
 */
export function OrderPanel({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('order');
  const order = useGetOrder(publicId, {
    query: { retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2 },
  });
  const tracked = useRef(false);

  useEffect(() => {
    if (order.data !== undefined && !tracked.current) {
      tracked.current = true;
      track('order_viewed', { role: order.data.role, status: order.data.status });
    }
  }, [order.data]);

  if (order.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (order.isError) {
    const missing = isApiError(order.error) && order.error.status === 404;
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {missing ? t('notFound') : t('error')}
        {missing ? null : (
          <Button type="button" variant="outline" size="sm" onClick={() => void order.refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  const view = order.data;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-h2 break-words md:text-h1">{view.title}</h1>
          <p className="text-body font-semibold text-foreground-secondary tabular-nums">
            {t('number', { number: view.publicId })}
          </p>
        </div>
        <Badge tone={ORDER_TONES[view.status]}>{t(`statuses.${view.status}`)}</Badge>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <NowCard order={view} />
          {view.secondChance === null ? null : (
            <SecondChanceCard order={view} secondChance={view.secondChance} />
          )}
          <Progress order={view} />
          <Shipment order={view} />
        </div>
        <OrderSummary order={view} />
      </div>
    </div>
  );
}

/** „Co teraz”: stan opisany zdaniem dla oglądającego i jego główna akcja. */
function NowCard({ order }: { readonly order: Order }) {
  const t = useTranslations('order');
  const format = useFormatter();
  const date = (iso: string | null) =>
    iso === null
      ? ''
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
  const zl = (amount: number) => formatMoney(money(amount, order.currency));
  const buyer = order.role === 'BUYER';
  const values = {
    date: date(
      {
        AWAITING_PAYMENT: order.paymentDueAt,
        PAID: order.shipBy,
        DELIVERED: order.inspectionEndsAt,
        LOST: order.compensation?.dueAt ?? null,
      }[order.status as string] ?? null,
    ),
    amount: zl(order.itemsTotal),
  };
  const key: `${'buyer' | 'seller'}.${Order['status']}` | 'seller.LOST_COMPENSATED' =
    !buyer && order.status === 'LOST' && order.compensation?.paidAt !== null
      ? 'seller.LOST_COMPENSATED'
      : buyer
        ? `buyer.${order.status}`
        : `seller.${order.status}`;

  return (
    <section
      aria-labelledby="order-now-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id="order-now-title" className="text-overline text-muted-foreground uppercase">
        {t('now')}
      </h2>
      <p className="text-title">{t(key, values)}</p>
      {order.onHold ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-body-sm text-amber-800">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('onHold')}
        </p>
      ) : null}
      {order.refund === null ? null : (
        <p className="text-body-sm text-foreground-secondary">
          {order.refund.status === 'SUCCEEDED'
            ? t('refund.done', {
                amount: zl(order.refund.amount),
                date: date(order.refund.succeededAt),
              })
            : t(order.refund.status === 'FAILED' ? 'refund.failed' : 'refund.pending', {
                amount: zl(order.refund.amount),
              })}
        </p>
      )}
      <NowActions order={order} />
    </section>
  );
}

function NowActions({ order }: { readonly order: Order }) {
  const t = useTranslations('order');
  const format = useFormatter();
  const buyer = order.role === 'BUYER';
  // Spór (F-28): w toku główna akcja, po rozstrzygnięciu link obok innych akcji.
  const disputeLink =
    order.disputedAt === null ? null : (
      <Button asChild variant={order.status === 'DISPUTED' ? 'cta' : 'outline'}>
        <Link href={disputeUrl(order.publicId)}>{t('actions.viewDispute')}</Link>
      </Button>
    );
  if (order.status === 'DISPUTED') {
    return disputeLink;
  }
  if (buyer && order.status === 'AWAITING_PAYMENT') {
    return (
      <Button asChild variant="cta">
        <Link href={checkoutUrl(order.publicId)}>{t('actions.pay')}</Link>
      </Button>
    );
  }
  if (!buyer && order.status === 'PAID') {
    return (
      <Button asChild variant="cta">
        <Link href={dispatchUrl(order.publicId)}>{t('actions.ship')}</Link>
      </Button>
    );
  }
  // Pieniądze ze sprzedaży albo rekompensata są na saldzie (F-27).
  if (
    !buyer &&
    (order.status === 'COMPLETED' ||
      order.status === 'PARTIALLY_REFUNDED' ||
      (order.status === 'LOST' && (order.compensation?.paidAt ?? null) !== null))
  ) {
    return (
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={routes.balance}>{t('actions.balance')}</Link>
        </Button>
        {disputeLink}
      </div>
    );
  }
  if (buyer && order.actions.confirmReceipt) {
    const open = order.actions.openDispute;
    return (
      <div className="space-y-3">
        <ConfirmReceipt publicId={order.publicId} />
        {open?.allowed === true ? (
          <p className="text-body-sm text-foreground-secondary">
            {t('problem', {
              date: format.dateTime(new Date(open.until), {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}{' '}
            <Link
              href={disputeUrl(order.publicId)}
              className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
            >
              {t('actions.dispute')}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }
  if (order.actions.reportNotReceived !== null) {
    return (
      <ReportNotReceived
        publicId={order.publicId}
        availableAt={order.actions.reportNotReceived.availableAt}
        allowed={order.actions.reportNotReceived.allowed}
      />
    );
  }
  return disputeLink;
}

/** Postęp: Opłacone · Nadane · Odebrane · Zakończone, z datami zrobionych kroków. */
function Progress({ order }: { readonly order: Order }) {
  const t = useTranslations('order.steps');
  const format = useFormatter();
  const steps = orderProgress(order);
  if (steps.every((step) => step.state === 'todo')) {
    return null;
  }
  return (
    <section
      aria-labelledby="order-progress-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id="order-progress-title" className="text-h3">
        {t('title')}
      </h2>
      <ol className="grid gap-3 sm:grid-cols-4">
        {steps.map((step) => (
          <li
            key={step.step}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex items-start gap-2.5 sm:flex-col"
          >
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border-2 text-label',
                step.state === 'done' && 'border-success bg-success text-primary-foreground',
                step.state === 'current' && 'border-brand text-accent-foreground',
                step.state === 'todo' && 'border-border text-muted-foreground',
              )}
            >
              {step.state === 'done' ? <Check aria-hidden className="size-4" /> : null}
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  'block text-label',
                  step.state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {t(step.step)}
              </span>
              {step.at === null ? null : (
                <span className="block text-caption text-muted-foreground tabular-nums">
                  {format.dateTime(new Date(step.at), { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Przesyłka: przewoźnik, numer i historia trackingu (najnowsze na górze). */
function Shipment({ order }: { readonly order: Order }) {
  const t = useTranslations('order.shipment');
  const status = useTranslations('shipping.status');
  const format = useFormatter();
  const { shipment } = order;
  if (
    shipment === null ||
    ![
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'NOT_PICKED_UP',
      'LOST',
      'REFUNDED',
      'DISPUTED',
    ].includes(order.status)
  ) {
    return null;
  }
  return (
    <section
      aria-labelledby="order-shipment-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="order-shipment-title" className="text-h3">
          {t('title')}
        </h2>
        <Badge tone="neutral">{status(shipment.status)}</Badge>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body">
        <dt className="text-foreground-secondary">{shipment.carrier.name}</dt>
        {shipment.trackingNumber === null ? (
          <dd className="text-muted-foreground">{t('none')}</dd>
        ) : (
          <dd className="font-bold break-all tabular-nums">
            <span className="sr-only">{t('trackingNumber')}: </span>
            {shipment.trackingNumber}
          </dd>
        )}
      </dl>
      {shipment.events.length === 0 ? null : (
        <div className="space-y-2.5">
          <h3 className="text-label text-foreground-secondary">{t('history')}</h3>
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

/**
 * Podsumowanie: przedmiot, kwoty i druga strona; od 1024 px przyklejone obok treści. Także na
 * stronie sporu (F-28).
 */
export function OrderSummary({ order }: { readonly order: Order }) {
  const t = useTranslations('order.summary');
  const zl = (amount: number) => formatMoney(money(amount, order.currency));
  return (
    <aside
      aria-labelledby="order-summary-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 lg:sticky lg:top-22"
    >
      <h2 id="order-summary-title" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      <div className="flex items-center gap-3.5">
        {order.photoUrl === null ? (
          <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <ImageOff aria-hidden className="size-6" />
          </span>
        ) : (
          // Miniatura WebP z CDN.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={order.photoUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="text-title break-words">{order.title}</p>
          <Link
            href={auctionUrl(order.auction)}
            className="text-body-sm font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
          >
            {t('auction')}
          </Link>
        </div>
      </div>
      <dl className="space-y-2.5 border-t border-ink-100 pt-3.5 text-body-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('price')}</dt>
          <dd className="font-bold tabular-nums">{zl(order.itemsTotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('pok')}</dt>
          <dd className="font-bold tabular-nums">{zl(order.pokFee)}</dd>
        </div>
        {order.shippingFee === null ? null : (
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-secondary">{t('shipping')}</dt>
            <dd className="font-bold tabular-nums">{zl(order.shippingFee)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-100 pt-3">
          <dt className="text-title">{t('total')}</dt>
          <dd className="text-price-lg tabular-nums">{zl(order.total)}</dd>
        </div>
      </dl>
      {order.counterpart.name === '' ? null : (
        <div className="space-y-3 border-t border-ink-100 pt-3.5">
          <p className="text-body-sm text-foreground-secondary">
            {t(order.role === 'BUYER' ? 'seller' : 'buyer', { name: order.counterpart.name })}
          </p>
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={newConversationUrl({ orderPublicId: order.publicId })}>
              <MessagesSquare aria-hidden />
              {t(order.role === 'BUYER' ? 'writeToSeller' : 'writeToBuyer')}
            </Link>
          </Button>
        </div>
      )}
    </aside>
  );
}
