'use client';

// Strona sporu dla obu stron (F-28, PROJECT.md §7.5): bez sporu formularz zgłoszenia dla
// kupującego w oknie 36 h, ze sporem karta „Co teraz” z akcją strony, rozstrzygnięcie
// z uzasadnieniem, zwrot z odesłaniem, wyjaśnienia i historia. Z prawej podsumowanie zamówienia.
import {
  type DisputeDto,
  type OrderDetailsDto,
  isApiError,
  useGetOrder,
  useGetOrderDispute,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { track } from '@/analytics/posthog';
import { OrderSummary } from '@/components/orders/order-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DISPUTE_TONES, disputeDeadline } from '@/lib/disputes/dispute-view';
import { orderUrl } from '@/lib/routes';

import { DisputeComment, OfferAnswer, ReturnReview, SellerResponse } from './dispute-actions';
import { DisputeForm } from './dispute-form';
import { DisputeHistory } from './dispute-history';
import { DisputeReturn } from './dispute-return';

const notMissing = (count: number, error: unknown) =>
  !(isApiError(error) && error.status === 404) && count < 2;

export function DisputePanel({ publicId }: { readonly publicId: string }) {
  const t = useTranslations('dispute');
  const order = useGetOrder(publicId, { query: { retry: notMissing } });
  const dispute = useGetOrderDispute(publicId, { query: { retry: notMissing } });
  const tracked = useRef(false);

  useEffect(() => {
    if (dispute.data !== undefined && !tracked.current) {
      tracked.current = true;
      track('dispute_viewed', { role: dispute.data.role, status: dispute.data.status });
    }
  }, [dispute.data]);

  const disputeMissing = isApiError(dispute.error) && dispute.error.status === 404;
  if (order.isPending || (dispute.isPending && !disputeMissing)) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  const orderMissing = isApiError(order.error) && order.error.status === 404;
  if (order.isError || (dispute.isError && !disputeMissing)) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {orderMissing ? t('notFound') : t('error')}
        {orderMissing ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void order.refetch();
              void dispute.refetch();
            }}
          >
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  const view = order.data;
  const current = dispute.data;
  if (current === undefined && view.actions.openDispute === null) {
    return (
      <div role="alert" className="rounded-lg bg-canvas px-4 py-3 text-body-sm">
        {t('notFound')}{' '}
        <Link
          href={orderUrl(view.publicId)}
          className="font-semibold text-link underline-offset-3 hover:underline"
        >
          {t('backToOrder')}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-h2 md:text-h1">{t('title')}</h1>
          <p className="text-body font-semibold break-words text-foreground-secondary">
            {view.title}
          </p>
        </div>
        {current === undefined ? null : (
          <Badge tone={DISPUTE_TONES[current.status]}>{t(`statuses.${current.status}`)}</Badge>
        )}
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {current === undefined ? <DisputeOpen order={view} /> : <DisputeView dispute={current} />}
        </div>
        <OrderSummary order={view} />
      </div>
    </div>
  );
}

function DisputeOpen({ order }: { readonly order: OrderDetailsDto }) {
  const t = useTranslations('dispute.form');
  const format = useFormatter();
  const open = order.actions.openDispute;
  if (open === null || !open.allowed) {
    return (
      <p role="status" className="rounded-2xl border border-border bg-card p-5.5 text-body sm:p-7">
        {open === null
          ? t('unavailable')
          : t('closed', {
              date: format.dateTime(new Date(open.until), {
                dateStyle: 'long',
                timeStyle: 'short',
              }),
            })}
      </p>
    );
  }
  return <DisputeForm order={order} />;
}

function DisputeView({ dispute }: { readonly dispute: DisputeDto }) {
  return (
    <>
      <NowCard dispute={dispute} />
      <DisputeReturn dispute={dispute} />
      {dispute.actions.comment ? <DisputeComment dispute={dispute} /> : null}
      <DisputeHistory dispute={dispute} />
    </>
  );
}

/** „Co teraz”: stan sporu zdaniem dla oglądającego, jego akcja i rozstrzygnięcie. */
function NowCard({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute');
  const format = useFormatter();
  const deadline = disputeDeadline(dispute);
  const zl = (amount: number) =>
    formatMoney(money(amount, dispute.currency), { trailingZeroDisplay: 'stripIfInteger' });
  const role = dispute.role === 'SELLER' ? 'seller' : 'buyer';
  return (
    <section
      aria-labelledby="dispute-now-title"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 sm:p-7"
    >
      <h2 id="dispute-now-title" className="text-overline text-muted-foreground uppercase">
        {t('now')}
      </h2>
      <div role="status">
        <p className="text-title">
          {t(`${role}.${dispute.status}`, {
            date:
              deadline === null
                ? ''
                : format.dateTime(new Date(deadline), {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
            amount: zl(dispute.partialOffer ?? 0),
          })}
        </p>
      </div>
      {dispute.resolution === null ? null : <Resolution dispute={dispute} />}
      {dispute.actions.respond ? <SellerResponse dispute={dispute} /> : null}
      {dispute.actions.answerOffer ? <OfferAnswer dispute={dispute} /> : null}
      {dispute.actions.reviewReturn ? <ReturnReview dispute={dispute} /> : null}
      <p className="text-body-sm text-muted-foreground">
        {t('reasonLine', { reason: t(`reasons.${dispute.reason}`) })}
      </p>
    </section>
  );
}

/** Rozstrzygnięcie: wynik dla oglądającego, kto rozstrzygnął, uzasadnienie i stan zwrotu. */
function Resolution({ dispute }: { readonly dispute: DisputeDto }) {
  const t = useTranslations('dispute.resolution');
  const format = useFormatter();
  const resolution = dispute.resolution;
  if (resolution === null) {
    return null;
  }
  const zl = (amount: number) =>
    formatMoney(money(amount, dispute.currency), { trailingZeroDisplay: 'stripIfInteger' });
  const amount = zl(resolution.refundAmount ?? 0);
  const outcomeKey:
    | `${'buyer' | 'seller'}.${NonNullable<DisputeDto['resolution']>['outcome']}`
    | 'seller.FULL_REFUND_CARRIER' =
    dispute.role === 'SELLER'
      ? resolution.outcome === 'FULL_REFUND' && resolution.fault === 'CARRIER'
        ? 'seller.FULL_REFUND_CARRIER'
        : `seller.${resolution.outcome}`
      : `buyer.${resolution.outcome}`;
  const pending = resolution.resolvedAt === null;
  return (
    <div className="space-y-3 rounded-xl bg-canvas p-4">
      <p className="text-label text-foreground-secondary">
        {t(`decidedBy.${resolution.decidedBy}`)}
        {' · '}
        {format.dateTime(new Date(resolution.decidedAt), {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </p>
      <p className="text-body font-semibold">
        {pending ? t('awaitingReturn', { amount }) : t(outcomeKey, { amount })}
      </p>
      {resolution.sellerCosts === null ? null : (
        <p className="text-body-sm">{t('sellerCosts', { amount: zl(resolution.sellerCosts) })}</p>
      )}
      <div className="space-y-1">
        <p className="text-label text-foreground-secondary">{t('statement')}</p>
        <p className="text-body break-words whitespace-pre-line">{resolution.statement}</p>
      </div>
      {resolution.refund === null || dispute.role !== 'BUYER' ? null : (
        <p className="text-body-sm text-foreground-secondary">
          {t(`refund.${resolution.refund.status}`, {
            date:
              resolution.refund.succeededAt === null
                ? ''
                : format.dateTime(new Date(resolution.refund.succeededAt), { dateStyle: 'medium' }),
          })}
        </p>
      )}
    </div>
  );
}
