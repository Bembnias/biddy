'use client';

import type { MyBiddingDto, MyBiddingDtoOrderStatus, PublicAuctionDto } from '@biddy/api-client';
import { Check, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { shortMoney } from '@/lib/auction/auction-state';
import { checkoutUrl, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Konfetti (ozdoba): pozycje w procentach, kształt, kolor z palety i obrót. */
const CONFETTI = [
  { left: 9, top: 11, shape: 'bar', color: 'bg-pink-300', rotate: 20 },
  { left: 24, top: 6, shape: 'dot', color: 'bg-amber-300', rotate: 0 },
  { left: 43, top: 9, shape: 'bar', color: 'bg-white/80', rotate: -30 },
  { left: 64, top: 5, shape: 'dot', color: 'bg-pink-300', rotate: 0 },
  { left: 84, top: 12, shape: 'bar', color: 'bg-amber-300', rotate: 45 },
  { left: 91, top: 46, shape: 'dot', color: 'bg-white/70', rotate: 0 },
  { left: 78, top: 80, shape: 'bar', color: 'bg-pink-300', rotate: -15 },
  { left: 5, top: 70, shape: 'bar', color: 'bg-amber-300', rotate: 30 },
] as const;

/**
 * Bieżący krok „Co dalej”: 0 płatność, 1 nadanie, 2 odbiór, 3 wszystkie za nami. Null: zamówienie
 * poza zwykłą ścieżką (anulowane, spór, zwrot); jego stan pokazuje Moje Biddy.
 */
export function winStep(status: MyBiddingDtoOrderStatus | null): number | null {
  switch (status) {
    case null:
    case 'AWAITING_PAYMENT':
      return 0;
    case 'PAID':
      return 1;
    case 'SHIPPED':
    case 'DELIVERED':
      return 2;
    case 'COMPLETED':
      return 3;
    case 'DISPUTED':
    case 'NOT_PICKED_UP':
    case 'LOST':
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
    case 'CANCELLED_UNPAID':
    case 'CANCELLED_NOT_SHIPPED':
      return null;
  }
}

/**
 * Moment wygranej (F-63, decyzja D2): panel na stronie aukcji zamiast osobnego ekranu. Pełny
 * fiolet z konfetti, „Wygrana!”, cena końcowa i trzy kroki „Co dalej”. Akcja prowadzi do checkoutu
 * (F-25), a przed utworzeniem zamówienia do Moje Biddy.
 */
export function WinPanel({
  auction,
  bidding,
}: {
  readonly auction: PublicAuctionDto;
  readonly bidding: MyBiddingDto;
}) {
  const t = useTranslations('auction.win');
  const format = useFormatter();
  const finalPrice = auction.currentPrice ?? auction.startPrice;
  const order = bidding.order;
  const current = winStep(order?.status ?? null);

  useEffect(() => {
    track('win_viewed', { auctionId: auction.id });
  }, [auction.id]);

  return (
    <section
      aria-labelledby="win-title"
      data-testid="bidder-status"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-md"
    >
      <div className="relative isolate overflow-hidden bg-linear-to-br from-violet-600 to-violet-800 px-6 py-7 text-primary-foreground">
        <div aria-hidden className="absolute inset-0 -z-10">
          {CONFETTI.map((piece) => (
            <span
              key={`${String(piece.left)}-${String(piece.top)}`}
              className={cn(
                'absolute animate-confetti',
                piece.color,
                piece.shape === 'bar' ? 'h-1.5 w-3.5 rounded-xs' : 'size-2 rounded-full',
              )}
              style={{
                left: `${String(piece.left)}%`,
                top: `${String(piece.top)}%`,
                transform: `rotate(${String(piece.rotate)}deg)`,
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-card text-violet-700 shadow-lg"
          >
            <Trophy className="size-6" />
          </span>
          {auction.endsAt === null ? null : (
            <span className="text-overline uppercase">
              {t('ended', {
                time: format.dateTime(new Date(auction.endsAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </span>
          )}
        </div>
        <h2 id="win-title" className="mt-5 text-h1">
          {t('title')}
        </h2>
        <p className="mt-1 text-h3">{t('subtitle')}</p>
        <div className="mt-5 rounded-xl border border-white/25 bg-white/10 px-4 py-3">
          <p className="text-overline text-violet-100 uppercase">{t('finalPrice')}</p>
          <p className="text-price-xl tabular-nums">{shortMoney(finalPrice)}</p>
          <p className="text-body-sm text-violet-100">
            {t('stats', {
              count: auction.bidCount,
              max: shortMoney(bidding.maxAmount ?? finalPrice),
            })}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <div>
          {order === null ? null : (
            // Bez wielkich liter: numer zamówienia rozróżnia wielkość liter.
            <p className="text-overline text-muted-foreground">
              {t('order', { number: order.publicId })}
            </p>
          )}
          <h3 className="text-h3">{t('nextTitle')}</h3>
        </div>
        {current === null ? null : (
          <ol className="space-y-0">
            {[
              {
                id: 'pay',
                title:
                  current > 0
                    ? t('payTitleDone')
                    : order === null
                      ? t('payTitlePending')
                      : t('payTitle', {
                          date: format.dateTime(new Date(order.paymentDueAt), {
                            dateStyle: 'long',
                            timeStyle: 'short',
                          }),
                        }),
                text: t('payText'),
              },
              {
                id: 'ship',
                title: current > 1 ? t('shipTitleDone') : t('shipTitle'),
                text: t('shipText'),
              },
              {
                id: 'confirm',
                title: current > 2 ? t('confirmTitleDone') : t('confirmTitle'),
                text: t('confirmText'),
              },
            ].map((step, index, steps) => (
              <li
                key={step.id}
                aria-current={index === current ? 'step' : undefined}
                className="flex gap-4"
              >
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-9 shrink-0 place-items-center rounded-full text-label font-extrabold',
                      index < current && 'bg-success-soft text-success',
                      index === current && 'border-2 border-amber-500 bg-warning-soft text-warning',
                      index > current && 'bg-muted text-foreground-secondary',
                    )}
                  >
                    {index < current ? <Check className="size-4" /> : index + 1}
                  </span>
                  {index < steps.length - 1 ? (
                    <span
                      aria-hidden
                      className={cn(
                        'min-h-6 w-0.5 flex-1',
                        index < current ? 'bg-success' : 'bg-border',
                      )}
                    />
                  ) : null}
                </div>
                <div className={cn('flex flex-col', index < steps.length - 1 && 'pb-5')}>
                  <span className={cn('text-title', index === current && 'font-extrabold')}>
                    {step.title}
                  </span>
                  <span className="text-body-sm text-foreground-secondary">{step.text}</span>
                </div>
              </li>
            ))}
          </ol>
        )}

        {order === null ? null : (
          <dl className="space-y-2 rounded-xl border border-border bg-canvas px-5 py-4 text-body-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-secondary">{t('finalPrice')}</dt>
              <dd className="font-bold tabular-nums">{shortMoney(finalPrice)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-secondary">{t('pok')}</dt>
              <dd className="font-bold tabular-nums">{shortMoney(order.total - finalPrice)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2.5">
              <dt className="font-extrabold">{t('total')}</dt>
              <dd className="text-price tabular-nums">{shortMoney(order.total)}</dd>
            </div>
          </dl>
        )}

        {order !== null && order.status === 'AWAITING_PAYMENT' ? (
          <Button asChild variant="cta" size="lg" className="w-full">
            <Link href={checkoutUrl(order.publicId)}>
              {t('pay', { total: shortMoney(order.total) })}
            </Link>
          </Button>
        ) : null}
        <Button
          asChild
          variant={order !== null && order.status === 'AWAITING_PAYMENT' ? 'ghost' : 'cta'}
          size="lg"
          className="w-full"
        >
          <Link href={routes.myWins}>{t('cta')}</Link>
        </Button>
      </div>
    </section>
  );
}
