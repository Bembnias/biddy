'use client';

import {
  type OrderDetailsDto,
  getGetOrderQueryKey,
  isApiError,
  relistAuction,
  sendSecondChance,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Gift, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { listingWizardUrl } from '@/lib/routes';

/**
 * Druga szansa (F-26, §6.8) dla sprzedającego anulowanego zamówienia: następna osoba
 * z licytacji (zanonimizowana) z jej najwyższą ofertą, „Wyślij ofertę”, wysłane oferty ze stanem
 * i „Wystaw ponownie” jako druga droga.
 */
export function SecondChanceCard({
  order,
  secondChance,
}: {
  readonly order: OrderDetailsDto;
  readonly secondChance: NonNullable<OrderDetailsDto['secondChance']>;
}) {
  const t = useTranslations('order.secondChance');
  const errors = useTranslations('order');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'send' | 'relist'>();
  const [error, setError] = useState<string>();
  const zl = (amount: number) => formatMoney(money(amount, order.currency));
  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  const run = async (kind: 'send' | 'relist', action: () => Promise<void>) => {
    setBusy(kind);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      const detail = isApiError(caught)
        ? (caught.problem as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : errors('actionError'));
    } finally {
      setBusy(undefined);
    }
  };

  const reason = secondChance.unavailableReason;
  return (
    <section
      aria-labelledby="second-chance-title"
      className="space-y-4 rounded-2xl border border-brand-border bg-card p-5.5 sm:p-7"
    >
      <div className="flex items-center gap-3">
        <IconTile tone="brand">
          <Gift />
        </IconTile>
        <h2 id="second-chance-title" className="text-h3">
          {t('title')}
        </h2>
      </div>
      <p className="text-body text-foreground-secondary">{t('lead')}</p>

      {secondChance.next !== null && reason === null ? (
        <div className="space-y-3 rounded-xl bg-accent px-4 py-3.5">
          <p className="text-body font-semibold text-accent-foreground">
            {t('next', {
              bidder: secondChance.next.bidder,
              amount: zl(secondChance.next.amount),
            })}
          </p>
          <Button
            type="button"
            variant="cta"
            disabled={busy !== undefined}
            onClick={() =>
              void run('send', async () => {
                const updated = await sendSecondChance(order.publicId);
                queryClient.setQueryData(getGetOrderQueryKey(order.publicId), updated);
                track('second_chance_sent', {});
              })
            }
          >
            {busy === 'send' ? t('sending') : t('send')}
          </Button>
          {secondChance.sendBy === null ? null : (
            <p className="text-caption text-accent-foreground">
              {t('sendBy', { date: date(secondChance.sendBy) })}
            </p>
          )}
        </div>
      ) : reason === null ? null : (
        <p className="text-body-sm text-foreground-secondary">{t(`reasons.${reason}`)}</p>
      )}

      {secondChance.offers.length === 0 ? null : (
        <div className="space-y-2">
          <h3 className="text-label text-foreground-secondary">{t('offers')}</h3>
          <ul className="space-y-1.5 text-body-sm">
            {secondChance.offers.map((offer) => (
              <li key={offer.id}>
                <span className="font-semibold">
                  {offer.bidder}, {zl(offer.amount)}
                </span>
                {': '}
                {t(`statuses.${offer.status}`, {
                  date: date(offer.expiresAt),
                  number: offer.orderPublicId ?? '',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {reason === 'NOT_LATEST_ORDER' ? null : (
        <div className="space-y-2 border-t border-ink-100 pt-4">
          <p className="text-body-sm text-foreground-secondary">{t('relistHint')}</p>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== undefined}
            onClick={() =>
              void run('relist', async () => {
                const draft = await relistAuction(order.auction.id);
                track('auction_relisted');
                router.push(listingWizardUrl(draft.id));
              })
            }
          >
            <RotateCcw aria-hidden />
            {t('relist')}
          </Button>
        </div>
      )}
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
