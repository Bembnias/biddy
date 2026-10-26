'use client';

import type { PublicAuctionDto } from '@biddy/api-client';
import { timerTone } from '@biddy/shared';
import { Clock, Timer } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  type AuctionPhase,
  clockParts,
  remainingParts,
  shortMoney,
} from '@/lib/auction/auction-state';
import { cn } from '@/lib/utils';

import { LiveDot } from './live-badge';

/**
 * Licznik do końca aukcji (F-62, „Puls licytacji” F-63) albo wynik aukcji. Tony: ≥ 24 h spokojny,
 * < 24 h fioletowy (gg:mm:ss), < 1 h czerwony w kafelkach; w oknie anti-snipingu „Ostatnie
 * minuty” z paskiem pozostałego czasu okna.
 */
export function Countdown({
  auction,
  phase,
  now,
}: {
  readonly auction: PublicAuctionDto;
  readonly phase: AuctionPhase;
  readonly now: number | null;
}) {
  const t = useTranslations('auction.panel');
  const format = useFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const banner = (text: string) => (
    <p className="flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-label text-ink-700">
      <Clock aria-hidden className="size-4.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
  switch (phase) {
    case 'sold':
      return banner(t('sold', { price: shortMoney(auction.currentPrice ?? auction.startPrice) }));
    case 'unsold':
      return banner(t('unsold'));
    case 'cancelled':
      return banner(t('cancelled'));
    case 'closing':
      return banner(t('closing'));
    case 'scheduled':
      return auction.startsAt === null
        ? null
        : banner(t('scheduled', { date: date(auction.startsAt) }));
    case 'active':
    case 'ending':
      break;
  }
  if (auction.endsAt === null) {
    return null;
  }
  const left = now === null ? null : Date.parse(auction.endsAt) - now;
  const tone = phase === 'ending' ? 'urgent' : left === null ? 'calm' : timerTone(left);
  const windowMs = auction.extensionWindowSeconds * 1000;

  return (
    <div className="space-y-2">
      <div
        data-tone={tone}
        className={cn(
          'space-y-2 rounded-lg px-4 py-3',
          tone === 'urgent' && 'border border-red-200 bg-urgent-soft text-urgent',
          tone === 'soon' && 'bg-accent text-accent-foreground',
          tone === 'calm' && 'bg-muted text-ink-700',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2">
            {phase === 'ending' ? (
              <LiveDot className="text-live-dot" />
            ) : (
              <Timer aria-hidden className="size-5 shrink-0" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="text-label font-extrabold">
                {phase === 'ending' ? t('lastMinutes') : t('endsIn')}
              </span>
              <span className="text-caption opacity-90">
                {t('endsAt', { date: date(auction.endsAt) })}
              </span>
            </span>
          </p>
          {left === null ? null : <ClockValue remaining={left} segmented={tone === 'urgent'} />}
        </div>
        {phase === 'ending' && left !== null && windowMs > 0 ? (
          <div aria-hidden className="h-1 overflow-hidden rounded-full bg-red-200">
            <div
              className="h-full bg-urgent"
              style={{ width: `${String(Math.min(100, Math.max(0, (left / windowMs) * 100)))}%` }}
            />
          </div>
        ) : null}
      </div>
      {phase === 'ending' ? (
        <p className="text-body-sm font-semibold text-foreground-secondary">
          {t('ending', { minutes: Math.max(1, Math.round(auction.extensionWindowSeconds / 60)) })}
        </p>
      ) : null}
    </div>
  );
}

/** Wartość licznika: dni i godziny, gg:mm:ss poniżej doby, kafelki poniżej godziny. */
function ClockValue({
  remaining,
  segmented,
}: {
  readonly remaining: number;
  readonly segmented: boolean;
}) {
  const t = useTranslations('auction.panel');
  const parts = remainingParts(remaining);
  if (parts.kind === 'days') {
    return (
      <span role="timer" className="shrink-0 text-h3 font-extrabold tabular-nums">
        {t('countdownDays', parts)}
      </span>
    );
  }
  const clock = clockParts(remaining);
  const label = t('countdownLabel', {
    hours: clock.hours,
    minutes: clock.minutes,
    seconds: clock.seconds,
  });
  if (!segmented) {
    return (
      <span
        role="timer"
        aria-label={label}
        className="shrink-0 text-h3 font-extrabold tabular-nums"
      >
        {clock.hh}:{clock.mm}:{clock.ss}
      </span>
    );
  }
  const segments = [
    [clock.hh, t('unitHours')],
    [clock.mm, t('unitMinutes')],
    [clock.ss, t('unitSeconds')],
  ] as const;
  return (
    <span role="timer" aria-label={label} className="flex shrink-0 items-center gap-1">
      {segments.map(([value, unit], index) => (
        <span key={unit} className="flex items-center gap-1">
          {index === 0 ? null : (
            <span aria-hidden className="text-h3 font-extrabold">
              :
            </span>
          )}
          <span className="flex min-w-11 flex-col items-center rounded-md bg-card px-1.5 py-1">
            <span className="text-h3 font-extrabold tabular-nums">{value}</span>
            <span aria-hidden className="text-badge">
              {unit}
            </span>
          </span>
        </span>
      ))}
    </span>
  );
}
