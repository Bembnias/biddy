'use client';

import {
  type AddressDto,
  type CheckoutDto,
  chooseDelivery,
  getGetCheckoutQueryKey,
  isApiError,
  startPayment,
} from '@biddy/api-client';
import { formatMoney, money } from '@biddy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { track } from '@/analytics/posthog';
import { AuthForm, FormAlert, TextField, useErrorMessage } from '@/components/auth/form-parts';
import { useValidationMessages } from '@/components/auth/use-validation';
import { Button } from '@/components/ui/button';
import { addressSchema } from '@/lib/auth/schemas';
import { newPaymentKey, totalWith } from '@/lib/checkout/checkout';
import { formatPhoneNumber } from '@/lib/phone';
import { cn } from '@/lib/utils';

import { CheckoutSummary } from './checkout-summary';
import { type ChosenPoint, PickupPointPicker } from './pickup-point-picker';

type Method = CheckoutDto['paymentMethods'][number];

/** Pole błędu z API (`recipient.phone`) → pole formularza. */
const API_FIELDS = {
  'recipient.name': 'recipientName',
  'recipient.phone': 'phone',
  'recipient.address.street': 'street',
  'recipient.address.postalCode': 'postalCode',
  'recipient.address.city': 'city',
  blikCode: 'blikCode',
} as const;

function useCheckoutSchema(view: CheckoutDto) {
  const messages = useValidationMessages();
  const t = useTranslations('checkout');
  const address = addressSchema(messages);
  return z
    .object({
      carrierId: z.string().min(1, t('delivery.chooseCarrier')),
      recipientName: address.shape.recipientName,
      phone: address.shape.phone,
      street: z.string(),
      postalCode: z.string(),
      city: z.string(),
      method: z.enum(['BLIK', 'CARD', 'PAY_BY_LINK']),
      blikCode: z.string(),
    })
    .superRefine((values, ctx) => {
      const option = view.options.find((candidate) => candidate.carrierId === values.carrierId);
      if (option !== undefined && !option.requiresPickupPoint) {
        const parsed = address
          .pick({ street: true, postalCode: true, city: true })
          .safeParse(values);
        for (const issue of parsed.error?.issues ?? []) {
          ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
        }
      }
      if (values.method === 'BLIK' && !/^\d{6}$/u.test(values.blikCode.replaceAll(' ', ''))) {
        ctx.addIssue({ code: 'custom', path: ['blikCode'], message: t('payment.blikRequired') });
      }
    });
}

type FormValues = z.output<ReturnType<typeof useCheckoutSchema>>;

/**
 * Formularz checkoutu (F-25, układ jak strona nadania F-63): z lewej karty „Dostawa” (usługa,
 * punkt odbioru albo adres, odbiorca) i „Płatność” (BLIK z kodem, karta, szybki przelew), z prawej
 * podsumowanie z przyciskiem „Zapłać {suma}”. Kliknięcie zapisuje dostawę, porównuje sumę z API
 * z sumą na przycisku i zakłada płatność z kluczem Idempotency-Key (ponowienie po błędzie sieci
 * używa tego samego klucza). Płatność z przekierowaniem przechodzi na stronę operatora.
 */
export function CheckoutForm({
  publicId,
  view,
  defaultAddress,
}: {
  readonly publicId: string;
  readonly view: CheckoutDto;
  /** Domyślny adres dostawy z konta (F-10) albo undefined. */
  readonly defaultAddress: AddressDto | undefined;
}) {
  const t = useTranslations('checkout');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const id = useId();
  const keyRef = useRef<string | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [pointError, setPointError] = useState<string>();
  const saved = view.delivery;
  const [point, setPoint] = useState<ChosenPoint | null>(saved?.pickupPoint ?? null);
  const savedAddress = saved?.recipient.address ?? null;
  const prefill = saved === null ? defaultAddress : undefined;
  const form = useForm({
    resolver: zodResolver(useCheckoutSchema(view)),
    defaultValues: {
      carrierId: saved?.carrierId ?? view.options[0]?.carrierId ?? '',
      recipientName: saved?.recipient.name ?? prefill?.recipientName ?? '',
      phone: formatPhoneNumber(saved?.recipient.phone ?? prefill?.phone ?? ''),
      street: savedAddress?.street ?? prefill?.street ?? '',
      postalCode: savedAddress?.postalCode ?? prefill?.postalCode ?? '',
      city: savedAddress?.city ?? prefill?.city ?? '',
      method: (view.payment?.method as Method | undefined) ?? 'BLIK',
      blikCode: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const carrierId = useWatch({ control: form.control, name: 'carrierId' });
  const method = useWatch({ control: form.control, name: 'method' });
  const option = view.options.find((candidate) => candidate.carrierId === carrierId);
  const total = totalWith(view, carrierId);
  const queryKey = getGetCheckoutQueryKey(publicId);
  const failed = view.payment?.status === 'FAILED' ? view.payment : null;

  const submit = async (values: FormValues) => {
    setError(undefined);
    setPointError(undefined);
    if (option?.requiresPickupPoint === true && point === null) {
      setPointError(t('delivery.pointRequired'));
      document.getElementById(`${id}-delivery`)?.scrollIntoView({ block: 'start' });
      return;
    }
    const shown = totalWith(view, values.carrierId);
    try {
      const delivered = await chooseDelivery(publicId, {
        carrierId: values.carrierId,
        pickupPointId: option?.requiresPickupPoint === true ? (point?.id ?? null) : null,
        recipient: {
          name: values.recipientName,
          phone: values.phone,
          address:
            option?.requiresPickupPoint === true
              ? null
              : { street: values.street, postalCode: values.postalCode, city: values.city },
        },
      });
      queryClient.setQueryData(queryKey, delivered);
      track('checkout_delivery_selected', { kind: option?.kind });
      if (delivered.order.total !== shown) {
        setError(t('totalChanged'));
        return;
      }
      keyRef.current ??= newPaymentKey();
      const started = await startPayment(
        publicId,
        {
          method: values.method,
          blikCode: values.method === 'BLIK' ? values.blikCode.replaceAll(' ', '') : null,
          expectedTotal: shown,
        },
        { headers: { 'Idempotency-Key': keyRef.current } },
      );
      keyRef.current = undefined;
      track('checkout_payment_started', { method: values.method });
      const redirect = started.payment?.status === 'PENDING' ? started.payment.redirectUrl : null;
      if (redirect !== null && redirect !== undefined) {
        window.location.assign(redirect);
        return;
      }
      queryClient.setQueryData(queryKey, started);
    } catch (caught) {
      // Odpowiedź API kończy tę próbę (następna dostaje nowy klucz); błąd sieci ponawiamy z tym
      // samym kluczem, więc nie powstanie druga płatność.
      if (isApiError(caught)) {
        keyRef.current = undefined;
      }
      const code = isApiError(caught) ? caught.problem?.code : undefined;
      if (code === 'CHECKOUT_TOTAL_CHANGED' || code === 'PAYMENT_IN_PROGRESS') {
        await queryClient.invalidateQueries({ queryKey });
      }
      if (code === 'CHECKOUT_TOTAL_CHANGED') {
        setError(t('totalChanged'));
        return;
      }
      const fieldErrors = isApiError(caught) ? (caught.problem?.errors ?? []) : [];
      let mapped = 0;
      for (const item of fieldErrors) {
        const field = API_FIELDS[item.path as keyof typeof API_FIELDS] as
          keyof FormValues | undefined;
        if (field !== undefined) {
          form.setError(field, { message: item.message });
          mapped += 1;
        }
      }
      if (code === 'PICKUP_POINT_NOT_FOUND' || code === 'PICKUP_POINT_REQUIRED') {
        setPoint(null);
        setPointError(errorMessage(caught));
      } else if (mapped === 0) {
        setError(errorMessage(caught));
      }
    }
  };

  const zl = (amount: number) => formatMoney(money(amount, view.order.currency));
  const cardClass = (checked: boolean) =>
    cn(
      'flex cursor-pointer items-start gap-3.5 rounded-xl border border-border-strong px-4 py-3.5 transition-[border-color,box-shadow,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
      checked && 'border-brand bg-violet-50 ring-1 ring-brand',
    );

  return (
    <AuthForm
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      aria-label={t('title')}
      className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div className="min-w-0 space-y-5">
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}

        <section
          id={`${id}-delivery`}
          aria-labelledby={`${id}-delivery-title`}
          className="scroll-mt-24 space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-7"
        >
          <h2 id={`${id}-delivery-title`} className="text-h3">
            {t('delivery.title')}
          </h2>
          {view.options.length === 0 ? (
            <p className="rounded-lg bg-warning-soft px-4 py-3 text-body-sm">
              {t('delivery.none')}
            </p>
          ) : (
            <fieldset className="min-w-0 space-y-2.5">
              <legend className="sr-only">{t('delivery.title')}</legend>
              {view.options.map((candidate) => (
                <label
                  key={candidate.carrierId}
                  className={cardClass(carrierId === candidate.carrierId)}
                >
                  <input
                    type="radio"
                    value={candidate.carrierId}
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                    {...form.register('carrierId', {
                      onChange: () => {
                        setPointError(undefined);
                        setPoint(
                          saved?.carrierId === candidate.carrierId
                            ? (saved.pickupPoint ?? null)
                            : null,
                        );
                      },
                    })}
                  />
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4">
                    <span className="flex flex-col text-title">
                      {candidate.name}{' '}
                      <span className="text-body-sm font-medium text-muted-foreground">
                        {t(`delivery.kinds.${candidate.kind}`)}
                      </span>
                    </span>{' '}
                    <span className="text-title tabular-nums">{zl(candidate.price)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {option?.requiresPickupPoint === true ? (
            <PickupPointPicker
              key={option.carrierId}
              carrierId={option.carrierId}
              value={point}
              onChange={(next) => {
                setPoint(next);
                setPointError(undefined);
              }}
              error={pointError}
            />
          ) : null}

          <div className="space-y-4 border-t border-ink-100 pt-5">
            <h3 className="text-title">{t('delivery.recipient')}</h3>
            {saved === null && defaultAddress !== undefined ? (
              <p className="flex items-start gap-2.5 rounded-lg bg-success-soft px-3.5 py-3 text-body-sm font-semibold text-green-800">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('delivery.defaultAddress')}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
              <div className="sm:col-span-2">
                <TextField
                  label={t('delivery.name')}
                  autoComplete="name"
                  error={errors.recipientName?.message}
                  {...form.register('recipientName')}
                />
              </div>
              {option !== undefined && !option.requiresPickupPoint ? (
                <>
                  <div className="sm:col-span-2">
                    <TextField
                      label={t('delivery.street')}
                      autoComplete="street-address"
                      error={errors.street?.message}
                      {...form.register('street')}
                    />
                  </div>
                  <TextField
                    label={t('delivery.postalCode')}
                    autoComplete="postal-code"
                    inputMode="numeric"
                    placeholder="00-000"
                    error={errors.postalCode?.message}
                    {...form.register('postalCode')}
                  />
                  <TextField
                    label={t('delivery.city')}
                    autoComplete="address-level2"
                    error={errors.city?.message}
                    {...form.register('city')}
                  />
                </>
              ) : null}
              <div className="sm:col-span-2">
                <TextField
                  label={t('delivery.phone')}
                  hint={t('delivery.phoneHint')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  error={errors.phone?.message}
                  {...form.register('phone')}
                />
              </div>
            </div>
          </div>
        </section>

        <section
          aria-labelledby={`${id}-payment-title`}
          className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7"
        >
          <h2 id={`${id}-payment-title`} className="text-h3">
            {t('payment.title')}
          </h2>
          {failed === null || failed.failureReason === null ? null : (
            <div
              role="alert"
              className="space-y-1 rounded-xl border border-red-200 bg-destructive-soft px-4 py-3.5"
            >
              <p className="text-title text-destructive">{t('payment.failedTitle')}</p>
              <p className="text-body-sm">{t(`payment.failed.${failed.failureReason}`)}</p>
            </div>
          )}
          <fieldset className="min-w-0 space-y-2.5">
            <legend className="sr-only">{t('payment.title')}</legend>
            {view.paymentMethods.map((candidate) => (
              <label key={candidate} className={cardClass(method === candidate)}>
                <input
                  type="radio"
                  value={candidate}
                  className="mt-0.5 size-5 shrink-0 accent-brand"
                  {...form.register('method')}
                />
                <span className="flex flex-col text-title">
                  {t(`payment.methods.${candidate}`)}{' '}
                  <span className="text-body-sm font-medium text-muted-foreground">
                    {t(`payment.methodHints.${candidate}`)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {method === 'BLIK' ? (
            <div className="max-w-60">
              <TextField
                label={t('payment.blikCode')}
                hint={t('payment.blikHint')}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                className="text-center text-h3 tracking-widest tabular-nums"
                error={errors.blikCode?.message}
                {...form.register('blikCode')}
              />
            </div>
          ) : null}
          <p className="flex items-start gap-2.5 text-body-sm text-foreground-secondary">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('payment.escrow')}
          </p>
        </section>
      </div>

      <CheckoutSummary view={view} shippingFee={option?.price ?? null} total={total}>
        <Button
          type="submit"
          variant="cta"
          size="lg"
          className="w-full"
          disabled={isSubmitting || view.options.length === 0}
        >
          {isSubmitting
            ? t('summary.paying')
            : t(failed === null ? 'summary.pay' : 'summary.payAgain', { total: zl(total) })}
        </Button>
      </CheckoutSummary>
    </AuthForm>
  );
}
