'use client';

import {
  type SellerBalanceDto,
  getGetMyBalanceQueryKey,
  getGetPayoutProfileQueryKey,
  useGetMyBalance,
  usePatchPayoutSettings,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ORDER_TONES } from '@/lib/orders/order-view';
import { orderUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { BalanceHistory } from './balance-history';
import { PayoutCard } from './payout-card';

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

/**
 * Saldo i wypłaty (F-27): kafle sald z ledgera, karta wypłaty z powodem blokady, wypłata
 * tygodniowa, zamówienia w trakcie i historia ruchów salda. Dane z `GET /me/balance`.
 */
export function SellerBalance() {
  const t = useTranslations('balance');
  const balance = useGetMyBalance();

  if (balance.isPending) {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (balance.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void balance.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const view = balance.data;
  return (
    <div className="space-y-6">
      <BalanceTiles balance={view} />
      <PayoutCard balance={view} />
      <WeeklyPayouts enabled={view.payout.weeklyPayouts} minimum={view.minimumPayout} />
      <InProgress orders={view.inProgressOrders} />
      <BalanceHistory />
    </div>
  );
}

function BalanceTiles({ balance }: { readonly balance: SellerBalanceDto }) {
  const t = useTranslations('balance.tiles');
  const tiles = [
    { key: 'inProgress', amount: balance.inProgress, hint: t('inProgressHint'), show: true },
    {
      key: 'inTransit',
      amount: balance.payoutsInTransit,
      hint: t('inTransitHint'),
      show: balance.payoutsInTransit > 0,
    },
    {
      key: 'receivable',
      amount: balance.receivable,
      hint: t('receivableHint'),
      show: balance.receivable > 0,
    },
  ] as const;
  return (
    <section aria-label={t('label')} className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-5 sm:col-span-2 sm:p-6">
        <h2 className="text-label text-foreground-secondary">{t('available')}</h2>
        <p className="mt-1 text-price-xl tabular-nums">{zl(balance.available)}</p>
      </div>
      {tiles
        .filter((tile) => tile.show)
        .map((tile) => (
          <div
            key={tile.key}
            className={cn(
              'rounded-xl border bg-card p-5',
              tile.key === 'receivable' ? 'border-amber-200 bg-warning-soft' : 'border-border',
            )}
          >
            <h2 className="text-label text-foreground-secondary">{t(tile.key)}</h2>
            <p className="mt-1 text-h2 tabular-nums">{zl(tile.amount)}</p>
            <p className="mt-1 text-body-sm text-foreground-secondary">{tile.hint}</p>
          </div>
        ))}
    </section>
  );
}

function WeeklyPayouts({
  enabled,
  minimum,
}: {
  readonly enabled: boolean;
  readonly minimum: number;
}) {
  const t = useTranslations('balance.weekly');
  const id = useId();
  const queryClient = useQueryClient();
  const settings = usePatchPayoutSettings();
  const [error, setError] = useState(false);

  const change = async (checked: boolean) => {
    setError(false);
    try {
      await settings.mutateAsync({ data: { weeklyPayouts: checked } });
      track('weekly_payouts_toggled', { enabled: checked });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMyBalanceQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPayoutProfileQueryKey() }),
      ]);
    } catch {
      setError(true);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-5 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-label`} className="text-title">
            {t('label')}
          </h2>
          <p id={`${id}-hint`} className="text-body-sm text-foreground-secondary">
            {t('hint', { minimum: zl(minimum) })}
          </p>
        </div>
        <Switch
          checked={
            settings.isPending ? (settings.variables?.data.weeklyPayouts ?? enabled) : enabled
          }
          disabled={settings.isPending}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(checked) => {
            void change(checked);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {t('error')}
        </p>
      ) : null}
    </section>
  );
}

function InProgress({ orders }: { readonly orders: SellerBalanceDto['inProgressOrders'] }) {
  const t = useTranslations('balance.inProgress');
  const status = useTranslations('order.statuses');
  return (
    <section aria-labelledby="balance-in-progress" className="space-y-3">
      <h2 id="balance-in-progress" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      {orders.length === 0 ? (
        <p className="text-body-sm text-foreground-secondary">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {orders.map((order) => (
            <li key={order.publicId} className="flex items-center gap-3.5 p-4">
              {order.photoUrl === null ? (
                <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <ImageOff aria-hidden className="size-5" />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura z CDN zdjęć
                <img
                  src={order.photoUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-md object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={orderUrl(order.publicId)}
                  className="line-clamp-2 rounded-xs text-label break-words text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
                >
                  {order.title}
                </Link>
                <Badge tone={ORDER_TONES[order.status]} className="mt-1">
                  {status(order.status)}
                </Badge>
              </div>
              <span className="shrink-0 text-label tabular-nums">{zl(order.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
