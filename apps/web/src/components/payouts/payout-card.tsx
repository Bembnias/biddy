'use client';

// Karta wypłaty (F-27): bez danych do wypłat albo przy blokadzie mówi, dlaczego nie można
// wypłacić i co zrobić; inaczej pole kwoty (domyślnie całe saldo) i „Wypłać”. Zlecenie idzie
// z Idempotency-Key: ponowienie po błędzie sieci nie zleca drugiej wypłaty.
import {
  type SellerBalanceDto,
  getGetMyBalanceHistoryQueryKey,
  getGetMyBalanceQueryKey,
  isApiError,
  requestPayout,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { FieldErrorText, FormAlert, useErrorMessage } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { amountInputValue, parsePayoutAmount } from '@/lib/payouts/payout-view';
import { routes } from '@/lib/routes';

type Blocker = NonNullable<SellerBalanceDto['payout']['blocker']>;

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

const linkClass =
  'rounded-xs text-label text-link underline underline-offset-3 outline-none hover:text-link-hover focus-visible:shadow-focus-ring';

export function PayoutCard({ balance }: { readonly balance: SellerBalanceDto }) {
  const t = useTranslations('balance.payout');
  const blocker = balance.payout.blocker;
  // Potwierdzenie na poziomie karty: po wypłacie całego salda formularz ustępuje powodowi
  // „brak środków”, a potwierdzenie ma zostać.
  const [requested, setRequested] = useState<number>();
  return (
    <section
      aria-labelledby="balance-payout"
      className="space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 id="balance-payout" className="text-h3">
        {t('title')}
      </h2>
      <div role="status">
        {requested === undefined ? null : (
          <p className="rounded-lg bg-success-soft px-4 py-3 text-body-sm">
            {t('requested', { amount: zl(requested) })}
          </p>
        )}
      </div>
      {blocker === null ? (
        <PayoutForm balance={balance} onRequested={setRequested} />
      ) : (
        <BlockerNote blocker={blocker} />
      )}
      {balance.payout.bankAccountMasked === null ? null : (
        <p className="text-body-sm text-foreground-secondary">
          {t('account', { account: balance.payout.bankAccountMasked })}
          {' · '}
          <Link href={routes.payoutProfile} className={linkClass}>
            {t('changeAccount')}
          </Link>
        </p>
      )}
    </section>
  );
}

function BlockerNote({ blocker }: { readonly blocker: Blocker }) {
  const t = useTranslations('balance.payout');
  const format = useFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  switch (blocker.code) {
    case 'PAYOUT_PROFILE_INCOMPLETE':
      return (
        <div className="space-y-3">
          <p className="text-body">{t('blockers.PAYOUT_PROFILE_INCOMPLETE')}</p>
          <Button asChild>
            <Link href={routes.payoutProfile}>{t('completeProfile')}</Link>
          </Button>
        </div>
      );
    case 'PAYOUTS_BLOCKED':
      return (
        <p className="text-body">
          {blocker.until === null
            ? t('blockers.PAYOUTS_BLOCKED_FOREVER')
            : t('blockers.PAYOUTS_BLOCKED', { date: date(blocker.until) })}{' '}
          <Link href={routes.accountStanding} className={linkClass}>
            {t('standingLink')}
          </Link>
        </p>
      );
    case 'PAYOUTS_ON_HOLD':
      return (
        <p className="text-body">
          {t('blockers.PAYOUTS_ON_HOLD', {
            date: blocker.until === null ? '' : date(blocker.until),
          })}
        </p>
      );
    case 'RECEIVABLE_OUTSTANDING':
      return (
        <p className="text-body">
          {t('blockers.RECEIVABLE_OUTSTANDING', { amount: zl(blocker.amount ?? 0) })}
        </p>
      );
    case 'PAYOUT_BELOW_MINIMUM':
      return (
        <p className="text-body">
          {t('blockers.PAYOUT_BELOW_MINIMUM', { minimum: zl(blocker.amount ?? 0) })}
        </p>
      );
    case 'SELLER_NOT_VERIFIED':
    case 'INSUFFICIENT_BALANCE':
      return <p className="text-body">{t(`blockers.${blocker.code}`)}</p>;
  }
}

function PayoutForm({
  balance,
  onRequested,
}: {
  readonly balance: SellerBalanceDto;
  readonly onRequested: (amount: number | undefined) => void;
}) {
  const t = useTranslations('balance.payout');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [text, setText] = useState(amountInputValue(balance.available));
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  // Klucz próby: ten sam przy ponowieniu tej samej kwoty po błędzie sieci.
  const attempt = useRef<{ readonly amount: number; readonly key: string } | null>(null);

  const parsed = parsePayoutAmount(text);
  const amount = typeof parsed === 'number' ? parsed : undefined;

  const submit = async () => {
    setError(undefined);
    onRequested(undefined);
    if (amount === undefined) {
      setFieldError(t('amountInvalid'));
      return;
    }
    if (amount < balance.minimumPayout) {
      setFieldError(t('amountTooLow', { minimum: zl(balance.minimumPayout) }));
      return;
    }
    if (amount > balance.available) {
      setFieldError(t('amountTooHigh', { available: zl(balance.available) }));
      return;
    }
    setFieldError(undefined);
    if (attempt.current?.amount !== amount) {
      attempt.current = { amount, key: crypto.randomUUID() };
    }
    setSending(true);
    try {
      await requestPayout(amount === balance.available ? {} : { amount }, {
        headers: { 'Idempotency-Key': attempt.current.key },
      });
      attempt.current = null;
      track('payout_requested', { trigger: 'MANUAL' });
      onRequested(amount);
      setText(amountInputValue(balance.available - amount));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMyBalanceQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMyBalanceHistoryQueryKey() }),
      ]);
    } catch (caught) {
      // Odpowiedź serwera kończy próbę; błąd sieci zostawia klucz do ponowienia.
      if (isApiError(caught)) {
        attempt.current = null;
      }
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <div className="space-y-2">
        <Label htmlFor="payout-amount">{t('amount')}</Label>
        <div className="relative max-w-60">
          <Input
            id="payout-amount"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={fieldError === undefined ? undefined : true}
            aria-describedby={
              fieldError === undefined
                ? 'payout-amount-hint'
                : 'payout-amount-hint payout-amount-error'
            }
            className="pr-11 tabular-nums"
            onChange={(event) => {
              setText(event.target.value);
              setFieldError(undefined);
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-body text-muted-foreground"
          >
            zł
          </span>
        </div>
        <p id="payout-amount-hint" className="text-body-sm text-muted-foreground">
          {t('amountHint', {
            minimum: zl(balance.minimumPayout),
            available: zl(balance.available),
          })}
        </p>
        {fieldError === undefined ? null : (
          <FieldErrorText id="payout-amount-error">{fieldError}</FieldErrorText>
        )}
      </div>
      <Button type="submit" size="lg" disabled={sending}>
        {sending
          ? t('pending')
          : amount === undefined
            ? t('submitPlain')
            : t('submit', { amount: zl(amount) })}
      </Button>
    </form>
  );
}
