'use client';

import { type Money, formatMoney } from '@biddy/shared';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * Szybkie kwoty (F-63, `quickBidAmounts` z @biddy/shared): trzy przyciski, które wpisują kwotę
 * do pola maksimum. Wybrana kwota ma `aria-pressed`.
 */
export function QuickBidAmounts({
  amounts,
  selected,
  onSelect,
}: {
  readonly amounts: readonly Money[];
  /** Kwota z pola (grosze) albo null. */
  readonly selected: number | null;
  readonly onSelect: (amount: number) => void;
}) {
  const t = useTranslations('auction.panel');
  return (
    <div role="group" aria-label={t('quickAmounts')} className="grid grid-cols-3 gap-2">
      {amounts.map((amount) => {
        const pressed = selected === amount.amount;
        return (
          <button
            key={amount.amount}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              onSelect(amount.amount);
            }}
            className={cn(
              'h-10 rounded-full border px-2 text-label font-bold whitespace-nowrap tabular-nums outline-none transition-colors focus-visible:shadow-focus-ring motion-reduce:transition-none',
              pressed
                ? 'border-brand-strong bg-brand-strong text-primary-foreground'
                : 'border-border-strong bg-card text-foreground hover:border-brand-border hover:bg-accent',
            )}
          >
            {formatMoney(amount, { trailingZeroDisplay: 'stripIfInteger' })}
          </button>
        );
      })}
    </div>
  );
}
