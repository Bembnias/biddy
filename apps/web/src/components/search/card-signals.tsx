'use client';

import {
  LIVE_WINDOW_MS,
  type TimerTone,
  isHotAuction,
  isLiveAuction,
  timerTone,
} from '@biddy/shared';
import { Clock, Flame, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LiveBadge } from '@/components/auction/live-badge';
import { useServerNow } from '@/components/auction/use-auction';
import { clockParts, remainingParts } from '@/lib/auction/auction-state';
import { cn } from '@/lib/utils';

// Sygnały na karcie aukcji (F-63): licznik w tonie, LIVE, „Gorąca” i pasek ostatniej godziny.
// Zależą od zegara, więc liczą się w przeglądarce; HTML z cache (ISR) pokazuje datę końca.

interface CardTiming {
  readonly endsAt: string;
  readonly bidCount: number;
}

const signalSource = ({ endsAt, bidCount }: CardTiming) =>
  ({ status: 'ACTIVE', endsAt, bidCount }) as const;

/** Czas do końca jako krótki tekst: „3 dni”, „5 godz. 12 min”, w ostatniej godzinie „04:12”. */
function useTimeLeft(endsAt: string) {
  const t = useTranslations('search.card');
  const now = useServerNow();
  if (now === null) {
    return null;
  }
  const left = Math.max(0, Date.parse(endsAt) - now);
  const parts = remainingParts(left);
  const clock = clockParts(left);
  const text =
    parts.kind === 'days'
      ? t('days', { days: parts.days })
      : parts.kind === 'hours'
        ? t('hours', parts)
        : `${clock.mm}:${clock.ss}`;
  const label = parts.kind === 'minutes' ? t('minutes', parts) : text;
  return { now, left, tone: timerTone(left), text, label };
}

const CHIP =
  'inline-flex h-6.5 items-center gap-1 rounded-full px-2.5 text-caption font-bold whitespace-nowrap tabular-nums shadow-xs [&>svg]:size-3.5 [&>svg]:shrink-0';

const LIGHT_TONES: Record<TimerTone, string> = {
  calm: 'bg-card text-foreground',
  soon: 'bg-violet-50 text-violet-700',
  urgent: 'bg-live text-primary-foreground',
};

/**
 * Licznik na zdjęciu karty: LIVE i czerwony czas w ostatniej godzinie, fioletowy poniżej doby,
 * biały dalej. Przed hydracją (i bez JavaScriptu) data końca z serwera.
 */
export function CardTimeBadge({
  endsAt,
  endsAtLabel,
  liveOnly = false,
}: {
  readonly endsAt: string;
  /** „Koniec: 12 lis, 18:30” do HTML z serwera. */
  readonly endsAtLabel: string;
  /** Ciemna karta: na zdjęciu tylko LIVE, licznik jest pod ceną. */
  readonly liveOnly?: boolean;
}) {
  const t = useTranslations('search.card');
  const time = useTimeLeft(endsAt);
  if (time === null) {
    return liveOnly ? null : (
      <span className={cn(CHIP, LIGHT_TONES.calm)}>
        <Clock aria-hidden />
        {endsAtLabel}
      </span>
    );
  }
  const live = isLiveAuction({ status: 'ACTIVE', endsAt, bidCount: 0 }, time.now);
  if (liveOnly) {
    return live ? <LiveBadge /> : null;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {live ? <LiveBadge /> : null}
      <span data-tone={time.tone} className={cn(CHIP, LIGHT_TONES[time.tone])}>
        {live ? null : <Clock aria-hidden />}
        <span className="sr-only">{t('endsIn')} </span>
        <span aria-hidden>{time.text}</span>
        <span className="sr-only">{time.label}</span>
      </span>
    </span>
  );
}

const DARK_TONES: Record<TimerTone, string> = {
  calm: 'bg-ink-800 text-primary-foreground',
  soon: 'bg-violet-600 text-primary-foreground',
  urgent: 'bg-live text-primary-foreground',
};

/** Licznik pod ceną na ciemnej karcie („Kończą się wkrótce”). */
export function CardTimer({
  endsAt,
  className,
}: {
  readonly endsAt: string;
  readonly className?: string;
}) {
  const t = useTranslations('search.card');
  const time = useTimeLeft(endsAt);
  if (time === null) {
    return null;
  }
  return (
    <span
      data-tone={time.tone}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-timer tabular-nums',
        DARK_TONES[time.tone],
        className,
      )}
    >
      <Timer aria-hidden className="size-4" />
      <span className="sr-only">{t('endsIn')} </span>
      <span aria-hidden>{time.text}</span>
      <span className="sr-only">{time.label}</span>
    </span>
  );
}

const ROW_TONES: Record<TimerTone, string> = {
  calm: 'bg-muted text-ink-700',
  soon: 'bg-violet-50 text-violet-700',
  urgent: 'bg-urgent text-primary-foreground',
};

/**
 * Licznik w wierszu listy (Moje Biddy, F-63): kafelek w tonie czasu do końca. Przed hydracją data
 * końca z serwera.
 */
export function RowTimer({
  endsAt,
  endsAtLabel,
}: {
  readonly endsAt: string;
  /** „Koniec: 12 lis, 18:30” do HTML z serwera. */
  readonly endsAtLabel: string;
}) {
  const t = useTranslations('search.card');
  const time = useTimeLeft(endsAt);
  const tone = time?.tone ?? 'calm';
  return (
    <span
      data-tone={time === null ? undefined : tone}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-caption font-extrabold whitespace-nowrap tabular-nums [&>svg]:size-3.5 [&>svg]:shrink-0',
        ROW_TONES[tone],
      )}
    >
      {tone === 'urgent' ? <Timer aria-hidden /> : <Clock aria-hidden />}
      {time === null ? (
        endsAtLabel
      ) : (
        <>
          <span className="sr-only">{t('endsIn')} </span>
          <span aria-hidden>{time.text}</span>
          <span className="sr-only">{time.label}</span>
        </>
      )}
    </span>
  );
}

/** Pasek pozostałej części ostatniej godziny (ozdoba: czas jest obok w liczniku). */
export function CardHourBar({ endsAt }: { readonly endsAt: string }) {
  const time = useTimeLeft(endsAt);
  if (time === null || time.left >= LIVE_WINDOW_MS) {
    return null;
  }
  return (
    <div aria-hidden className="h-1 overflow-hidden rounded-full bg-ink-800">
      <div
        className="h-full rounded-full bg-live-dot"
        style={{ width: `${String(Math.max(2, (time.left / LIVE_WINDOW_MS) * 100))}%` }}
      />
    </div>
  );
}

/** „Gorąca”: co najmniej 5 ofert i mniej niż doba do końca (`isHotAuction`). */
export function CardHotBadge(timing: CardTiming) {
  const t = useTranslations('search.card');
  const now = useServerNow();
  if (now === null || !isHotAuction(signalSource(timing), now)) {
    return null;
  }
  return (
    <span className={cn(CHIP, 'bg-primary text-primary-foreground')}>
      <Flame aria-hidden className="text-pink-300" />
      {t('hot')}
    </span>
  );
}
