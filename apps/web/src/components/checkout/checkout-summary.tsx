'use client';

import type { CheckoutDto } from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { routes } from '@/lib/routes';

/**
 * Podsumowanie checkoutu (F-25): przedmiot, cena, POK, dostawa i suma do zapłaty. Od 1024 px
 * przyklejone obok formularza; `children` to przycisk płatności (tylko w formularzu).
 */
export function CheckoutSummary({
  view,
  shippingFee,
  total,
  children,
}: {
  readonly view: CheckoutDto;
  /** Dostawa wybrana w formularzu (przed zapisem) albo zapisana; null przed wyborem. */
  readonly shippingFee: number | null;
  readonly total: number;
  readonly children?: ReactNode;
}) {
  const t = useTranslations('checkout.summary');
  const { order } = view;
  const zl = (amount: number) => formatMoney(money(amount, order.currency));
  return (
    <aside
      aria-labelledby="checkout-summary"
      className="space-y-4 rounded-2xl border border-border bg-card p-5.5 lg:sticky lg:top-22"
    >
      <h2 id="checkout-summary" className="text-overline text-muted-foreground uppercase">
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
        <p className="min-w-0 text-title break-words">{order.title}</p>
      </div>
      <dl className="space-y-2.5 border-t border-ink-100 pt-3.5 text-body-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('price')}</dt>
          <dd className="font-bold tabular-nums">{zl(order.itemsTotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">
            {t('pok')}{' '}
            <Link
              href={routes.buyerProtection}
              className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
            >
              {t('pokLink')}
            </Link>
          </dt>
          <dd className="font-bold tabular-nums">{zl(order.pokFee)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('shipping')}</dt>
          <dd className="font-bold tabular-nums">
            {shippingFee === null ? (
              <span className="font-medium text-muted-foreground">{t('shippingNone')}</span>
            ) : (
              zl(shippingFee)
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-100 pt-3">
          <dt className="text-title">{t('total')}</dt>
          <dd className="text-price-lg tabular-nums" data-testid="checkout-total">
            {zl(total)}
          </dd>
        </div>
      </dl>
      {children}
      <p className="text-caption text-muted-foreground">
        {t('notPickedUp')}{' '}
        <Link
          href={routes.terms}
          className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
        >
          {t('terms')}
        </Link>
      </p>
    </aside>
  );
}
