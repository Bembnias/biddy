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
import { Button } from '@/components/ui/button';
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

import {
  useAuction,
  useBidder,
  useLiveAuction,
  useRefreshAuction,
  useServerNow,
} from './use-auction';

/** Kody błędów, po których stan aukcji na stronie jest nieaktualny. */
const STALE_STATE_CODES = new Set(['BID_TOO_LOW', 'AUCTION_ENDED', 'BUY_NOW_UNAVAILABLE']);

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
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h2 id="bid-panel-title" className="sr-only">
        {t('title')}
      </h2>
      <div>
        <p className="text-sm text-muted-foreground">{priceLabel}</p>
        <p className="text-3xl font-bold tabular-nums" data-testid="auction-price">
          {short(auction.currentPrice ?? auction.startPrice)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('bids', { count: auction.bidCount })}
          {auction.leader === null ? null : (
            <> · {t('leader', { name: auction.leader.publicName })}</>
          )}
        </p>
        {auction.reserveStatus === 'NONE' ? null : (
          <p
            className={cn(
              'mt-1 text-sm',
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

      <p role="status" aria-live="polite" className="text-sm font-medium empty:hidden">
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

  switch (phase) {
    case 'sold':
      return (
        <p className="font-semibold">
          {t('sold', { price: short(auction.currentPrice ?? auction.startPrice) })}
        </p>
      );
    case 'unsold':
      return <p className="font-semibold">{t('unsold')}</p>;
    case 'cancelled':
      return <p className="font-semibold">{t('cancelled')}</p>;
    case 'closing':
      return <p className="font-semibold">{t('closing')}</p>;
    case 'scheduled':
      return auction.startsAt === null ? null : (
        <p>{t('scheduled', { date: date(auction.startsAt) })}</p>
      );
    case 'active':
    case 'ending':
      break;
  }
  if (auction.endsAt === null) {
    return null;
  }
  const remaining = now === null ? null : remainingParts(Date.parse(auction.endsAt) - now);
  return (
    <div className={cn('space-y-1', phase === 'ending' && 'rounded-md bg-highlight/20 p-3')}>
      {remaining === null ? null : (
        <p>
          <span className="text-sm text-muted-foreground">{t('remaining')}: </span>
          <span
            role="timer"
            className={cn(
              'text-xl font-semibold tabular-nums',
              phase === 'ending' && 'text-destructive',
            )}
          >
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
      <p className="text-sm text-muted-foreground">{t('endsAt', { date: date(auction.endsAt) })}</p>
      {phase === 'ending' ? (
        <p className="text-sm font-medium">
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
        <div className="rounded-md bg-success/10 p-3" data-testid="bidder-status">
          <p className="font-semibold">{t('won')}</p>
          {bidding.order === null ? null : (
            <p className="mt-1 text-sm">
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
        <p className="text-sm" data-testid="bidder-status">
          {t('lost')}
        </p>
      );
    case 'RESERVE_NOT_MET':
      return (
        <p className="text-sm" data-testid="bidder-status">
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
    <p className="rounded-md bg-success/10 p-3 text-sm font-medium" data-testid="bidder-status">
      {t('leading', { max: short(bidding.maxAmount) })}
    </p>
  ) : (
    <p className="rounded-md bg-highlight/20 p-3 text-sm font-medium" data-testid="bidder-status">
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
      <p className="text-sm">
        {t('own')}{' '}
        <Link
          href={routes.myAuctions}
          className="text-primary underline underline-offset-4 hover:no-underline"
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
      <Button asChild className="h-10 w-full">
        <Link href={href}>{action}</Link>
      </Button>
      {text === undefined ? null : <p className="text-sm text-muted-foreground">{text}</p>}
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
    <form noValidate onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={inputId}>{t('maxLabel')}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder={short(minimum)}
            aria-describedby={error === undefined ? hintId : `${errorId} ${hintId}`}
            aria-invalid={error === undefined ? undefined : true}
            className="h-10"
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
          />
          <Button type="submit" className="h-10 shrink-0" disabled={sending}>
            {sending ? t('bidding') : t('bid')}
          </Button>
        </div>
        {error === undefined ? null : (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p id={hintId} className="text-sm text-muted-foreground">
          {t('maxHint', { minimum: short(minimum) })}
        </p>
      </div>
      <TotalPrice amount={money(preview)} kind="maxBid" initialFeeSchedule={feeSchedule} />

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
            withDetails={false}
          />
          <p className="text-sm text-muted-foreground">{t('confirmShipping')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
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
        className="h-10 w-full"
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
        withDetails={false}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
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
            withDetails={false}
          />
          <p className="text-sm text-muted-foreground">{t('confirmShipping')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
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
