'use client';

// Historia salda (F-27): ruchy salda od najnowszego, po 20 na stronę. „Pokaż starsze” dokleja
// kolejną stronę (kursor z poprzedniej), więc wcześniej wczytane pozycje zostają na miejscu.
import { useGetMyBalanceHistory } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type HistoryItem, historyLabel } from '@/lib/payouts/payout-view';
import { orderUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

const PAYOUT_TONES = { PENDING: 'info', PAID: 'success', FAILED: 'warning' } as const;

/** Kwota ze znakiem: „+120 zł” albo „−120 zł”. */
function signed(amount: number): string {
  const text = formatMoney(money(Math.abs(amount)), { trailingZeroDisplay: 'stripIfInteger' });
  return amount < 0 ? `−${text}` : `+${text}`;
}

export function BalanceHistory() {
  const t = useTranslations('balance.history');
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  return (
    <section aria-labelledby="balance-history" className="space-y-3">
      <h2 id="balance-history" className="text-overline text-muted-foreground uppercase">
        {t('title')}
      </h2>
      {cursors.map((cursor, index) => (
        <HistoryPage
          key={cursor ?? 'first'}
          cursor={cursor}
          last={index === cursors.length - 1}
          onMore={(next) => {
            setCursors((current) => [...current, next]);
          }}
        />
      ))}
    </section>
  );
}

function HistoryPage({
  cursor,
  last,
  onMore,
}: {
  readonly cursor: string | undefined;
  readonly last: boolean;
  readonly onMore: (cursor: string) => void;
}) {
  const t = useTranslations('balance.history');
  const page = useGetMyBalanceHistory(cursor === undefined ? undefined : { cursor });

  if (page.isPending) {
    return (
      <div aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (page.isError) {
    return (
      <p role="alert" className="text-body-sm text-destructive">
        {t('error')}
      </p>
    );
  }
  if (page.data.items.length === 0 && cursor === undefined) {
    return <p className="text-body-sm text-foreground-secondary">{t('empty')}</p>;
  }
  const next = page.data.nextCursor;
  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {page.data.items.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))}
      </ul>
      {last && next !== null ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onMore(next);
          }}
        >
          {t('more')}
        </Button>
      ) : null}
    </>
  );
}

function HistoryRow({ item }: { readonly item: HistoryItem }) {
  const t = useTranslations('balance.history');
  const format = useFormatter();
  const label = t(`types.${historyLabel(item.type)}`, {
    account: item.payout?.bankAccountMasked ?? '',
  });
  const change = item.available !== 0 ? item.available : -item.receivable;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4">
      <div className="min-w-0 flex-[1_1_14rem] space-y-1">
        <p className="text-label break-words">
          {item.order === null ? (
            label
          ) : (
            <>
              {label}
              {' · '}
              <Link
                href={orderUrl(item.order.publicId)}
                className="rounded-xs text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
              >
                {item.order.title}
              </Link>
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-foreground-secondary">
          <time dateTime={item.occurredAt}>
            {format.dateTime(new Date(item.occurredAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
          {item.payout === null ? null : (
            <Badge tone={PAYOUT_TONES[item.payout.status]}>
              {t(`payoutStatus.${item.payout.status}`)}
            </Badge>
          )}
          {item.receivable === 0 || item.available === 0 ? null : (
            <span>{t('receivable', { amount: signed(item.receivable) })}</span>
          )}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 text-label tabular-nums',
          change > 0 ? 'text-success' : 'text-foreground',
        )}
      >
        {signed(change)}
      </span>
    </li>
  );
}
