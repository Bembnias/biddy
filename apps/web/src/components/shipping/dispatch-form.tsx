'use client';

import {
  type AddressDto,
  type DispatchShipmentBody,
  type ShipmentDto,
  isApiError,
} from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { AuthForm, FormAlert, TextField, useErrorMessage } from '@/components/auth/form-parts';
import { useValidationMessages } from '@/components/auth/use-validation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { addressSchema } from '@/lib/auth/schemas';
import { formatPhoneNumber } from '@/lib/phone';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type DispatchMethod = ShipmentDto['dispatchMethods'][number];
type FormValues = z.output<ReturnType<typeof addressSchema>>;
type FieldName = keyof FormValues;

/** Pole błędu z API (`sender.phone`, `sender.address.city`) → pole formularza. */
const API_FIELDS: Readonly<Record<string, FieldName>> = {
  'sender.name': 'recipientName',
  'sender.phone': 'phone',
  'sender.address.street': 'street',
  'sender.address.postalCode': 'postalCode',
  'sender.address.city': 'city',
};

/**
 * Formularz „Nadaj” (F-24, PROJECT.md §8.3): dane nadawcy (na etykiecie, zobaczy je kupujący)
 * i sposób nadania. Wypełnia się domyślnym adresem nadania z konta (F-10). Wysyłkę robi
 * wywołujący (`onSubmit`): strona zamówienia albo panel FakeShipping.
 */
export function DispatchForm({
  methods,
  senderAddress,
  onSubmit,
}: {
  /** Sposoby nadania dostępne dla przesyłki (usługa i dostawca). */
  readonly methods: readonly DispatchMethod[];
  /** Domyślny adres nadania z konta albo undefined. */
  readonly senderAddress: AddressDto | undefined;
  readonly onSubmit: (body: DispatchShipmentBody) => Promise<unknown>;
}) {
  const t = useTranslations('shipping.dispatch');
  const errorMessage = useErrorMessage();
  const methodsId = useId();
  const [method, setMethod] = useState<DispatchMethod>(methods[0] ?? 'DROP_OFF');
  const [error, setError] = useState<string>();
  const form = useForm({
    resolver: zodResolver(addressSchema(useValidationMessages())),
    defaultValues: {
      recipientName: senderAddress?.recipientName ?? '',
      street: senderAddress?.street ?? '',
      postalCode: senderAddress?.postalCode ?? '',
      city: senderAddress?.city ?? '',
      phone: formatPhoneNumber(senderAddress?.phone ?? ''),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = async (values: FormValues) => {
    setError(undefined);
    try {
      await onSubmit({
        sender: {
          name: values.recipientName,
          phone: values.phone,
          address: { street: values.street, postalCode: values.postalCode, city: values.city },
        },
        dispatchMethod: method,
      });
    } catch (caught) {
      const fieldErrors = isApiError(caught) ? (caught.problem?.errors ?? []) : [];
      const known = fieldErrors.filter((item) => API_FIELDS[item.path] !== undefined);
      for (const item of known) {
        form.setError(API_FIELDS[item.path] ?? 'recipientName', { message: item.message });
      }
      if (known.length === 0) {
        setError(errorMessage(caught));
      }
    }
  };

  return (
    <AuthForm
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="space-y-1">
        <h2 className="text-h3">{t('senderTitle')}</h2>
        <p className="text-body-sm text-foreground-secondary">{t('senderLead')}</p>
        <p className="text-body-sm text-muted-foreground">
          {senderAddress === undefined ? (
            <>
              {t('senderDefaultMissing')}{' '}
              <Link
                href={routes.addresses}
                className="text-link underline-offset-3 hover:underline"
              >
                {t('addresses')}
              </Link>
            </>
          ) : (
            t('senderDefault')
          )}
        </p>
      </div>
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <TextField
        label={t('name')}
        autoComplete="name"
        error={errors.recipientName?.message}
        {...form.register('recipientName')}
      />
      <TextField
        label={t('street')}
        hint={t('streetHint')}
        autoComplete="street-address"
        error={errors.street?.message}
        {...form.register('street')}
      />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <TextField
          label={t('postalCode')}
          autoComplete="postal-code"
          inputMode="numeric"
          placeholder="00-000"
          error={errors.postalCode?.message}
          {...form.register('postalCode')}
        />
        <TextField
          label={t('city')}
          autoComplete="address-level2"
          error={errors.city?.message}
          {...form.register('city')}
        />
      </div>
      <TextField
        label={t('phone')}
        hint={t('phoneHint')}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-label">{t('method')}</legend>
        {methods.map((option) => (
          <div
            key={option}
            className={cn(
              'flex items-start gap-3 rounded-lg border border-border px-4 py-3 has-[:focus-visible]:shadow-focus-ring',
              method === option && 'border-primary bg-info-soft',
            )}
          >
            <input
              id={`${methodsId}-${option}`}
              type="radio"
              name={`${methodsId}-method`}
              value={option}
              checked={method === option}
              onChange={() => {
                setMethod(option);
              }}
              className="mt-1 accent-primary"
            />
            <Label htmlFor={`${methodsId}-${option}`} className="block cursor-pointer">
              <span className="block text-title">{t(`methods.${option}`)}</span>
              <span className="block text-body-sm font-normal text-muted-foreground">
                {t(`methodHints.${option}`)}
              </span>
            </Label>
          </div>
        ))}
      </fieldset>
      <Button
        type="submit"
        variant="cta"
        size="lg"
        className="w-full sm:w-auto"
        disabled={isSubmitting}
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </AuthForm>
  );
}
