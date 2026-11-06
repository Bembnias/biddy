'use client';

// Dane do wypłat (F-27): dane osobowe do DAC7 i rachunek w dwóch osobnych formularzach. API
// zwraca identyfikator podatkowy i rachunek tylko zamaskowane, więc przy zmianie trzeba je podać
// ponownie. Zmiana numeru rachunku wstrzymuje wypłaty na 48 h (ostrzeżenie przed zapisem).
import {
  type PayoutProfileDto,
  getGetMyBalanceQueryKey,
  getGetPayoutProfileQueryKey,
  isApiError,
  useGetPayoutProfile,
  usePutBankAccount,
  usePutPersonalData,
} from '@biddy/api-client';
import { formatIban, normalizeIban, normalizePostalCode, normalizeTaxId } from '@biddy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  type FieldValues,
  type Path,
  type UseFormReturn,
  useForm,
  useWatch,
} from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { useServerNow } from '@/components/auction/use-auction';
import { AuthForm, FormAlert, TextField, useErrorMessage } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import {
  bankAccountSchema,
  type PayoutValidationMessages,
  personalDataSchema,
} from '@/lib/payouts/payout-view';

export function PayoutProfileForms() {
  const t = useTranslations('payoutProfile');
  const profile = useGetPayoutProfile();

  if (profile.isPending) {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (profile.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void profile.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PersonalDataForm profile={profile.data} />
      <BankAccountForm profile={profile.data} />
    </div>
  );
}

function useValidation(): PayoutValidationMessages {
  const t = useTranslations('payoutProfile.validation');
  return (key) => t(key);
}

/** Po zapisie: nowe dane do wypłat w pamięci podręcznej i odświeżone saldo (powód blokady). */
function useSaved() {
  const queryClient = useQueryClient();
  return async (profile: PayoutProfileDto) => {
    queryClient.setQueryData(getGetPayoutProfileQueryKey(), profile);
    await queryClient.invalidateQueries({ queryKey: getGetMyBalanceQueryKey() });
    if (profile.complete) {
      track('payout_profile_completed', {});
    }
  };
}

/** Błędy pól z API (VALIDATION_FAILED) przy polach, inne w komunikacie formularza. */
function applyApiError<T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: readonly Path<T>[],
  caught: unknown,
  fallback: (error: unknown) => string,
): string | undefined {
  const errors = isApiError(caught) ? (caught.problem?.errors ?? []) : [];
  const known = errors.filter((item) => (fields as readonly string[]).includes(item.path));
  for (const item of known) {
    form.setError(item.path as Path<T>, { message: item.message });
  }
  return known.length === 0 ? fallback(caught) : undefined;
}

type PersonalValues = z.output<ReturnType<typeof personalDataSchema>>;
type BankValues = z.output<ReturnType<typeof bankAccountSchema>>;

const PERSONAL_FIELDS = [
  'firstName',
  'lastName',
  'birthDate',
  'taxIdKind',
  'taxId',
  'street',
  'postalCode',
  'city',
] as const;

function PersonalDataForm({ profile }: { readonly profile: PayoutProfileDto }) {
  const t = useTranslations('payoutProfile');
  const errorMessage = useErrorMessage();
  const saved = useSaved();
  const save = usePutPersonalData();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const personal = profile.personalData;
  const form = useForm({
    resolver: zodResolver(personalDataSchema(useValidation())),
    defaultValues: {
      firstName: personal?.firstName ?? '',
      lastName: personal?.lastName ?? '',
      birthDate: personal?.birthDate ?? '',
      taxIdKind: personal?.taxIdKind ?? 'PESEL',
      taxId: '',
      street: personal?.street ?? '',
      postalCode: personal?.postalCode ?? '',
      city: personal?.city ?? '',
    },
  });
  const { errors } = form.formState;
  const kind = useWatch({ control: form.control, name: 'taxIdKind' });

  const submit = async (values: PersonalValues) => {
    setError(undefined);
    setDone(false);
    try {
      const result = await save.mutateAsync({
        data: {
          ...values,
          taxId: normalizeTaxId(values.taxId),
          postalCode: normalizePostalCode(values.postalCode) ?? values.postalCode,
        },
      });
      await saved(result);
      form.reset({ ...form.getValues(), taxId: '' });
      setDone(true);
    } catch (caught) {
      setError(applyApiError(form, PERSONAL_FIELDS, caught, errorMessage));
    }
  };

  return (
    <section aria-labelledby="payout-personal" className="space-y-4">
      <h2 id="payout-personal" className="text-h3">
        {t('personal.title')}
      </h2>
      <AuthForm
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 sm:p-7"
      >
        {error === undefined ? null : (
          <div className="sm:col-span-2">
            <FormAlert>{error}</FormAlert>
          </div>
        )}
        {done ? (
          <p role="status" className="text-body-sm font-semibold text-success sm:col-span-2">
            {t('saved')}
          </p>
        ) : null}
        <TextField
          label={t('personal.firstName')}
          autoComplete="given-name"
          error={errors.firstName?.message}
          {...form.register('firstName')}
        />
        <TextField
          label={t('personal.lastName')}
          autoComplete="family-name"
          error={errors.lastName?.message}
          {...form.register('lastName')}
        />
        <TextField
          label={t('personal.birthDate')}
          type="date"
          autoComplete="bday"
          error={errors.birthDate?.message}
          {...form.register('birthDate')}
        />
        <div className="space-y-2 sm:col-span-2">
          <SegmentedControl
            label={t('personal.taxIdKind')}
            className="max-w-xs"
            options={[
              { value: 'PESEL', label: t('personal.PESEL') },
              { value: 'NIP', label: t('personal.NIP') },
            ]}
            value={kind}
            onValueChange={(value) => {
              form.setValue('taxIdKind', value);
              form.clearErrors('taxId');
            }}
          />
        </div>
        <div className="sm:col-span-2">
          <TextField
            label={t(`personal.${kind}`)}
            hint={
              personal === null
                ? t('personal.peselHint')
                : t('personal.taxIdSaved', { masked: personal.taxIdMasked })
            }
            inputMode="numeric"
            autoComplete="off"
            error={errors.taxId?.message}
            {...form.register('taxId')}
          />
        </div>
        <div className="sm:col-span-2">
          <TextField
            label={t('personal.street')}
            autoComplete="street-address"
            error={errors.street?.message}
            {...form.register('street')}
          />
        </div>
        <TextField
          label={t('personal.postalCode')}
          autoComplete="postal-code"
          inputMode="numeric"
          placeholder="00-000"
          error={errors.postalCode?.message}
          {...form.register('postalCode')}
        />
        <TextField
          label={t('personal.city')}
          autoComplete="address-level2"
          error={errors.city?.message}
          {...form.register('city')}
        />
        <div className="space-y-2">
          <p className="text-label">{t('personal.country')}</p>
          <p className="flex h-12 items-center rounded-md bg-muted px-3.5 text-body font-semibold text-foreground-secondary">
            {t('personal.countryValue')}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? t('personal.pending') : t('personal.submit')}
          </Button>
        </div>
      </AuthForm>
    </section>
  );
}

const BANK_FIELDS = ['iban', 'holderName'] as const;

function BankAccountForm({ profile }: { readonly profile: PayoutProfileDto }) {
  const t = useTranslations('payoutProfile');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const saved = useSaved();
  const save = usePutBankAccount();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const account = profile.bankAccount;
  const form = useForm({
    resolver: zodResolver(bankAccountSchema(useValidation())),
    defaultValues: { iban: '', holderName: account?.holderName ?? '' },
  });
  const { errors } = form.formState;
  const now = useServerNow();
  const holdUntil =
    profile.payoutsBlockedUntil !== null &&
    now !== null &&
    Date.parse(profile.payoutsBlockedUntil) > now
      ? profile.payoutsBlockedUntil
      : null;

  const submit = async (values: BankValues) => {
    setError(undefined);
    setDone(false);
    try {
      const result = await save.mutateAsync({
        data: { iban: normalizeIban(values.iban) ?? values.iban, holderName: values.holderName },
      });
      await saved(result);
      form.reset({ iban: '', holderName: values.holderName });
      setDone(true);
    } catch (caught) {
      setError(applyApiError(form, BANK_FIELDS, caught, errorMessage));
    }
  };

  return (
    <section aria-labelledby="payout-bank" className="space-y-4">
      <h2 id="payout-bank" className="text-h3">
        {t('bank.title')}
      </h2>
      <AuthForm
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="grid gap-5 rounded-xl border border-border bg-card p-5 sm:p-7"
      >
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        {done ? (
          <p role="status" className="text-body-sm font-semibold text-success">
            {t('saved')}
          </p>
        ) : null}
        {account === null ? null : (
          <p className="text-body-sm text-foreground-secondary">
            {t('bank.current', { account: account.masked, holder: account.holderName })}
            {holdUntil === null
              ? null
              : ` ${t('bank.hold', {
                  date: format.dateTime(new Date(holdUntil), {
                    day: 'numeric',
                    month: 'long',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}`}
          </p>
        )}
        <TextField
          label={t('bank.iban')}
          hint={t('bank.ibanHint')}
          inputMode="numeric"
          autoComplete="off"
          placeholder="PL00 0000 0000 0000 0000 0000 0000"
          error={errors.iban?.message}
          {...form.register('iban', {
            onBlur: (event: { target: { value: string } }) => {
              const iban = normalizeIban(event.target.value);
              if (iban !== undefined) {
                form.setValue('iban', formatIban(iban));
              }
            },
          })}
        />
        <TextField
          label={t('bank.holderName')}
          autoComplete="name"
          error={errors.holderName?.message}
          {...form.register('holderName')}
        />
        {account === null ? null : (
          <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-body-sm">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700" />
            {t('bank.changeWarning')}
          </p>
        )}
        <div>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? t('bank.pending') : t('bank.submit')}
          </Button>
        </div>
      </AuthForm>
    </section>
  );
}
