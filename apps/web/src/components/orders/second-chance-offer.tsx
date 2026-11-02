'use client';

import {
  acceptSecondChanceOffer,
  declineSecondChanceOffer,
  getGetSecondChanceOfferQueryKey,
  isApiError,
  type SecondChanceOfferDto,
  useGetSecondChanceOffer,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Gift, ImageOff, TimerOff, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';

import { track } from '@/analytics/posthog';
import { useServerNow } from '@/components/auction/use-auction';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { auctionUrl, checkoutUrl, searchUrl } from '@/lib/routes';

/**
 * Oferta drugiej szansy dla licytującego (F-26, §6.8): przedmiot, cena (jego najwyższa oferta),
 * POK i suma bez dostawy, termin, „Kup za …” i „Nie, dziękuję”. Akceptacja prowadzi do checkoutu
 * nowego zamówienia; odrzucenie nie ma konsekwencji.
 */
export function SecondChanceOffer({ offerId }: { readonly offerId: string }) {
  const t = useTranslations('secondChanceOffer');
  const format = useFormatter();
  const router = useRouter();
  const queryClient = useQueryClient();
  const offer = useGetSecondChanceOffer(offerId, {
    query: { retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 2 },
  });
  const [busy, setBusy] = useState<'accept' | 'decline'>();
  const [error, setError] = useState<string>();
  const now = useServerNow();

  if (offer.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }
  if (offer.isError) {
    const missing = isApiError(offer.error) && offer.error.status === 404;
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {missing ? t('notFound') : t('error')}
        {missing ? null : (
          <Button type="button" variant="outline" size="sm" onClick={() => void offer.refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  const view = offer.data;
  const zl = (amount: number) => formatMoney(money(amount, view.currency));
  // Wygaśnięcie przed jobem (do minuty): oferty po terminie nie da się już przyjąć.
  const expired =
    view.status === 'EXPIRED' ||
    (view.status === 'PENDING' && now !== null && Date.parse(view.expiresAt) <= now);

  const respond = async (kind: 'accept' | 'decline') => {
    setBusy(kind);
    setError(undefined);
    try {
      const updated: SecondChanceOfferDto =
        kind === 'accept'
          ? await acceptSecondChanceOffer(offerId)
          : await declineSecondChanceOffer(offerId);
      queryClient.setQueryData(getGetSecondChanceOfferQueryKey(offerId), updated);
      track(kind === 'accept' ? 'second_chance_accepted' : 'second_chance_declined', {});
      if (updated.orderPublicId !== null) {
        router.push(checkoutUrl(updated.orderPublicId));
      }
    } catch (caught) {
      const detail = isApiError(caught)
        ? (caught.problem as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : t('actionError'));
    } finally {
      setBusy(undefined);
    }
  };

  if (view.status === 'ACCEPTED' && view.orderPublicId !== null) {
    return (
      <Outcome icon={<CircleCheck />} tone="success" title={t('accepted')}>
        <p className="text-body text-foreground-secondary">
          {t('acceptedText', { number: view.orderPublicId })}
        </p>
        <Button asChild variant="cta">
          <Link href={checkoutUrl(view.orderPublicId)}>{t('pay')}</Link>
        </Button>
      </Outcome>
    );
  }
  if (view.status === 'DECLINED' || expired) {
    return (
      <Outcome
        icon={view.status === 'DECLINED' ? <X /> : <TimerOff />}
        tone="neutral"
        title={view.status === 'DECLINED' ? t('declined') : t('expired')}
      >
        <p className="text-body text-foreground-secondary">
          {view.status === 'DECLINED' ? t('declinedText') : t('expiredText')}
        </p>
        <Button asChild variant="outline">
          <Link href={searchUrl(view.title)}>{t('similar')}</Link>
        </Button>
      </Outcome>
    );
  }

  return (
    <section
      aria-labelledby="second-chance-offer-title"
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="flex items-center gap-3">
        <IconTile tone="won">
          <Gift />
        </IconTile>
        <h1 id="second-chance-offer-title" className="text-h2">
          {t('title')}
        </h1>
      </div>
      <p className="text-body text-foreground-secondary">{t('lead')}</p>
      <div className="flex items-center gap-3.5">
        {view.photoUrl === null ? (
          <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <ImageOff aria-hidden className="size-6" />
          </span>
        ) : (
          // Miniatura WebP z CDN.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.photoUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="text-title break-words">{view.title}</p>
          <Link
            href={auctionUrl(view.auction)}
            className="text-body-sm font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
          >
            {t('auction')}
          </Link>
        </div>
      </div>
      <dl className="space-y-2.5 border-t border-ink-100 pt-3.5 text-body-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('price')}</dt>
          <dd className="font-bold tabular-nums">{zl(view.amount)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-foreground-secondary">{t('pok')}</dt>
          <dd className="font-bold tabular-nums">{zl(view.pokFee)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-ink-100 pt-3">
          <dt className="text-title">{t('total')}</dt>
          <dd className="text-price-lg tabular-nums">{zl(view.total)}</dd>
        </div>
      </dl>
      <p className="inline-flex rounded-full bg-warning-soft px-3.5 py-1.5 text-label text-amber-800">
        {t('validUntil', {
          date: format.dateTime(new Date(view.expiresAt), {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Button
          type="button"
          variant="cta"
          disabled={busy !== undefined}
          onClick={() => void respond('accept')}
        >
          {busy === 'accept' ? t('buying') : t('buy', { amount: zl(view.amount) })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy !== undefined}
          onClick={() => void respond('decline')}
        >
          {t('decline')}
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <p className="text-caption text-muted-foreground">{t('hint')}</p>
    </section>
  );
}

function Outcome({
  icon,
  tone,
  title,
  children,
}: {
  readonly icon: ReactNode;
  readonly tone: 'success' | 'neutral';
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      role="status"
      aria-labelledby="second-chance-outcome-title"
      className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <IconTile tone={tone} size="lg">
        {icon}
      </IconTile>
      <h1 id="second-chance-outcome-title" className="text-h2">
        {title}
      </h1>
      {children}
    </section>
  );
}
