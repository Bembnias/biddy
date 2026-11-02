'use client';

// Krok 6 kreatora (F-14, układ F-63): stan gotowości z listą braków, podsumowanie z miniaturami
// zdjęć i linkami „Zmień” do kroków, informacja o weryfikacji tożsamości przed pierwszą
// publikacją i weryfikacja telefonu. Przycisk publikacji jest w pasku kreatora.
import type {
  CarrierDto,
  CategorySchemaDto,
  ListingDto,
  SellingLimitsDto,
} from '@biddy/api-client';
import { formatMoney, type ListingIssue, money } from '@biddy/shared';
import { CircleAlert, CircleCheck, ShieldCheck, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconTile } from '@/components/ui/icon-tile';
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
const PHOTOS_SHOWN = 4;

/** Komunikat po publikacji albo zapisie zmian: błąd albo potwierdzenie. */
export interface ReviewNotice {
  readonly tone: 'error' | 'success';
  readonly text: string;
}

function ChangeLink({
  href,
  label,
}: {
  readonly href: string;
  /** Czego dotyczy zmiana, dla czytnika ekranu („Zmień: Kategoria”). */
  readonly label: string;
}) {
  const t = useTranslations('listing.review');
  return (
    <Link
      href={href}
      scroll={false}
      className="rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
    >
      {t('change')}
      <span className="sr-only">: {label}</span>
    </Link>
  );
}

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
  notice,
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
  readonly notice: ReviewNotice | undefined;
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
  const orNone = (text: string | undefined) =>
    text === undefined || text.trim() === '' ? t('none') : text;
  const carrierNames = (values.allowedCarriers ?? [])
    .map((id) => carriers?.find((carrier) => carrier.id === id)?.name ?? id)
    .join(', ');
  const mediaIds = values.mediaIds ?? [];
  const photos = mediaIds.flatMap((id) => {
    const url = listing.photos.find((photo) => photo.id === id)?.urls?.thumb;
    return url === undefined ? [] : [{ id, url }];
  });
  const grouped = LISTING_STEPS.map((step) => ({
    step: step.id,
    issues: issues.filter(
      (issue) => stepOfPath(issue.path) === step.id && issue.path !== 'kycNoticeAccepted',
    ),
  })).filter((group) => group.issues.length > 0);

  const rows: readonly { label: string; value: string; step: ListingStepId }[] = [
    { label: steps('zdjecia'), value: t('photos', { count: mediaIds.length }), step: 'zdjecia' },
    {
      label: t('category'),
      value: orNone([schema?.name, values.brand?.trim()].filter(Boolean).join(' · ')),
      step: 'kategoria',
    },
    {
      label: t('condition'),
      value:
        values.condition === undefined || values.condition === ''
          ? t('none')
          : details(`conditions.${values.condition as 'NEW'}`),
      step: 'opis',
    },
    {
      label: t('package'),
      value:
        values.packageSize === undefined || values.packageSize === ''
          ? t('none')
          : [
              values.packageSize,
              values.weightKg?.trim() === '' ? '' : `${values.weightKg ?? ''} kg`,
            ]
              .filter(Boolean)
              .join(' · '),
      step: 'dostawa',
    },
    { label: t('carriers'), value: orNone(carrierNames), step: 'dostawa' },
    { label: t('startPrice'), value: price(values.startPrice), step: 'cena' },
    { label: t('reservePrice'), value: price(values.reservePrice), step: 'cena' },
    { label: t('buyNowPrice'), value: price(values.buyNowPrice), step: 'cena' },
    {
      label: t('duration'),
      value:
        values.durationDays === undefined || values.durationDays === ''
          ? t('none')
          : pricing('days', { count: Number(values.durationDays) }),
      step: 'cena',
    },
  ];
  const title = values.title?.trim() ?? '';

  return (
    <div className="space-y-6">
      {grouped.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-red-200 bg-destructive-soft p-4.5">
          <h3 className="flex items-center gap-2 text-title text-destructive">
            <CircleAlert aria-hidden className="size-4.5 shrink-0" />
            {t('missing')}
          </h3>
          {grouped.map((group) => (
            <div key={group.step} className="space-y-1">
              <Link
                href={stepHref(group.step)}
                scroll={false}
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
        <p className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-success-soft px-4.5 py-3.5 text-title text-success">
          <CircleCheck aria-hidden className="size-5 shrink-0" />
          {t('ready')}
        </p>
      )}

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <p className="min-w-0 text-h3 break-words">{title === '' ? t('noTitle') : title}</p>
          <ChangeLink href={stepHref('opis')} label={t('titleLabel')} />
        </div>
        {photos.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2.5">
            {photos.slice(0, PHOTOS_SHOWN).map((photo, index) => (
              <li key={photo.id}>
                {/* Miniatura WebP z CDN. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={t('photo', { position: index + 1 })}
                  className={
                    index === 0
                      ? 'size-20 rounded-lg object-cover ring-3 ring-brand sm:size-22'
                      : 'size-20 rounded-lg object-cover sm:size-22'
                  }
                />
              </li>
            ))}
            {photos.length > PHOTOS_SHOWN ? (
              <li className="grid size-20 place-items-center rounded-lg bg-muted text-title text-foreground-secondary sm:size-22">
                {t('morePhotos', { count: photos.length - PHOTOS_SHOWN })}
              </li>
            ) : null}
          </ul>
        )}
        <dl className="divide-y divide-ink-100 border-t border-ink-100">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-3.5 sm:flex-nowrap"
            >
              <dt className="w-full text-body-sm text-foreground-secondary sm:w-44 sm:shrink-0">
                {row.label}
              </dt>
              <dd className="min-w-0 flex-1 text-body font-bold break-words">{row.value}</dd>
              <dd className="shrink-0">
                <ChangeLink href={stepHref(row.step)} label={row.label} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {schema?.isRestricted === true ? (
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-body-sm">{t('restricted')}</p>
      ) : null}

      {needsKycNotice ? (
        <section
          aria-labelledby={`${kycId}-title`}
          className="space-y-3 rounded-xl border border-sky-200 bg-info-soft p-5"
        >
          <h3 id={`${kycId}-title`} className="flex items-center gap-2.5 text-title text-sky-800">
            <ShieldCheck aria-hidden className="size-5 shrink-0" />
            {t('kycTitle')}
          </h3>
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
            <Label htmlFor={kycId} className="block text-body leading-snug font-semibold">
              {t('kycAccept')}
            </Label>
          </div>
          {kycError === undefined ? null : (
            // Na niebieskim tle czerwień 700 (czerwień `destructive` ma tu za mały kontrast).
            <p id={`${kycId}-error`} className="text-body-sm font-semibold text-red-700">
              {kycError}
            </p>
          )}
        </section>
      ) : null}

      {draft && !phoneVerified ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-warning-soft p-4.5">
          <IconTile tone="warning">
            <Smartphone />
          </IconTile>
          <div className="min-w-0 flex-[1_1_16rem] space-y-1">
            <h3 className="text-title">{t('phoneTitle')}</h3>
            <p className="text-body-sm text-foreground-secondary">{t('phoneText')}</p>
          </div>
          <Button asChild>
            <Link href={withNext(routes.verifyPhone, returnTo)}>{t('phoneAction')}</Link>
          </Button>
        </div>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          {t('terms')}{' '}
          <Link
            href={routes.prohibitedItems}
            className="font-semibold text-link underline underline-offset-3 hover:text-link-hover"
          >
            {t('prohibitedItems')}
          </Link>
        </p>
      )}

      {notice === undefined ? null : notice.tone === 'error' ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm font-semibold text-destructive"
        >
          {notice.text}
        </p>
      ) : (
        <p
          role="status"
          className="rounded-lg bg-success-soft px-4 py-3 text-body-sm font-semibold text-success"
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
