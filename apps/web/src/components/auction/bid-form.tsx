'use client';

// Formularz oferty (F-18, „Puls licytacji” F-63): maksimum z szybkimi kwotami, cena łączna
// (F-13) i potwierdzenie. Oferty z Idempotency-Key: ponowienie tej samej próby (np. po zerwaniu
// sieci) nie złoży drugiej oferty (F-15).
import {
  type FeeScheduleDto,
  type PublicAuctionDto,
  isApiError,
  placeBid,
} from '@biddy/api-client';
import { money, quickBidAmounts } from '@biddy/shared';
import { Gavel, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

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
import { parseBidAmount, shortMoney } from '@/lib/auction/auction-state';
import { cn } from '@/lib/utils';

import { QuickBidAmounts } from './quick-bid-amounts';
import { useRefreshAuction } from './use-auction';

/** Kwota w polu oferty bez waluty, np. „325” albo „20,50”. */
const inputText = (amount: number) => shortMoney(amount).replace(/\s*zł$/u, '');

/** Kody błędów, po których stan aukcji na stronie jest nieaktualny. */
const STALE_STATE_CODES = new Set(['BID_TOO_LOW', 'AUCTION_ENDED', 'BUY_NOW_UNAVAILABLE']);

/** Stan licytującego, od którego zależą etykiety pola i przycisku. */
export type BidderStanding = 'first' | 'leading' | 'outbid';

/** Wynik oferty dla panelu (toast). */
export interface BidResult {
  readonly leading: boolean;
  readonly amount: number;
  readonly price: number;
  readonly minimum: number;
}

/** Skąd przyszła oferta (analityka F-63). */
export type BidSource = 'manual' | 'quick' | 'rebid';

/**
 * Prośba o ofertę z zewnątrz („Zalicytuj ponownie” w toaście): minimalna oferta w polu i fokus.
 * Kwotę bierze formularz w chwili prośby, więc jest aktualna, nawet gdy toast jest starszy.
 */
export interface BidRequest {
  readonly key: number;
}

/** Próba oferty: ten sam klucz przy ponowieniu tej samej kwoty po błędzie sieci. */
interface Attempt {
  readonly amount: number;
  readonly key: string;
}

export function BidForm({
  auction,
  standing,
  feeSchedule,
  timeLeft,
  request,
  onResult,
}: {
  readonly auction: PublicAuctionDto;
  readonly standing: BidderStanding;
  readonly feeSchedule: FeeScheduleDto | undefined;
  /** Czas do końca do pokazania w potwierdzeniu, np. „00:12:31”. */
  readonly timeLeft: string | null;
  readonly request?: BidRequest | null | undefined;
  readonly onResult: (result: BidResult) => void;
}) {
  const t = useTranslations('auction.panel');
  const refresh = useRefreshAuction(auction);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [source, setSource] = useState<BidSource>('manual');
  // `retry`: kwota do ponowienia po błędzie sieci (ten sam Idempotency-Key).
  const [error, setError] = useState<{ readonly text: string; readonly retry?: number }>();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const minimum = auction.minimumNextBid ?? auction.startPrice;

  // Prośba z zewnątrz: kwota w polu i fokus (wpisanie kwoty w stanie, bez efektu).
  const [handled, setHandled] = useState<number | null>(null);
  if (request !== undefined && request !== null && request.key !== handled) {
    setHandled(request.key);
    setText(inputText(minimum));
    setSource('rebid');
    setError(undefined);
  }
  useEffect(() => {
    if (handled !== null) {
      input.current?.focus();
      input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [handled]);

  const parsed = parseBidAmount(text);
  const amount = typeof parsed === 'number' ? parsed : null;
  const preview = amount !== null && amount >= minimum ? amount : minimum;
  const quick = quickBidAmounts(money(minimum, auction.currency));
  // Minimalna oferta urosła ponad wpisaną kwotę (oferta kogoś innego na żywo).
  const overtaken = error === undefined && amount !== null && amount < minimum && text !== '';

  const fill = (value: number, from: BidSource) => {
    setText(inputText(value));
    setSource(from);
    setError(undefined);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed === 'empty') {
      setError({ text: t('amountRequired') });
      return;
    }
    if (parsed === 'invalid') {
      setError({ text: t('amountInvalid') });
      return;
    }
    if (parsed < minimum) {
      setError({ text: t('amountTooLow', { minimum: shortMoney(minimum) }) });
      return;
    }
    setError(undefined);
    if (attempt.current?.amount !== parsed) {
      attempt.current = { amount: parsed, key: crypto.randomUUID() };
    }
    setConfirming(parsed);
  };

  const confirm = async (value: number) => {
    if (attempt.current?.amount !== value) {
      attempt.current = { amount: value, key: crypto.randomUUID() };
    }
    const current = attempt.current;
    setSending(true);
    try {
      const result = await placeBid(
        auction.id,
        { maxAmount: value },
        { headers: { 'Idempotency-Key': current.key } },
      );
      attempt.current = null;
      setText('');
      track('bid_placed', { leading: result.leading, firstBid: standing === 'first', source });
      setSource('manual');
      onResult({
        leading: result.leading,
        amount: value,
        price: result.auction.currentPrice ?? auction.startPrice,
        minimum: result.auction.minimumNextBid ?? auction.startPrice,
      });
      await refresh();
    } catch (failure) {
      const definitive = isApiError(failure) && failure.status >= 400 && failure.status < 500;
      if (definitive) {
        attempt.current = null;
        setError({ text: failure.problem?.detail ?? t('error') });
        track('bid_failed', { code: failure.code ?? `HTTP_${String(failure.status)}` });
        if (failure.code !== undefined && STALE_STATE_CODES.has(failure.code)) {
          await refresh();
        }
      } else {
        // Sieć albo błąd serwera: ponowienie użyje tego samego klucza (bez drugiej oferty).
        setError({ text: t('error'), retry: value });
        track('bid_failed', { code: 'NETWORK' });
      }
    } finally {
      setSending(false);
      setConfirming(null);
    }
  };

  const describedBy = [error === undefined && !overtaken ? null : errorId, hintId]
    .filter((id) => id !== null)
    .join(' ');

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={inputId}>{standing === 'first' ? t('maxLabel') : t('newMaxLabel')}</Label>
          <span aria-hidden className="text-body-sm text-muted-foreground tabular-nums">
            {t('minimumShort', { minimum: shortMoney(minimum) })}
          </span>
        </div>
        <div className="relative">
          <Input
            ref={input}
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={text}
            placeholder={inputText(minimum)}
            aria-describedby={describedBy}
            aria-invalid={error === undefined ? undefined : true}
            className="pr-11 text-label-lg tabular-nums"
            onChange={(event) => {
              setText(event.target.value);
              setSource('manual');
              setError(undefined);
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-label-lg text-foreground-secondary"
          >
            zł
          </span>
        </div>
        <QuickBidAmounts
          amounts={quick}
          selected={amount}
          onSelect={(value) => {
            fill(value, 'quick');
          }}
        />
        {error === undefined && !overtaken ? null : (
          <div
            id={errorId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 text-body-sm font-semibold text-destructive"
          >
            <p className="flex items-center gap-1.5">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {error?.text ?? t('amountTooLow', { minimum: shortMoney(minimum) })}
            </p>
            {error?.retry === undefined ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sending}
                onClick={() => {
                  if (error.retry !== undefined) {
                    void confirm(error.retry);
                  }
                }}
              >
                {t('retry')}
              </Button>
            )}
          </div>
        )}
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {t('maxHint', { minimum: shortMoney(minimum) })}
        </p>
      </div>
      <TotalPrice
        amount={money(preview, auction.currency)}
        kind="maxBid"
        initialFeeSchedule={feeSchedule}
        shippingFrom={auction.shippingFrom === null ? null : money(auction.shippingFrom)}
        className="rounded-lg bg-canvas px-3.5 py-3"
      />
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={sending}>
        <Gavel aria-hidden />
        {sending
          ? t('bidding')
          : standing === 'outbid'
            ? t('outbidCta')
            : standing === 'leading'
              ? t('raise')
              : t('bid')}
      </Button>

      <ConfirmBid
        auction={auction}
        amount={confirming}
        minimum={minimum}
        timeLeft={timeLeft}
        feeSchedule={feeSchedule}
        sending={sending}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={(value) => void confirm(value)}
        onRaise={(value) => {
          fill(value, source);
          setConfirming(value);
        }}
      />
    </form>
  );
}

/**
 * Potwierdzenie oferty (projekt „Potwierdzenie oferty i alerty na żywo”): zdjęcie i tytuł, duże
 * maksimum z kwotą łączną, aktualna oferta i czas do końca. Gdy w międzyczasie minimalna oferta
 * urosła ponad kwotę, okno mówi o tym i proponuje nową minimalną zamiast wysyłać starą.
 */
function ConfirmBid({
  auction,
  amount,
  minimum,
  timeLeft,
  feeSchedule,
  sending,
  onCancel,
  onConfirm,
  onRaise,
}: {
  readonly auction: PublicAuctionDto;
  readonly amount: number | null;
  readonly minimum: number;
  readonly timeLeft: string | null;
  readonly feeSchedule: FeeScheduleDto | undefined;
  readonly sending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (amount: number) => void;
  readonly onRaise: (amount: number) => void;
}) {
  const t = useTranslations('auction.panel');
  const shown = amount ?? minimum;
  const stale = amount !== null && amount < minimum;
  const photo = auction.photos[0];

  return (
    <AlertDialog
      open={amount !== null}
      onOpenChange={(open) => {
        if (!open && !sending) {
          onCancel();
        }
      }}
    >
      <AlertDialogContent className="gap-5 rounded-3xl p-7">
        <AlertDialogHeader className="flex-row items-center gap-3.5 text-left sm:text-left">
          {photo === undefined ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.urls.thumb}
              alt=""
              className="size-14 shrink-0 rounded-lg bg-muted object-cover"
            />
          )}
          <div className="flex min-w-0 flex-col">
            <AlertDialogTitle className="text-h3">{t('confirmTitle')}</AlertDialogTitle>
            <p className="truncate text-body-sm text-muted-foreground">{auction.title}</p>
          </div>
        </AlertDialogHeader>

        <div className="flex flex-col items-center gap-0.5 rounded-xl bg-accent px-4 py-5 text-center">
          <span className="text-overline text-accent-foreground uppercase">{t('yourMax')}</span>
          <span className="text-price-xl tabular-nums">{shortMoney(shown)}</span>
          <TotalPrice
            amount={money(shown, auction.currency)}
            kind="maxBid"
            initialFeeSchedule={feeSchedule}
            shippingFrom={auction.shippingFrom === null ? null : money(auction.shippingFrom)}
            withDetails={false}
            className="text-foreground-secondary"
          />
        </div>

        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body-sm text-foreground-secondary">
          <dt>{t('currentOffer')}</dt>
          <dd className="text-right font-bold text-foreground tabular-nums">
            {shortMoney(auction.currentPrice ?? auction.startPrice)}
          </dd>
          {timeLeft === null ? null : (
            <>
              <dt>{t('timeLeft')}</dt>
              <dd className="text-right font-extrabold text-urgent tabular-nums">{timeLeft}</dd>
            </>
          )}
        </dl>

        {stale ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-urgent-soft px-3.5 py-3 text-body-sm font-semibold text-urgent"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('confirmStale', { minimum: shortMoney(minimum) })}
          </p>
        ) : null}
        <AlertDialogDescription className="rounded-lg bg-canvas px-3.5 py-3 text-body-sm text-foreground-secondary">
          {t('confirmText', { amount: shortMoney(shown) })} {t('confirmShipping')}
        </AlertDialogDescription>

        <AlertDialogFooter className="gap-2.5 sm:flex-row">
          <AlertDialogCancel disabled={sending} className="sm:flex-1">
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'cta' }), 'sm:flex-[1.5]')}
            disabled={sending}
            onClick={(event) => {
              // Okno zamykamy po odpowiedzi API, nie od razu.
              event.preventDefault();
              if (stale) {
                onRaise(minimum);
              } else if (amount !== null) {
                onConfirm(amount);
              }
            }}
          >
            {sending
              ? t('bidding')
              : stale
                ? t('confirmMinimum', { minimum: shortMoney(minimum) })
                : t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
