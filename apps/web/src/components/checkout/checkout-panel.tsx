'use client';

import { type CheckoutDto, isApiError, useGetCheckout, useGetMyAddresses } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { CircleCheck, Clock, Loader2, Smartphone, TimerOff } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';

import { track } from '@/analytics/posthog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { CHECKOUT_POLL_MS, checkoutStage } from '@/lib/checkout/checkout';
import { auctionUrl, routes, searchUrl } from '@/lib/routes';

import { CheckoutForm } from './checkout-form';
import { CheckoutSummary } from './checkout-summary';

function polling(view: CheckoutDto | undefined): boolean {
  return view !== undefined && checkoutStage(view) === 'waiting';
}

/** Karta stanu checkoutu (oczekiwanie, sukces, termin minął) w miejscu formularza. */
function StateCard({
  icon,
  tone,
  title,
  children,
  live,
}: {
  readonly icon: ReactNode;
  readonly tone: 'brand' | 'success' | 'warning';
  readonly title: string;
  readonly children: ReactNode;
  /** Region `role="status"`: czytnik ogłosi zmianę stanu. */
  readonly live?: boolean;
}) {
  return (
    <section
      role={live === true ? 'status' : undefined}
      aria-labelledby="checkout-state-title"
      className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <IconTile tone={tone} size="lg">
        {icon}
      </IconTile>
      <h2 id="checkout-state-title" className="text-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Checkout zamówienia (F-25): formularz dostawy i płatności, a po „Zapłać” stan płatności
 * odświeżany co 2 s (BLIK czeka na potwierdzenie w banku, powrót od operatora czeka na webhook).
 * Po opłaceniu karta „Zapłacone!” z terminem nadania, po terminie „Termin płatności minął”.
 */
export function CheckoutPanel({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('checkout');
  const format = useFormatter();
  const checkout = useGetCheckout(publicId, {
    query: {
      refetchInterval: (query) => (polling(query.state.data) ? CHECKOUT_POLL_MS : false),
      retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2,
    },
  });
  const addresses = useGetMyAddresses();
  const stage = checkout.data === undefined ? undefined : checkoutStage(checkout.data);
  const tracked = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (stage === undefined || tracked.current === stage) {
      return;
    }
    if (stage === 'paid' && tracked.current === 'waiting') {
      track('checkout_paid', {});
    } else if (stage === 'form' && tracked.current === undefined) {
      track('checkout_viewed', {});
    }
    if (stage === 'form' && checkout.data?.payment?.status === 'FAILED') {
      track('checkout_payment_failed', { reason: checkout.data.payment.failureReason });
    }
    tracked.current = stage;
  }, [stage, checkout.data]);

  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  const header = (view?: CheckoutDto) => {
    const extended = view !== undefined && view.order.effectiveDueAt !== view.order.paymentDueAt;
    return (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-h2 md:text-h1">{t('title')}</h1>
          {view === undefined ? null : (
            <p className="text-body font-semibold text-foreground-secondary tabular-nums">
              {t('order', { number: view.order.publicId })}
            </p>
          )}
        </div>
        {view === undefined ||
        view.order.status !== 'AWAITING_PAYMENT' ||
        stage === 'expired' ? null : (
          <p className="inline-flex items-center gap-2 rounded-full bg-warning-soft px-3.5 py-1.5 text-label text-amber-800">
            <Clock aria-hidden className="size-4" />
            {t(extended ? 'payByExtended' : 'payBy', {
              date: date(extended ? view.order.effectiveDueAt : view.order.paymentDueAt),
            })}
          </p>
        )}
      </div>
    );
  };

  if (checkout.isPending) {
    return (
      <div className="space-y-6">
        {header()}
        <div className="space-y-4" aria-busy="true">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }
  if (checkout.isError) {
    const missing = isApiError(checkout.error) && checkout.error.status === 404;
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
                onClick={() => void checkout.refetch()}
              >
                {t('retry')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const view = checkout.data;
  const { order, payment } = view;
  const zl = (amount: number) => formatMoney(money(amount, order.currency));
  const auctionHref = auctionUrl(order.auction);

  if (stage === 'form') {
    return (
      <div className="space-y-6">
        {header(view)}
        {addresses.isPending ? (
          <Skeleton className="h-96 w-full rounded-2xl" />
        ) : (
          <CheckoutForm
            publicId={publicId}
            view={view}
            defaultAddress={addresses.data?.find((address) => address.isDefault)}
          />
        )}
      </div>
    );
  }

  let card: ReactNode;
  if (stage === 'waiting') {
    const confirming = payment?.status === 'SUCCEEDED';
    const blik = payment?.method === 'BLIK' && payment.redirectUrl === null;
    card = (
      <StateCard
        live
        tone="brand"
        icon={
          blik && !confirming ? <Smartphone /> : <Loader2 className="motion-safe:animate-spin" />
        }
        title={t(
          confirming
            ? 'waiting.confirmingTitle'
            : blik
              ? 'waiting.blikTitle'
              : 'waiting.redirectTitle',
        )}
      >
        <p className="flex items-start gap-2.5 text-body text-foreground-secondary">
          {blik && !confirming ? (
            <Loader2 aria-hidden className="mt-1 size-4 shrink-0 motion-safe:animate-spin" />
          ) : null}
          {t(
            confirming
              ? 'waiting.confirmingText'
              : blik
                ? 'waiting.blikText'
                : 'waiting.redirectText',
          )}
        </p>
        {!confirming && payment?.redirectUrl !== null && payment?.redirectUrl !== undefined ? (
          <Button asChild variant="outline">
            <a href={payment.redirectUrl}>{t('waiting.redirectLink')}</a>
          </Button>
        ) : null}
      </StateCard>
    );
  } else if (stage === 'paid') {
    card = (
      <StateCard
        live
        tone="success"
        icon={<CircleCheck />}
        title={order.status === 'PAID' ? t('paid.title') : t('paid.already')}
      >
        <p className="text-body">
          {t('paid.text', { total: zl(order.total), number: order.publicId })}
        </p>
        {order.shipBy === null || order.status !== 'PAID' ? null : (
          <p className="text-body text-foreground-secondary">
            {t('paid.shipBy', {
              date: format.dateTime(new Date(order.shipBy), { day: 'numeric', month: 'long' }),
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2.5">
          <Button asChild>
            <Link href={routes.myWins}>{t('paid.myBiddy')}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={auctionHref}>{t('paid.auction')}</Link>
          </Button>
        </div>
      </StateCard>
    );
  } else {
    card = (
      <StateCard tone="warning" icon={<TimerOff />} title={t('expired.title')}>
        <p className="text-body text-foreground-secondary">{t('expired.text')}</p>
        <Button asChild variant="outline">
          <Link href={searchUrl(order.title)}>{t('expired.similar')}</Link>
        </Button>
      </StateCard>
    );
  }

  return (
    <div className="space-y-6">
      {header(view)}
      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">{card}</div>
        <CheckoutSummary view={view} shippingFee={order.shippingFee} total={order.total} />
      </div>
    </div>
  );
}
