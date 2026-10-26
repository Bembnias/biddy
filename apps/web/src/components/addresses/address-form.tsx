'use client';

import {
  type AddressDto,
  getGetMyAddressesQueryKey,
  isApiError,
  useCreateAddress,
  useUpdateAddress,
} from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { AuthForm, FormAlert, TextField, useErrorMessage } from '@/components/auth/form-parts';
import { useValidationMessages } from '@/components/auth/use-validation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { addressSchema } from '@/lib/auth/schemas';
import { formatPhoneNumber } from '@/lib/phone';
import { routes } from '@/lib/routes';

type FormValues = z.output<ReturnType<typeof addressSchema>>;
type FieldName = keyof FormValues;

const FIELDS: readonly FieldName[] = ['recipientName', 'street', 'postalCode', 'city', 'phone'];

/**
 * Nowy adres albo edycja adresu (F-10). Przy nowym adresie można od razu ustawić go jako
 * domyślny; w edycji flagi zmienia lista adresów.
 */
export function AddressForm({
  address,
  defaultPhone,
}: {
  /** Edytowany adres; bez niego formularz tworzy nowy. */
  readonly address?: AddressDto;
  /** Podpowiedź telefonu dla nowego adresu (zweryfikowany numer konta). */
  readonly defaultPhone?: string | null;
}) {
  const t = useTranslations('addresses.form');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const [error, setError] = useState<string>();
  const [flags, setFlags] = useState({ isDefault: false, isSenderDefault: false });
  const form = useForm({
    resolver: zodResolver(addressSchema(useValidationMessages())),
    defaultValues: {
      recipientName: address?.recipientName ?? '',
      street: address?.street ?? '',
      postalCode: address?.postalCode ?? '',
      city: address?.city ?? '',
      phone: formatPhoneNumber(address?.phone ?? defaultPhone ?? ''),
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;

  const submit = async (values: FormValues) => {
    setError(undefined);
    try {
      if (address === undefined) {
        await create.mutateAsync({ data: { ...values, ...flags } });
      } else {
        await update.mutateAsync({ id: address.id, data: values });
      }
      track('address_saved', { is_new: address === undefined });
      await queryClient.invalidateQueries({ queryKey: getGetMyAddressesQueryKey() });
      router.push(routes.addresses);
      router.refresh();
    } catch (caught) {
      const fieldErrors = isApiError(caught) ? (caught.problem?.errors ?? []) : [];
      const known = fieldErrors.filter((item) => FIELDS.includes(item.path as FieldName));
      for (const item of known) {
        form.setError(item.path as FieldName, { message: item.message });
      }
      if (known.length === 0) {
        setError(errorMessage(caught));
      }
    }
  };

  return (
    <AuthForm
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-7"
    >
      {error === undefined ? null : (
        <div className="sm:col-span-2">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
      <div className="sm:col-span-2">
        <TextField
          label={t('recipientName')}
          autoComplete="name"
          error={errors.recipientName?.message}
          {...form.register('recipientName')}
        />
      </div>
      <div className="sm:col-span-2">
        <TextField
          label={t('street')}
          hint={t('streetHint')}
          autoComplete="street-address"
          error={errors.street?.message}
          {...form.register('street')}
        />
      </div>
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
      <TextField
        label={t('phone')}
        hint={t('phoneHint')}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <div className="space-y-2">
        <p className="text-label">{t('countryLabel')}</p>
        <p className="flex h-12 items-center rounded-md bg-muted px-3.5 text-body font-semibold text-foreground-secondary">
          {t('countryValue')}
        </p>
      </div>
      {address === undefined ? (
        <fieldset className="space-y-3 sm:col-span-2">
          <legend className="sr-only">{t('flags')}</legend>
          {(['isDefault', 'isSenderDefault'] as const).map((flag) => (
            <div key={flag} className="flex items-center gap-3">
              <Checkbox
                id={`address-${flag}`}
                checked={flags[flag]}
                onCheckedChange={(checked) => {
                  setFlags((current) => ({ ...current, [flag]: checked === true }));
                }}
              />
              <Label htmlFor={`address-${flag}`}>{t(flag)}</Label>
            </div>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap gap-3 pt-1 sm:col-span-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('pending') : t('submit')}
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href={routes.addresses}>{t('cancel')}</Link>
        </Button>
      </div>
    </AuthForm>
  );
}
