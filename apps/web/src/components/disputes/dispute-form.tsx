'use client';

// Zgłoszenie problemu w oknie 36 h (F-28, PROJECT.md §7.5): powód, opis i zdjęcia (prywatne,
// wymagane przy wadzie przedmiotu). Po wysłaniu zamówienie czeka na rozstrzygnięcie, a strona
// pokazuje spór.
import {
  type OrderDetailsDto,
  getGetOrderDisputeQueryKey,
  getGetOrderQueryKey,
  openDispute,
} from '@biddy/api-client';
import {
  DISPUTE_REASONS,
  DISPUTE_TEXT_LIMITS,
  disputeReasonRequiresPhoto,
  MAX_DISPUTE_PHOTOS,
} from '@biddy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { AuthForm, FieldErrorText, FormAlert, useErrorMessage } from '@/components/auth/form-parts';
import { PhotoUploader } from '@/components/media/photo-uploader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { disputeFormSchema } from '@/lib/disputes/dispute-view';
import { cn } from '@/lib/utils';

type FormValues = z.output<ReturnType<typeof disputeFormSchema>>;

export function DisputeForm({ order }: { readonly order: OrderDetailsDto }) {
  const t = useTranslations('dispute.form');
  const reasons = useTranslations('dispute.reasons');
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const id = useId();
  const [error, setError] = useState<string>();
  const form = useForm({
    resolver: zodResolver(disputeFormSchema((key) => t(`validation.${key}`))),
    defaultValues: { reason: undefined, description: '', mediaIds: [] } as unknown as FormValues,
  });
  const reason = useWatch({ control: form.control, name: 'reason' });
  const description = useWatch({ control: form.control, name: 'description' });
  const { errors, isSubmitting } = form.formState;
  const until = order.actions.openDispute?.until ?? null;

  const submit = async (values: FormValues) => {
    setError(undefined);
    try {
      const dispute = await openDispute(order.publicId, values);
      track('dispute_opened', { reason: values.reason, photos: values.mediaIds.length });
      queryClient.setQueryData(getGetOrderDisputeQueryKey(order.publicId), dispute);
      void queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.publicId) });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-5">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <section className="space-y-5 rounded-2xl border border-border bg-card p-5.5 sm:p-7">
        {until === null ? null : (
          <p className="flex items-start gap-2.5 rounded-lg bg-canvas px-3.5 py-3 text-body-sm text-foreground-secondary">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            {t('lead', {
              date: format.dateTime(new Date(until), {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        )}
        <fieldset
          className="min-w-0 space-y-3"
          aria-describedby={errors.reason === undefined ? undefined : `${id}-reason-error`}
        >
          <legend className="mb-3 text-title">{t('reason')}</legend>
          <Controller
            control={form.control}
            name="reason"
            render={({ field }) => (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {DISPUTE_REASONS.map((option) => (
                  <label
                    key={option}
                    htmlFor={`${id}-${option}`}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border border-border-strong px-4 py-3 text-body transition-[border-color,box-shadow,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
                      field.value === option && 'border-brand bg-violet-50 ring-1 ring-brand',
                    )}
                  >
                    <input
                      id={`${id}-${option}`}
                      type="radio"
                      name={field.name}
                      value={option}
                      checked={field.value === option}
                      onChange={() => {
                        field.onChange(option);
                      }}
                      onBlur={field.onBlur}
                      className="mt-0.5 size-5 shrink-0 accent-brand"
                    />
                    {reasons(option)}
                  </label>
                ))}
              </div>
            )}
          />
          {errors.reason?.message === undefined ? null : (
            <FieldErrorText id={`${id}-reason-error`}>{errors.reason.message}</FieldErrorText>
          )}
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor={`${id}-description`}>{t('description')}</Label>
          <Textarea
            id={`${id}-description`}
            maxLength={DISPUTE_TEXT_LIMITS.description.max}
            aria-invalid={errors.description === undefined ? undefined : true}
            aria-describedby={`${id}-description-hint${errors.description === undefined ? '' : ` ${id}-description-error`}`}
            {...form.register('description')}
          />
          <p
            id={`${id}-description-hint`}
            className="flex justify-between gap-3 text-body-sm text-muted-foreground"
          >
            <span>{t('descriptionHint', { min: DISPUTE_TEXT_LIMITS.description.min })}</span>
            <span className="tabular-nums">
              {description.trim().length}/{DISPUTE_TEXT_LIMITS.description.max}
            </span>
          </p>
          {errors.description?.message === undefined ? null : (
            <FieldErrorText id={`${id}-description-error`}>
              {errors.description.message}
            </FieldErrorText>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-title">{t('photos')}</h2>
          <Controller
            control={form.control}
            name="mediaIds"
            render={({ field }) => (
              <PhotoUploader
                purpose="DISPUTE_EVIDENCE"
                max={MAX_DISPUTE_PHOTOS}
                hint={
                  reason !== undefined && disputeReasonRequiresPhoto(reason)
                    ? t('photosRequiredHint')
                    : t('photosHint')
                }
                {...(errors.mediaIds === undefined ? {} : { describedBy: `${id}-photos-error` })}
                onChange={field.onChange}
              />
            )}
          />
          {errors.mediaIds?.message === undefined ? null : (
            <FieldErrorText id={`${id}-photos-error`}>{errors.mediaIds.message}</FieldErrorText>
          )}
        </div>
        <p className="text-body-sm text-foreground-secondary">{t('info')}</p>
        <div className="flex justify-end">
          <Button type="submit" variant="cta" disabled={isSubmitting}>
            {isSubmitting ? t('submitting') : t('submit')}
          </Button>
        </div>
      </section>
    </AuthForm>
  );
}
