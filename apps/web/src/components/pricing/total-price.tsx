'use client';

import { type FeeScheduleDto, useGetCurrentFeeSchedule } from '@biddy/api-client';
import {
  calculatePok,
  type FeeSchedule,
  feeTierRanges,
  formatMoney,
  type Money,
  type PokQuote,
} from '@biddy/shared';
import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Oferta, maksimum licytacji automatycznej albo Kup teraz. */
export type TotalPriceKind = 'bid' | 'maxBid' | 'buyNow';

const percent = new Intl.NumberFormat('pl-PL', { style: 'percent', maximumFractionDigits: 2 });
const short = (amount: Money) => formatMoney(amount, { trailingZeroDisplay: 'stripIfInteger' });

/** POK albo undefined, gdy kwoty nie da się policzyć (np. kwota w innej walucie niż cennik). */
function quoteOf(amount: Money, schedule: FeeSchedule | undefined): PokQuote | undefined {
  if (schedule === undefined) {
    return undefined;
  }
  try {
    return calculatePok(amount, schedule);
  } catch {
    return undefined;
  }
}

/**
 * Cena łączna (F-13, PROJECT.md §3.1): „Licytujesz 100 zł · zapłacisz 109,99 zł + dostawa od
 * 12,99 zł” i rozwijane „Skąd ta kwota?”. Kwotę liczy `calculatePok` z @biddy/shared, tak samo
 * jak backend; cennik pochodzi z `GET /v1/fee-schedules/current` (albo z renderowania na
 * serwerze przez `initialFeeSchedule`). Bez cennika komponent nie podaje kwoty łącznej.
 */
export function TotalPrice({
  amount,
  kind = 'bid',
  shippingFrom,
  initialFeeSchedule,
  withDetails = true,
  className,
}: {
  readonly amount: Money;
  readonly kind?: TotalPriceKind;
  /** Najtańsza dostawa; bez niej komponent pomija „+ dostawa od”. */
  readonly shippingFrom?: Money | null | undefined;
  readonly initialFeeSchedule?: FeeScheduleDto | undefined;
  /** false: sama linia z kwotą (np. obok przycisku), bez „Skąd ta kwota?”. */
  readonly withDetails?: boolean;
  readonly className?: string;
}) {
  const t = useTranslations('pricing.total');
  const { data: schedule, isPending } = useGetCurrentFeeSchedule(undefined, {
    query: {
      staleTime: 60_000,
      ...(initialFeeSchedule === undefined ? {} : { initialData: initialFeeSchedule }),
    },
  });
  const quote = quoteOf(amount, schedule);
  const shipping = shippingFrom ?? undefined;

  let total;
  if (quote !== undefined) {
    total = <strong className="font-semibold text-foreground">{short(quote.total)}</strong>;
  } else if (isPending) {
    total = (
      <>
        <Skeleton aria-hidden className="inline-block h-4 w-16 align-middle" />
        <span className="sr-only">{t('calculating')}</span>
      </>
    );
  }

  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      <p>
        {t('lead', { kind, amount: short(amount) })}
        {total === undefined ? (
          <> {t('unavailable')}</>
        ) : (
          <>
            {' · '}
            {t('pay', { kind })} {total}
          </>
        )}
        {shipping === undefined ? null : <> {t('shipping', { shipping: short(shipping) })}</>}
      </p>
      {withDetails && quote !== undefined && schedule !== undefined ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-foreground underline-offset-4 hover:underline">
            {t('details')}
          </summary>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>{t('amount', { kind })}</dt>
            <dd className="text-end tabular-nums">{formatMoney(amount)}</dd>
            <dt>
              {t('pok')}
              <span className="block text-xs">{pokRule(schedule, t)}</span>
            </dt>
            <dd className="text-end tabular-nums">{formatMoney(quote.fee)}</dd>
            <dt className="font-medium text-foreground">{t('subtotal')}</dt>
            <dd className="text-end font-medium text-foreground tabular-nums">
              {formatMoney(quote.total)}
            </dd>
            {shipping === undefined ? null : (
              <>
                <dt>{t('shippingRow')}</dt>
                <dd className="text-end">
                  {t('shippingFrom', { kind, shipping: formatMoney(shipping) })}
                </dd>
              </>
            )}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

/** Opis cennika, np. „2,99 zł + 7% kwoty do 1000 zł + 4% nadwyżki”. */
function pokRule(
  schedule: FeeSchedule,
  t: ReturnType<typeof useTranslations<'pricing.total'>>,
): string {
  const ranges = feeTierRanges(schedule);
  const rates = ranges
    .map((range, index) => {
      const rate = percent.format(range.bp / 10_000);
      if (ranges.length === 1) {
        return t('tierOnly', { rate });
      }
      if (range.upTo === null) {
        return t('tierLast', { rate });
      }
      return index === 0
        ? t('tierFirst', { rate, upTo: short(range.upTo) })
        : t('tierMiddle', { rate, from: short(range.from), upTo: short(range.upTo) });
    })
    .join(' + ');
  return schedule.fixedFee === 0
    ? rates
    : t('pokRule', {
        fixedFee: short({ amount: schedule.fixedFee, currency: schedule.currency }),
        rates,
      });
}
