'use client';

// Panel licytacji (F-18, „Puls licytacji” F-63): cena z impulsem, licznik w trzech tonach, stan
// licytującego, formularz z szybkimi kwotami i toasty na żywo (przebicie, przedłużenie, koniec,
// ostatnie minuty). Na telefonie pasek z ceną i licznikiem przyklejony do dołu strony i dolny
// arkusz z formularzem. Wygrana zastępuje panel panelem wygranej (decyzja D2).
import {
  type FeeScheduleDto,
  type MyBiddingDto,
  type PublicAuctionDto,
  type SessionDto,
  buyNow,
  isApiError,
} from '@biddy/api-client';
import { auctionPath, money } from '@biddy/shared';
import {
  CircleCheck,
  CircleX,
  Gavel,
  Info,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { track } from '@/analytics/posthog';
import { TotalPrice } from '@/components/pricing/total-price';
import { useToast } from '@/components/providers/toast-provider';
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
import { IconTile } from '@/components/ui/icon-tile';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { auctionPhase, clockParts, remainingParts, shortMoney } from '@/lib/auction/auction-state';
import { routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

import { BidForm, type BidRequest, type BidResult, type BidderStanding } from './bid-form';
import { BidStateBar } from './bid-state-bar';
import { Countdown } from './countdown';
import { MOBILE_BID_BAR_ID } from './mobile-bid-bar-slot';
import { PriceTicker } from './price-ticker';
import { WatchButton } from './watch-button';
import {
  useAuction,
  useBidder,
  useLiveAuction,
  useRefreshAuction,
  useServerNow,
} from './use-auction';
import { WinPanel } from './win-panel';

/** Toast „kończy się” na tyle przed końcem, raz na aukcję i sesję przeglądarki. */
const ENDING_SOON_MS = 5 * 60_000;

/** Od tej szerokości formularz jest w panelu obok galerii; poniżej w dolnym arkuszu. */
const DESKTOP_QUERY = '(min-width: 1024px)';

type SessionUser = NonNullable<SessionDto['user']>;

const noSubscribe = () => () => undefined;

export function BidPanel({
  initial,
  feeSchedule,
}: {
  readonly initial: PublicAuctionDto;
  readonly feeSchedule?: FeeScheduleDto | undefined;
}) {
  const t = useTranslations('auction.panel');
  const format = useFormatter();
  const show = useToast();
  const auction = useAuction(initial);
  const { user, bidding } = useBidder(auction.publicId);
  const now = useServerNow();
  const phase = auctionPhase(auction, now);
  const [extendedTo, setExtendedTo] = useState<string | null>(null);
  const [panelRequest, setPanelRequest] = useState<BidRequest | null>(null);
  const [sheetRequest, setSheetRequest] = useState<BidRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const barSlot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById(MOBILE_BID_BAR_ID),
    () => null,
  );

  const left = now === null || auction.endsAt === null ? null : Date.parse(auction.endsAt) - now;
  const time = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'short' });

  /** „Zalicytuj ponownie” z toastu: kwota minimalna w polu i fokus; na telefonie w arkuszu. */
  const requestBid = () => {
    track('rebid_opened', { from: 'toast' });
    const request = { key: Date.now() };
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      setPanelRequest(request);
    } else {
      setSheetRequest(request);
      setSheetOpen(true);
    }
  };

  const showOutbid = (minimum: number) => {
    show({
      id: `outbid:${auction.id}`,
      tone: 'urgent',
      icon: TriangleAlert,
      title: t('outbidTitle'),
      description: t('outbidToast', { title: auction.title, minimum: shortMoney(minimum) }),
      action: {
        label: t('rebid'),
        onSelect: requestBid,
      },
      urgent: true,
    });
  };

  const onBidResult = (result: BidResult) => {
    setSheetOpen(false);
    if (result.leading) {
      show({
        id: `bid:${auction.id}`,
        tone: 'success',
        icon: CircleCheck,
        title: t('leadingTitle'),
        description: t('leadingToast', {
          max: shortMoney(result.amount),
          price: shortMoney(result.price),
        }),
      });
    } else {
      showOutbid(result.minimum);
    }
  };

  useLiveAuction(auction, user !== undefined && user !== null, (event) => {
    if (event.kind === 'outbid') {
      showOutbid(event.event.minimumNextBid ?? event.event.currentPrice);
    } else if (event.kind === 'extended') {
      setExtendedTo(event.event.endsAt);
      show({
        id: `extended:${auction.id}`,
        tone: 'brand',
        icon: RefreshCw,
        title: t('extendedTitle'),
        description: t('extendedToast', { time: time(event.event.endsAt) }),
      });
    } else {
      show({ id: `ended:${auction.id}`, tone: 'brand', icon: Gavel, title: t('endedLive') });
    }
  });

  // Ostatnie minuty aukcji, w której użytkownik licytuje albo którą obserwuje.
  const endingSoon =
    phase !== 'closing' &&
    auction.status === 'ACTIVE' &&
    left !== null &&
    left > 0 &&
    left <= ENDING_SOON_MS &&
    (bidding?.hasBid === true || bidding?.watching === true);
  const endingShown = useRef(false);
  useEffect(() => {
    if (!endingSoon || endingShown.current) {
      return;
    }
    endingShown.current = true;
    const key = `biddy:ending-soon:${auction.id}`;
    try {
      if (sessionStorage.getItem(key) !== null) {
        return;
      }
      sessionStorage.setItem(key, '1');
    } catch {
      // Bez pamięci sesji (tryb prywatny): toast najwyżej raz na wejście na stronę.
    }
    show({
      id: `ending:${auction.id}`,
      tone: 'warning',
      icon: Timer,
      title: t('endingSoonTitle'),
      description: t('endingSoonText', { title: auction.title }),
    });
  }, [endingSoon, auction.id, auction.title, show, t]);

  if (bidding?.outcome === 'WON') {
    return <WinPanel auction={auction} bidding={bidding} />;
  }

  const ended = phase === 'sold' || phase === 'unsold' || phase === 'cancelled';
  const standing = standingOf(auction, bidding);
  const canBid =
    !ended &&
    phase !== 'closing' &&
    phase !== 'scheduled' &&
    user !== undefined &&
    user !== null &&
    bidding?.isSeller !== true &&
    user.id !== auction.seller.id &&
    user.termsAccepted &&
    user.phoneVerified;
  const priceLabel = ended
    ? t('finalPrice')
    : auction.currentPrice === null
      ? t('startPrice')
      : t('currentPrice');
  const price = auction.currentPrice ?? auction.startPrice;
  const timeLeft = left === null ? null : countdownText(left, t);

  return (
    <>
      <section
        id="bid-panel"
        aria-labelledby="bid-panel-title"
        className={cn(
          'scroll-mt-24 space-y-5 rounded-2xl border bg-card p-5 shadow-md sm:p-6',
          standing === 'outbid' ? 'border-red-300' : 'border-border',
        )}
      >
        <h2 id="bid-panel-title" className="sr-only">
          {t('title')}
        </h2>
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-overline text-muted-foreground uppercase">{priceLabel}</p>
              <div className="mt-1">
                <PriceTicker amount={price} currency={auction.currency} />
              </div>
            </div>
            <div className="mt-5 flex shrink-0 flex-col items-end gap-1">
              {auction.bidCount === 0 ? (
                <span className="text-label text-foreground-secondary">
                  {t('bids', { count: 0 })}
                </span>
              ) : (
                <a
                  href="#bid-history-title"
                  className="rounded-xs text-label font-extrabold text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
                >
                  {t('bids', { count: auction.bidCount })}
                </a>
              )}
            </div>
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

        <Countdown auction={auction} phase={phase} now={now} />

        {extendedTo === null || ended ? null : (
          <p className="flex animate-enter items-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-body-sm font-bold text-accent-foreground">
            <RefreshCw aria-hidden className="size-4 shrink-0" />
            {t('extendedLive', { time: time(extendedTo) })}
          </p>
        )}

        <BidderStatus auction={auction} bidding={bidding} />

        {ended || phase === 'closing' || phase === 'scheduled' ? null : (
          <Actions
            auction={auction}
            user={user}
            bidding={bidding}
            standing={standing}
            feeSchedule={feeSchedule}
            timeLeft={timeLeft}
            request={panelRequest}
            onResult={onBidResult}
            onBought={() => {
              show({
                id: `bid:${auction.id}`,
                tone: 'success',
                icon: CircleCheck,
                title: t('bought'),
              });
            }}
          />
        )}

        <WatchButton auction={auction} user={user} bidding={bidding} />

        {ended ? null : (
          <p className="flex items-start gap-2.5 text-body-sm text-foreground-secondary">
            <ShieldCheck aria-hidden className="mt-0.5 size-4.5 shrink-0 text-success" />
            <span>
              <span className="font-bold text-foreground">{t('protectionTitle')}</span>{' '}
              {t('protectionText')}
            </span>
          </p>
        )}
      </section>

      {barSlot === null || ended || phase === 'closing' ? null : (
        <MobileBidBarPortal slot={barSlot}>
          <div className="flex items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-price-lg tabular-nums">{shortMoney(price)}</span>
              {timeLeft === null ? null : (
                <span
                  className={cn(
                    'text-caption font-extrabold tabular-nums',
                    left !== null && left < 3_600_000 ? 'text-urgent' : 'text-foreground-secondary',
                  )}
                >
                  {timeLeft}
                </span>
              )}
            </div>
            {canBid ? (
              <Button
                type="button"
                variant="cta"
                size="lg"
                onClick={() => {
                  setSheetRequest(null);
                  setSheetOpen(true);
                }}
              >
                {ctaLabel(standing, t)}
              </Button>
            ) : (
              <Button asChild variant="cta" size="lg">
                <a href="#bid-panel">{t('bid')}</a>
              </Button>
            )}
          </div>
        </MobileBidBarPortal>
      )}

      {canBid ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent aria-describedby={undefined}>
            {standing === 'outbid' ? (
              <div className="flex items-center gap-3 rounded-xl bg-urgent p-3.5 text-primary-foreground">
                <TriangleAlert aria-hidden className="size-6.5 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <SheetTitle className="text-h3">{t('outbidTitle')}</SheetTitle>
                  <span className="text-body-sm">
                    {t('outbidSheet', { max: shortMoney(bidding?.maxAmount ?? 0) })}
                  </span>
                </div>
                {timeLeft === null ? null : (
                  <span className="rounded-md bg-card px-2 py-1 text-label font-extrabold text-urgent tabular-nums">
                    {timeLeft}
                  </span>
                )}
              </div>
            ) : (
              <SheetTitle className="text-h3">{t('sheetTitle')}</SheetTitle>
            )}
            <div className="flex items-center gap-3">
              {auction.photos[0] === undefined ? null : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={auction.photos[0].urls.thumb}
                  alt=""
                  className="size-12 shrink-0 rounded-lg bg-muted object-cover"
                />
              )}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-label">{auction.title}</span>
                <span className="text-body-sm text-foreground-secondary">
                  {t('sheetPrice', { price: shortMoney(price), count: auction.bidCount })}
                </span>
              </div>
            </div>
            <BidForm
              auction={auction}
              standing={standing}
              feeSchedule={feeSchedule}
              timeLeft={timeLeft}
              request={sheetRequest}
              onResult={onBidResult}
            />
            <SheetClose asChild>
              <Button type="button" variant="ghost" className="w-full">
                {t('notNow')}
              </Button>
            </SheetClose>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

/** Pasek licytacji w miejscu z page.tsx (koniec strony), żeby przyklejał się do dołu ekranu. */
function MobileBidBarPortal({
  slot,
  children,
}: {
  readonly slot: HTMLElement;
  readonly children: ReactNode;
}) {
  return createPortal(children, slot);
}

function standingOf(auction: PublicAuctionDto, bidding: MyBiddingDto | undefined): BidderStanding {
  if (auction.status !== 'ACTIVE' || bidding === undefined || !bidding.hasBid) {
    return 'first';
  }
  return bidding.leading ? 'leading' : 'outbid';
}

function ctaLabel(
  standing: BidderStanding,
  t: ReturnType<typeof useTranslations<'auction.panel'>>,
): string {
  switch (standing) {
    case 'outbid':
      return t('outbidCta');
    case 'leading':
      return t('raise');
    case 'first':
      return t('bid');
  }
}

/** Czas do końca jednym tekstem: „2 dni 4 godz.” albo „00:12:31”. */
function countdownText(
  remaining: number,
  t: ReturnType<typeof useTranslations<'auction.panel'>>,
): string {
  const parts = remainingParts(remaining);
  if (parts.kind === 'days') {
    return t('countdownDays', parts);
  }
  const clock = clockParts(remaining);
  return `${clock.hh}:${clock.mm}:${clock.ss}`;
}

/** Stan zalogowanego użytkownika: prowadzi, przebity, przegrał, cena minimalna. */
function BidderStatus({
  auction,
  bidding,
}: {
  readonly auction: PublicAuctionDto;
  readonly bidding: MyBiddingDto | undefined;
}) {
  const t = useTranslations('auction.panel');
  if (bidding === undefined) {
    return null;
  }
  switch (bidding.outcome) {
    case 'LOST':
      return (
        <BidStateBar
          tone="neutral"
          icon={CircleX}
          title={t('lost')}
          description={
            <Link
              href={routes.search}
              className="font-bold text-link underline-offset-3 hover:text-link-hover hover:underline"
            >
              {t('lostLink')}
            </Link>
          }
        />
      );
    case 'RESERVE_NOT_MET':
      return <BidStateBar tone="neutral" icon={Info} title={t('reserveNotMet')} />;
    case 'WON':
    case 'NONE':
      break;
  }
  if (auction.status !== 'ACTIVE' || !bidding.hasBid || bidding.maxAmount === null) {
    return null;
  }
  const max = shortMoney(bidding.maxAmount);
  return bidding.leading ? (
    <BidStateBar
      tone="success"
      icon={CircleCheck}
      title={t('leadingTitle')}
      description={t('leadingText', { max })}
    />
  ) : (
    <BidStateBar
      tone="urgent"
      icon={TriangleAlert}
      title={t('outbidTitle')}
      description={t('outbidText', {
        max,
        minimum: shortMoney(auction.minimumNextBid ?? auction.startPrice),
      })}
    />
  );
}

/** Formularz oferty i Kup teraz albo to, co trzeba zrobić, żeby licytować. */
function Actions({
  auction,
  user,
  bidding,
  standing,
  feeSchedule,
  timeLeft,
  request,
  onResult,
  onBought,
}: {
  readonly auction: PublicAuctionDto;
  readonly user: SessionUser | null | undefined;
  readonly bidding: MyBiddingDto | undefined;
  readonly standing: BidderStanding;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly timeLeft: string | null;
  readonly request: BidRequest | null;
  readonly onResult: (result: BidResult) => void;
  readonly onBought: () => void;
}) {
  const t = useTranslations('auction.panel');
  const path = auctionPath(auction.slug, auction.publicId);

  if (user === undefined) {
    // Sesja jeszcze się wczytuje: bez migania przyciskiem logowania.
    return null;
  }
  if (user === null) {
    return (
      <Gate
        title={t('guest')}
        text={t('guestText')}
        action={t('guestLogin')}
        href={withNext(routes.signIn, path)}
        secondary={{ label: t('guestSignUp'), href: withNext(routes.signUp, path) }}
      />
    );
  }
  if (bidding?.isSeller === true || user.id === auction.seller.id) {
    return (
      <p className="rounded-lg bg-muted px-4 py-3 text-body-sm text-foreground-secondary">
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
    return (
      <Gate
        title={t('terms')}
        action={t('termsAction')}
        href={withNext(routes.acceptTerms, path)}
      />
    );
  }
  if (!user.phoneVerified) {
    return (
      <Gate
        title={t('phone')}
        text={t('phoneText')}
        action={t('phoneAction')}
        href={withNext(routes.verifyPhone, path)}
      />
    );
  }
  return (
    <div className="space-y-4">
      <BidForm
        auction={auction}
        standing={standing}
        feeSchedule={feeSchedule}
        timeLeft={timeLeft}
        request={request}
        onResult={onResult}
      />
      {auction.buyNowAvailable && auction.buyNowPrice !== null ? (
        <BuyNow
          auction={auction}
          price={auction.buyNowPrice}
          feeSchedule={feeSchedule}
          onBought={onBought}
        />
      ) : null}
    </div>
  );
}

/** Zamiast formularza: co zrobić, żeby licytować (logowanie, regulamin, telefon). */
function Gate({
  title,
  text,
  action,
  href,
  secondary,
}: {
  readonly title: string;
  readonly text?: string;
  readonly action: string;
  readonly href: string;
  readonly secondary?: { readonly label: string; readonly href: string };
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-canvas px-4 py-5 text-center">
        <IconTile tone="brand">
          <LockKeyhole />
        </IconTile>
        <p className="text-title font-extrabold">{title}</p>
        {text === undefined ? null : (
          <p className="text-body-sm text-foreground-secondary">{text}</p>
        )}
      </div>
      <Button asChild variant="cta" size="lg" className="w-full">
        <Link href={href}>{action}</Link>
      </Button>
      {secondary === undefined ? null : (
        <Button asChild variant="ghost" className="w-full text-link hover:text-link-hover">
          <Link href={secondary.href}>{secondary.label}</Link>
        </Button>
      )}
    </div>
  );
}

function BuyNow({
  auction,
  price,
  feeSchedule,
  onBought,
}: {
  readonly auction: PublicAuctionDto;
  readonly price: number;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly onBought: () => void;
}) {
  const t = useTranslations('auction.panel');
  const refresh = useRefreshAuction(auction);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const key = useRef<string | null>(null);
  const shippingFrom = auction.shippingFrom === null ? null : money(auction.shippingFrom);

  const confirm = async () => {
    key.current ??= crypto.randomUUID();
    setSending(true);
    try {
      await buyNow(auction.id, { headers: { 'Idempotency-Key': key.current } });
      key.current = null;
      track('buy_now_completed');
      onBought();
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
        <Zap aria-hidden />
        {t('buyNow', { price: shortMoney(price) })}
      </Button>
      <TotalPrice
        amount={money(price)}
        kind="buyNow"
        initialFeeSchedule={feeSchedule}
        shippingFrom={shippingFrom}
        withDetails={false}
      />
      <p className="text-caption text-muted-foreground">{t('buyNowNote')}</p>
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
              {t('buyNowText', { price: shortMoney(price) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <TotalPrice
            amount={money(price)}
            kind="buyNow"
            initialFeeSchedule={feeSchedule}
            shippingFrom={shippingFrom}
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
