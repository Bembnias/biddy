'use client';

import {
  type FakePaymentDto,
  completeFakePayment,
  getGetFakePaymentQueryKey,
  isApiError,
  useGetFakePayment,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/price';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';
import { safeReturnUrl } from '@/lib/routes';

type Outcome = 'SUCCEEDED' | 'FAILED';

const STATUS_TONES = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
} as const satisfies Record<FakePaymentDto['status'], 'warning' | 'success' | 'danger'>;

function problemDetail(error: unknown): string {
  if (isApiError(error)) {
    const detail = (error.problem as { detail?: unknown } | undefined)?.detail;
    return typeof detail === 'string' ? detail : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Testowa strona płatności FakeGateway (F-23): kupujący wybiera wynik płatności z przekierowaniem
 * (karta, przelew, BLIK bez kodu), a strona wraca do Biddy, jak strona operatora. Powrót tylko
 * w obrębie strony Biddy; inny adres pokazujemy jako tekst.
 */
export function FakePayPanel({ paymentId }: { readonly paymentId: string }) {
  const t = useTranslations('devPayments');
  const queryClient = useQueryClient();
  const payment = useGetFakePayment(paymentId, { query: { retry: false } });
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'sending' | 'redirecting' } | { kind: 'error'; detail: string }
  >({ kind: 'idle' });

  if (payment.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('pay.loading')}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (payment.isError) {
    const missing = isApiError(payment.error) && payment.error.status === 404;
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {missing ? t('pay.notFound') : t('pay.error')}
          {missing ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void payment.refetch()}
            >
              {t('pay.retry')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const data = payment.data;
  const back = safeReturnUrl(data.returnUrl, config.siteUrl);
  const complete = async (outcome: Outcome) => {
    setState({ kind: 'sending' });
    try {
      const result = await completeFakePayment(paymentId, { outcome });
      queryClient.setQueryData(getGetFakePaymentQueryKey(paymentId), result);
      const target = safeReturnUrl(result.returnUrl, config.siteUrl);
      if (target === null) {
        setState({ kind: 'idle' });
        return;
      }
      setState({ kind: 'redirecting' });
      window.location.assign(target);
    } catch (error) {
      setState({ kind: 'error', detail: problemDetail(error) });
    }
  };
  const busy = state.kind === 'sending' || state.kind === 'redirecting';

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="sr-only">{t('pay.amount')}</dt>
          <dd>
            <Price label={t('pay.amount')} size="xl">
              {formatMoney(money(data.amount, data.currency))}
            </Price>
          </dd>
        </div>
        <div>
          <dt className="text-label text-foreground-secondary">{t('pay.method')}</dt>
          <dd className="text-body">{t(`methods.${data.method}`)}</dd>
        </div>
        <div>
          <dt className="text-label text-foreground-secondary">{t('pay.status')}</dt>
          <dd>
            <Badge tone={STATUS_TONES[data.status]}>{t(`paymentStatus.${data.status}`)}</Badge>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-label text-foreground-secondary">{t('pay.paymentId')}</dt>
          <dd className="font-mono text-body-sm break-all">{data.id}</dd>
        </div>
      </dl>

      {data.status === 'PENDING' ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => void complete('SUCCEEDED')}
          >
            {busy ? t('pay.sending') : t('pay.pay')}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={busy}
            onClick={() => void complete('FAILED')}
          >
            {t('pay.decline')}
          </Button>
        </div>
      ) : (
        <p className="text-body">{t('pay.settled')}</p>
      )}

      <div role="status" className="text-body-sm">
        {state.kind === 'redirecting' ? t('pay.redirecting') : null}
      </div>
      {state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription>{t('pay.actionError', { detail: state.detail })}</AlertDescription>
        </Alert>
      ) : null}

      {data.status !== 'PENDING' && state.kind !== 'redirecting' ? (
        back === null ? (
          <p className="text-body-sm break-all text-foreground-secondary">
            {t('pay.returnUrl', { url: data.returnUrl })}
          </p>
        ) : (
          <a
            href={back}
            className="font-semibold text-link underline underline-offset-3 hover:text-link-hover"
          >
            {t('pay.back')}
          </a>
        )
      ) : null}
    </div>
  );
}

/** Pasek „środowisko testowe” nad stronami FakeGateway. */
export function FakeGatewayBanner() {
  const t = useTranslations('devPayments');
  return (
    <Alert variant="warning" role="note" className="mb-6">
      <FlaskConical aria-hidden />
      <AlertDescription>{t('banner')}</AlertDescription>
    </Alert>
  );
}
