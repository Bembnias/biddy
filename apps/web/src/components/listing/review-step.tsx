'use client';

// Krok 6 kreatora (F-14): podsumowanie, lista braków z linkami do kroków, informacja
// o weryfikacji tożsamości przed pierwszą publikacją i publikacja (albo zapis zmian aukcji).
import type {
  CarrierDto,
  CategorySchemaDto,
  ListingDto,
  SellingLimitsDto,
} from '@biddy/api-client';
import { formatMoney, type ListingIssue, money } from '@biddy/shared';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  LISTING_STEPS,
  type ListingFormValues,
  type ListingStepId,
  parsePrice,
  stepOfPath,
} from '@/lib/listing/form';
import { routes, withNext } from '@/lib/routes';

const zl = (amount: number) => formatMoney(money(amount));

export function ReviewStep({
  listing,
  issues,
  schema,
  carriers,
  limits,
  phoneVerified,
  kycAccepted,
  onKycAcceptedChange,
  kycError,
  busy,
  alert,
  onSubmit,
  stepHref,
  returnTo,
}: {
  readonly listing: ListingDto;
  /** Braki (z kreatora albo z odpowiedzi API) na ścieżkach formularza. */
  readonly issues: readonly ListingIssue[];
  readonly schema: CategorySchemaDto | undefined;
  readonly carriers: readonly CarrierDto[] | undefined;
  readonly limits: SellingLimitsDto | undefined;
  readonly phoneVerified: boolean;
  readonly kycAccepted: boolean;
  readonly onKycAcceptedChange: (accepted: boolean) => void;
  readonly kycError: string | undefined;
  readonly busy: boolean;
  readonly alert: string | undefined;
  readonly onSubmit: () => void;
  readonly stepHref: (step: ListingStepId) => string;
  readonly returnTo: string;
}) {
  const t = useTranslations('listing.review');
  const steps = useTranslations('listing.wizard.steps');
  const details = useTranslations('listing.details');
  const pricing = useTranslations('listing.pricing');
  const { control } = useFormContext<ListingFormValues>();
  const values = useWatch({ control });
  const kycId = useId();
  const draft = listing.status === 'DRAFT';
  const needsKycNotice = draft && limits !== undefined && !limits.kycNoticeAccepted;

  const price = (text: string | undefined) => {
    const parsed = parsePrice(text ?? '');
    return typeof parsed === 'number' ? zl(parsed) : t('none');
  };
  const carrierNames = (values.allowedCarriers ?? [])
    .map((id) => carriers?.find((carrier) => carrier.id === id)?.name ?? id)
    .join(', ');
  const grouped = LISTING_STEPS.map((step) => ({
    step: step.id,
    issues: issues.filter(
      (issue) => stepOfPath(issue.path) === step.id && issue.path !== 'kycNoticeAccepted',
    ),
  })).filter((group) => group.issues.length > 0);

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-body">
        <dt className="text-foreground-secondary">{steps('zdjecia')}</dt>
        <dd>{t('photos', { count: values.mediaIds?.length ?? 0 })}</dd>
        <dt className="text-foreground-secondary">{t('category')}</dt>
        <dd>{schema?.name ?? t('none')}</dd>
        <dt className="text-foreground-secondary">{t('condition')}</dt>
        <dd>
          {values.condition === undefined || values.condition === ''
            ? t('none')
            : details(`conditions.${values.condition as 'NEW'}`)}
        </dd>
        <dt className="text-foreground-secondary">{t('package')}</dt>
        <dd>
          {values.packageSize === undefined || values.packageSize === ''
            ? t('none')
            : values.packageSize}
        </dd>
        <dt className="text-foreground-secondary">{t('carriers')}</dt>
        <dd>{carrierNames === '' ? t('none') : carrierNames}</dd>
        <dt className="text-foreground-secondary">{t('startPrice')}</dt>
        <dd>{price(values.startPrice)}</dd>
        <dt className="text-foreground-secondary">{t('reservePrice')}</dt>
        <dd>{price(values.reservePrice)}</dd>
        <dt className="text-foreground-secondary">{t('buyNowPrice')}</dt>
        <dd>{price(values.buyNowPrice)}</dd>
        <dt className="text-foreground-secondary">{t('duration')}</dt>
        <dd>
          {values.durationDays === undefined || values.durationDays === ''
            ? t('none')
            : pricing('days', { count: Number(values.durationDays) })}
        </dd>
      </dl>
      {values.title === undefined || values.title.trim() === '' ? null : (
        <p className="text-h3">{values.title}</p>
      )}

      {grouped.length > 0 ? (
        <div className="space-y-3 rounded-lg bg-destructive-soft p-4">
          <h3 className="text-label">{t('missing')}</h3>
          {grouped.map((group) => (
            <div key={group.step} className="space-y-1">
              <Link
                href={stepHref(group.step)}
                className="text-label text-link underline-offset-3 hover:text-link-hover hover:underline"
              >
                {t('goTo', { step: steps(group.step) })}
              </Link>
              <ul className="list-disc space-y-1 ps-5 text-body-sm">
                {group.issues.map((issue) => (
                  <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-body-sm font-semibold text-success">
          <CircleCheck aria-hidden className="size-4.5 shrink-0" />
          {t('ready')}
        </p>
      )}

      {schema?.isRestricted === true ? (
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-body-sm">{t('restricted')}</p>
      ) : null}

      {needsKycNotice ? (
        <div className="space-y-3 rounded-lg border border-border bg-canvas p-4">
          <h3 className="text-label">{t('kycTitle')}</h3>
          <p className="text-body-sm">{t('kycText', { value: zl(limits.kycRequiredAbove) })}</p>
          <div className="flex items-start gap-3">
            <Checkbox
              id={kycId}
              checked={kycAccepted}
              aria-invalid={kycError === undefined ? undefined : true}
              aria-describedby={kycError === undefined ? undefined : `${kycId}-error`}
              onCheckedChange={(checked) => {
                onKycAcceptedChange(checked === true);
              }}
            />
            <Label htmlFor={kycId} className="block text-body leading-snug font-normal">
              {t('kycAccept')}
            </Label>
          </div>
          {kycError === undefined ? null : (
            <p id={`${kycId}-error`} className="text-body-sm text-destructive">
              {kycError}
            </p>
          )}
        </div>
      ) : null}

      {alert === undefined ? null : (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {alert}
        </p>
      )}

      {draft && !phoneVerified ? (
        <div className="space-y-3 rounded-lg bg-warning-soft p-4">
          <h3 className="text-label">{t('phoneTitle')}</h3>
          <p className="text-body-sm">{t('phoneText')}</p>
          <Button asChild>
            <Link href={withNext(routes.verifyPhone, returnTo)}>{t('phoneAction')}</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-body-sm text-muted-foreground">
            {t('terms')}{' '}
            <Link
              href={routes.prohibitedItems}
              className="font-semibold text-link underline underline-offset-3 hover:text-link-hover"
            >
              {t('prohibitedItems')}
            </Link>
          </p>
          <Button
            type="button"
            variant="cta"
            size="lg"
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={onSubmit}
          >
            {draft
              ? busy
                ? t('publishing')
                : t('publish')
              : busy
                ? t('savingChanges')
                : t('saveChanges')}
          </Button>
        </div>
      )}
    </div>
  );
}
