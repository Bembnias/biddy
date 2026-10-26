'use client';

// Panel licytacji (F-18): cena, licznik z zegara serwera, stan użytkownika i formularz oferty
// z ceną łączną (F-13) i potwierdzeniem. Oferty i Kup teraz z Idempotency-Key: ponowienie tej
// samej próby (np. po zerwaniu sieci) nie złoży drugiej oferty (F-15).
import {
  type FeeScheduleDto,
  type MyBiddingDto,
  type PublicAuctionDto,
  type SessionDto,
  buyNow,
  isApiError,
  placeBid,
} from '@biddy/api-client';
import { auctionPath, formatMoney, money } from '@biddy/shared';
import { CircleCheck, Clock, Gavel, Timer, TriangleAlert, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useId, useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { TotalPrice } from '@/components/pricing/total-price';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type AuctionPhase,
  auctionPhase,
  parseBidAmount,
  remainingParts,
} from '@/lib/auction/auction-state';
import { routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { WatchButton } from './watch-button';
import {
  useAuction,
  useBidder,
  useLiveAuction,
  useRefreshAuction,
  useServerNow,
} from './use-auction';

/** Licznik zmienia ton poniżej doby (fiolet) i godziny (czerwień), jak w design systemie (F-62). */
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Kody błędów, po których stan aukcji na stronie jest nieaktualny. */
const STALE_STATE_CODES = new Set(['BID_TOO_LOW', 'AUCTION_ENDED', 'BUY_NOW_UNAVAILABLE']);

/** Najtańsza dostawa z cennika Biddy („+ dostawa od”, F-24); null bez opcji dostawy. */
const shippingFromOf = (auction: PublicAuctionDto) =>
  auction.shippingFrom === null ? null : money(auction.shippingFrom);

const short = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

type SessionUser = NonNullable<SessionDto['user']>;

export function BidPanel({
  initial,
  feeSchedule,
}: {
  readonly initial: PublicAuctionDto;
  readonly feeSchedule?: FeeScheduleDto | undefined;
}) {
  const t = useTranslations('auction.panel');
  const format = useFormatter();
  const auction = useAuction(initial);
  const { user, bidding } = useBidder(auction.publicId);
  const now = useServerNow();
  const phase = auctionPhase(auction, now);
  const [notice, setNotice] = useState<string>();

  useLiveAuction(auction, user !== undefined && user !== null, (event) => {
    if (event.kind === 'outbid') {
      setNotice(
        t('outbidLive', {
          minimum: short(event.event.minimumNextBid ?? event.event.currentPrice),
        }),
      );
    } else if (event.kind === 'extended') {
      setNotice(
        t('extendedLive', {
          date: format.dateTime(new Date(event.event.endsAt), {
            dateStyle: 'medium',
            timeStyle: 'medium',
          }),
        }),
      );
    } else {
      setNotice(t('endedLive'));
    }
  });

  const ended = phase === 'sold' || phase === 'unsold' || phase === 'cancelled';
  const priceLabel = ended
    ? t('finalPrice')
    : auction.currentPrice === null
      ? t('startPrice')
      : t('currentPrice');

  return (
    <section
      aria-labelledby="bid-panel-title"
      className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-md sm:p-6"
    >
      <h2 id="bid-panel-title" className="sr-only">
        {t('title')}
      </h2>
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-overline text-muted-foreground uppercase">{priceLabel}</p>
            <p className="mt-1 text-price-xl tabular-nums" data-testid="auction-price">
              {short(auction.currentPrice ?? auction.startPrice)}
            </p>
          </div>
          <a
            href="#bid-history-title"
            className="mt-5 shrink-0 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
          >
            {t('bids', { count: auction.bidCount })}
          </a>
        </div>
        {auction.leader === null ? null : (
          <p className="text-body-sm text-muted-foreground">
            {t('leader', { name: auction.leader.publicName })}
          </p>
        )}
        {auction.reserveStatus === 'NONE' ? null : (
          <p
            className={cn(
              'text-body-sm',
              auction.reserveStatus === 'MET' ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {t('reserve', { status: auction.reserveStatus })}
          </p>
        )}
      </div>

      <Timing auction={auction} phase={phase} now={now} />

      <BidderStatus auction={auction} bidding={bidding} />

      {ended || phase === 'closing' || phase === 'scheduled' ? null : (
        <Actions
          auction={auction}
          user={user}
          bidding={bidding}
          feeSchedule={feeSchedule}
          onNotice={setNotice}
        />
      )}

      <WatchButton auction={auction} user={user} bidding={bidding} />

      <p role="status" aria-live="polite" className="text-body-sm font-semibold empty:hidden">
        {notice}
      </p>
    </section>
  );
}

/** Licznik do końca (w przeglądarce) albo wynik aukcji. */
function Timing({
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
    <p className="flex items-center gap-2 rounded-md bg-muted px-4 py-3 text-label text-foreground-secondary">
      <Clock aria-hidden className="size-4.5 shrink-0" />
      <span>{text}</span>
    </p>
  );
  switch (phase) {
    case 'sold':
      return banner(t('sold', { price: short(auction.currentPrice ?? auction.startPrice) }));
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
  const remaining = left === null ? null : remainingParts(left);
  const tone =
    phase === 'ending' || (left !== null && left < HOUR_MS)
      ? 'urgent'
      : left !== null && left < DAY_MS
        ? 'soon'
        : 'calm';
  const Icon = tone === 'urgent' ? Timer : Clock;
  return (
    <div
      data-tone={tone}
      className={cn(
        'space-y-1 rounded-md px-4 py-3',
        tone === 'urgent' && 'bg-urgent-soft text-urgent',
        tone === 'soon' && 'bg-accent text-accent-foreground',
        tone === 'calm' && 'bg-muted text-foreground-secondary',
      )}
    >
      {remaining === null ? null : (
        <p className="flex flex-wrap items-center gap-x-2 text-label">
          <Icon aria-hidden className="size-4.5 shrink-0" />
          <span>{t('remaining')}:</span>
          <span role="timer" className="text-timer tabular-nums">
            {t('countdown', {
              ...remaining,
              ...(remaining.kind === 'minutes'
                ? {
                    minutes: String(remaining.minutes).padStart(2, '0'),
                    seconds: String(remaining.seconds).padStart(2, '0'),
                  }
                : {}),
            })}
          </span>
        </p>
      )}
      <p className="text-body-sm">{t('endsAt', { date: date(auction.endsAt) })}</p>
      {phase === 'ending' ? (
        <p className="text-body-sm font-semibold">
          {t('ending', { minutes: Math.max(1, Math.round(auction.extensionWindowSeconds / 60)) })}
        </p>
      ) : null}
    </div>
  );
}

/** Stan zalogowanego użytkownika: prowadzi, wygrał, przegrał. */
function BidderStatus({
  auction,
  bidding,
}: {
  readonly auction: PublicAuctionDto;
  readonly bidding: MyBiddingDto | undefined;
}) {
  const t = useTranslations('auction.panel');
  const format = useFormatter();
  if (bidding === undefined) {
    return null;
  }
  switch (bidding.outcome) {
    case 'WON':
      return (
        <div className="rounded-md bg-accent px-4 py-3" data-testid="bidder-status">
          <p className="flex items-center gap-2 text-label text-accent-foreground">
            <Trophy aria-hidden className="size-4.5 shrink-0" />
            {t('won')}
          </p>
          {bidding.order === null ? null : (
            <p className="mt-1 text-body-sm text-foreground">
              {t('wonOrder', {
                number: bidding.order.publicId,
                total: formatMoney(money(bidding.order.total)),
                date: format.dateTime(new Date(bidding.order.paymentDueAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })}
            </p>
          )}
        </div>
      );
    case 'LOST':
      return (
        <p
          className="rounded-md bg-muted px-4 py-3 text-body-sm text-foreground-secondary"
          data-testid="bidder-status"
        >
          {t('lost')}
        </p>
      );
    case 'RESERVE_NOT_MET':
      return (
        <p
          className="rounded-md bg-muted px-4 py-3 text-body-sm text-foreground-secondary"
          data-testid="bidder-status"
        >
          {t('reserveNotMet')}
        </p>
      );
    case 'NONE':
      break;
  }
  if (auction.status !== 'ACTIVE' || !bidding.hasBid || bidding.maxAmount === null) {
    return null;
  }
  return bidding.leading ? (
    <p
      className="flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-label text-success"
      data-testid="bidder-status"
    >
      <CircleCheck aria-hidden className="size-4.5 shrink-0" />
      {t('leading', { max: short(bidding.maxAmount) })}
    </p>
  ) : (
    <p
      className="flex items-center gap-2 rounded-md bg-urgent-soft px-4 py-3 text-label text-urgent"
      data-testid="bidder-status"
    >
      <TriangleAlert aria-hidden className="size-4.5 shrink-0" />
      {t('outbid', { minimum: short(auction.minimumNextBid ?? auction.startPrice) })}
    </p>
  );
}

/** Formularz oferty i Kup teraz albo to, co trzeba zrobić, żeby licytować. */
function Actions({
  auction,
  user,
  bidding,
  feeSchedule,
  onNotice,
}: {
  readonly auction: PublicAuctionDto;
  readonly user: SessionUser | null | undefined;
  readonly bidding: MyBiddingDto | undefined;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly onNotice: (notice: string) => void;
}) {
  const t = useTranslations('auction.panel');
  const path = auctionPath(auction.slug, auction.publicId);

  if (user === undefined) {
    // Sesja jeszcze się wczytuje: bez migania przyciskiem logowania.
    return null;
  }
  if (user === null) {
    return <Gate action={t('guest')} text={t('guestText')} href={withNext(routes.signIn, path)} />;
  }
  if (bidding?.isSeller === true || user.id === auction.seller.id) {
    return (
      <p className="rounded-md bg-muted px-4 py-3 text-body-sm text-foreground-secondary">
        {t('own')}{' '}
        <Link
          href={routes.myAuctions}
          className="font-semibold text-link underline underline-offset-3 hover:text-link-hover"
        >
          {t('ownLink')}
        </Link>
      </p>
    );
  }
  if (!user.termsAccepted) {
    return <Gate action={t('terms')} href={withNext(routes.acceptTerms, path)} />;
  }
  if (!user.phoneVerified) {
    return (
      <Gate action={t('phone')} text={t('phoneText')} href={withNext(routes.verifyPhone, path)} />
    );
  }
  return (
    <div className="space-y-4">
      <BidForm
        auction={auction}
        firstBid={!(bidding?.hasBid ?? false)}
        feeSchedule={feeSchedule}
        onNotice={onNotice}
      />
      {auction.buyNowAvailable && auction.buyNowPrice !== null ? (
        <BuyNow
          auction={auction}
          price={auction.buyNowPrice}
          feeSchedule={feeSchedule}
          onNotice={onNotice}
        />
      ) : null}
    </div>
  );
}

function Gate({
  action,
  text,
  href,
}: {
  readonly action: string;
  readonly text?: string;
  readonly href: string;
}) {
  return (
    <div className="space-y-2">
      <Button asChild variant="cta" size="lg" className="w-full">
        <Link href={href}>{action}</Link>
      </Button>
      {text === undefined ? null : <p className="text-body-sm text-muted-foreground">{text}</p>}
    </div>
  );
}

/** Próba oferty: ten sam klucz przy ponowieniu tej samej kwoty po błędzie sieci. */
interface Attempt {
  readonly amount: number;
  readonly key: string;
}

function BidForm({
  auction,
  firstBid,
  feeSchedule,
  onNotice,
}: {
  readonly auction: PublicAuctionDto;
  readonly firstBid: boolean;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly onNotice: (notice: string) => void;
}) {
  const t = useTranslations('auction.panel');
  const refresh = useRefreshAuction(auction);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const attempt = useRef<Attempt | null>(null);

  const minimum = auction.minimumNextBid ?? auction.startPrice;
  const parsed = parseBidAmount(text);
  const preview = typeof parsed === 'number' && parsed >= minimum ? parsed : minimum;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed === 'empty') {
      setError(t('amountRequired'));
      return;
    }
    if (parsed === 'invalid') {
      setError(t('amountInvalid'));
      return;
    }
    if (parsed < minimum) {
      setError(t('amountTooLow', { minimum: short(minimum) }));
      return;
    }
    setError(undefined);
    if (attempt.current?.amount !== parsed) {
      attempt.current = { amount: parsed, key: crypto.randomUUID() };
    }
    setConfirming(parsed);
  };

  const confirm = async (amount: number) => {
    const current = attempt.current ?? { amount, key: crypto.randomUUID() };
    setSending(true);
    try {
      const result = await placeBid(
        auction.id,
        { maxAmount: amount },
        { headers: { 'Idempotency-Key': current.key } },
      );
      attempt.current = null;
      setText('');
      track('bid_placed', { leading: result.leading, firstBid });
      onNotice(
        result.leading
          ? t('leading', { max: short(amount) })
          : t('outbid', {
              minimum: short(result.auction.minimumNextBid ?? auction.startPrice),
            }),
      );
      await refresh();
    } catch (failure) {
      const definitive = isApiError(failure) && failure.status >= 400 && failure.status < 500;
      if (definitive) {
        attempt.current = null;
        setError(failure.problem?.detail ?? t('error'));
        track('bid_failed', { code: failure.code ?? `HTTP_${String(failure.status)}` });
        if (failure.code !== undefined && STALE_STATE_CODES.has(failure.code)) {
          await refresh();
        }
      } else {
        // Sieć albo błąd serwera: ponowienie użyje tego samego klucza (bez drugiej oferty).
        setError(t('error'));
        track('bid_failed', { code: 'NETWORK' });
      }
    } finally {
      setSending(false);
      setConfirming(null);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={inputId}>{t('maxLabel')}</Label>
        <Input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder={short(minimum)}
          aria-describedby={error === undefined ? hintId : `${errorId} ${hintId}`}
          aria-invalid={error === undefined ? undefined : true}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
        />
        {error === undefined ? null : (
          <p id={errorId} className="text-body-sm text-destructive">
            {error}
          </p>
        )}
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {t('maxHint', { minimum: short(minimum) })}
        </p>
      </div>
      <TotalPrice
        amount={money(preview)}
        kind="maxBid"
        initialFeeSchedule={feeSchedule}
        shippingFrom={shippingFromOf(auction)}
      />
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={sending}>
        <Gavel aria-hidden />
        {sending ? t('bidding') : t('bid')}
      </Button>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !sending) {
            setConfirming(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmText', { amount: short(confirming ?? preview) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <TotalPrice
            amount={money(confirming ?? preview)}
            kind="maxBid"
            initialFeeSchedule={feeSchedule}
            shippingFrom={shippingFromOf(auction)}
            withDetails={false}
          />
          <p className="text-body-sm text-muted-foreground">{t('confirmShipping')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'cta' })}
              disabled={sending}
              onClick={(event) => {
                // Okno zamykamy po odpowiedzi API, nie od razu.
                event.preventDefault();
                if (confirming !== null) {
                  void confirm(confirming);
                }
              }}
            >
              {sending ? t('bidding') : t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function BuyNow({
  auction,
  price,
  feeSchedule,
  onNotice,
}: {
  readonly auction: PublicAuctionDto;
  readonly price: number;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly onNotice: (notice: string) => void;
}) {
  const t = useTranslations('auction.panel');
  const refresh = useRefreshAuction(auction);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const key = useRef<string | null>(null);

  const confirm = async () => {
    key.current ??= crypto.randomUUID();
    setSending(true);
    try {
      await buyNow(auction.id, { headers: { 'Idempotency-Key': key.current } });
      key.current = null;
      track('buy_now_completed');
      onNotice(t('bought'));
      setOpen(false);
      await refresh();
    } catch (failure) {
      if (isApiError(failure) && failure.status >= 400 && failure.status < 500) {
        key.current = null;
        setError(failure.problem?.detail ?? t('buyNowError'));
        setOpen(false);
        await refresh();
      } else {
        setError(t('buyNowError'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        {t('buyNow', { price: short(price) })}
      </Button>
      <TotalPrice
        amount={money(price)}
        kind="buyNow"
        initialFeeSchedule={feeSchedule}
        shippingFrom={shippingFromOf(auction)}
        withDetails={false}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!sending) {
            setOpen(next);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('buyNowTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('buyNowText', { price: short(price) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <TotalPrice
            amount={money(price)}
            kind="buyNow"
            initialFeeSchedule={feeSchedule}
            shippingFrom={shippingFromOf(auction)}
            withDetails={false}
          />
          <p className="text-body-sm text-muted-foreground">{t('confirmShipping')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'cta' })}
              disabled={sending}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {sending ? t('bidding') : t('buyNowConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
