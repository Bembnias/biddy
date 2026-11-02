'use client';

// Kroki 1–5 kreatora aukcji (F-14, układ F-63): pola formularza react-hook-form (FormProvider
// w ListingWizard). Reguły i komunikaty błędów pochodzą z `validateListing` (@biddy/shared), tak
// samo jak w API.
import type { CarrierDto, CategorySchemaDto, ListingDto } from '@biddy/api-client';
import {
  AUCTION_DURATIONS_DAYS,
  formatMoney,
  ITEM_CONDITIONS,
  LISTING_RULES,
  money,
  PACKAGE_SIZES,
} from '@biddy/shared';
import { CalendarClock, CircleCheck, Info, Package, TriangleAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { Controller, get, useFormContext, useWatch } from 'react-hook-form';

import { TextField } from '@/components/auth/form-parts';
import { useServerNow } from '@/components/auction/use-auction';
import { AttributeFields } from '@/components/catalog/attribute-fields';
import { CategoryPicker } from '@/components/catalog/category-picker';
import { PhotoUploader } from '@/components/media/photo-uploader';
import { TotalPrice } from '@/components/pricing/total-price';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { type ListingFormValues, parsePrice } from '@/lib/listing/form';
import { cn } from '@/lib/utils';

function useFieldError(name: string): string | undefined {
  const { formState } = useFormContext<ListingFormValues>();
  return (get(formState.errors, name) as { message?: string } | undefined)?.message;
}

function FieldError({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}) {
  return message === undefined ? null : (
    <p id={id} className="text-body-sm font-semibold text-destructive">
      {message}
    </p>
  );
}

/** Ramka z zasadą albo ostrzeżeniem kroku (np. więcej zdjęć w kategorii narażonej na podróbki). */
function Notice({
  tone,
  children,
}: {
  readonly tone: 'warning' | 'info';
  readonly children: ReactNode;
}) {
  const Icon = tone === 'warning' ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-xl border px-4 py-3.5 text-body-sm',
        tone === 'warning' ? 'border-amber-200 bg-warning-soft' : 'border-sky-200 bg-info-soft',
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 size-4.5 shrink-0',
          tone === 'warning' ? 'text-amber-700' : 'text-sky-700',
        )}
      />
      <p>{children}</p>
    </div>
  );
}

/**
 * Karta wyboru (stan, gabaryt): przezroczyste pole radio na całej karcie (kliknięcie trafia
 * w pole), zaznaczenie ramką marki i ikoną.
 */
function ChoiceCard({
  className,
  children,
  ...inputProps
}: ComponentProps<'input'> & { readonly children: ReactNode }) {
  return (
    <label
      className={cn(
        'group relative flex cursor-pointer rounded-xl border border-border-strong bg-card transition-[border-color,box-shadow,background-color] duration-150 hover:border-violet-300 has-[:checked]:border-brand has-[:checked]:bg-violet-50 has-[:checked]:ring-1 has-[:checked]:ring-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
        className,
      )}
    >
      <input
        type="radio"
        className="absolute inset-0 size-full cursor-pointer appearance-none rounded-xl opacity-0 disabled:cursor-not-allowed"
        {...inputProps}
      />
      {children}
    </label>
  );
}

const zl = (amount: number) =>
  formatMoney(money(amount), { trailingZeroDisplay: 'stripIfInteger' });

export function PhotosStep({
  listing,
  minPhotos,
}: {
  readonly listing: ListingDto;
  readonly minPhotos: number;
}) {
  const t = useTranslations('listing.photos');
  const { setValue } = useFormContext<ListingFormValues>();
  const error = useFieldError('mediaIds');
  const errorId = useId();
  const initial = listing.photos.flatMap((photo) =>
    photo.status === 'READY' && photo.urls !== null
      ? [{ id: photo.id, thumbUrl: photo.urls.thumb }]
      : [],
  );
  return (
    <div className="space-y-5">
      <p className="text-body text-foreground-secondary">{t('text')}</p>
      {minPhotos > 1 ? (
        <Notice tone="warning">{t('brandSensitive', { min: minPhotos })}</Notice>
      ) : null}
      <PhotoUploader
        initial={initial}
        deleteOnRemove={false}
        describedBy={error === undefined ? undefined : errorId}
        onChange={(mediaIds) => {
          setValue('mediaIds', mediaIds, { shouldDirty: true });
        }}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function CategoryStep({ schema }: { readonly schema: CategorySchemaDto | undefined }) {
  const t = useTranslations('listing.category');
  const { control, getValues, register, setValue } = useFormContext<ListingFormValues>();
  const categoryId = useWatch({ control, name: 'categoryId' });
  const categoryError = useFieldError('categoryId');
  const brandError = useFieldError('brand');
  return (
    <div className="space-y-6">
      <CategoryPicker
        value={categoryId === '' ? undefined : categoryId}
        error={categoryError}
        onChange={(category) => {
          const next = category?.id ?? '';
          if (next !== getValues('categoryId')) {
            setValue('categoryId', next, { shouldDirty: true });
            setValue('attributes', {}, { shouldDirty: true });
          }
        }}
      />
      {schema?.listingNotice === null || schema === undefined ? null : (
        <Notice tone="warning">
          {t.rich('notice', {
            notice: schema.listingNotice,
            strong: (chunks) => <strong className="font-extrabold">{chunks}</strong>,
          })}
        </Notice>
      )}
      {schema === undefined ? null : (
        <AttributeFields key={schema.id} definitions={schema.attributes} />
      )}
      <TextField
        label={schema?.isBrandSensitive === true ? t('brandRequired') : t('brand')}
        hint={t('brandHint')}
        error={brandError}
        autoComplete="off"
        {...register('brand')}
      />
    </div>
  );
}

/** Podpowiedź pola z licznikiem znaków po prawej (F-63). */
function HintWithCounter({
  hintId,
  counterId,
  hint,
  value,
  max,
}: {
  readonly hintId: string;
  readonly counterId: string;
  readonly hint: string;
  readonly value: string;
  readonly max: number;
}) {
  const t = useTranslations('listing.details');
  const count = [...value.trim()].length;
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <p id={hintId} className="text-body-sm text-muted-foreground">
        {hint}
      </p>
      <p
        id={counterId}
        className={cn(
          'text-body-sm tabular-nums',
          count > max ? 'font-semibold text-destructive' : 'text-muted-foreground',
        )}
      >
        {t('counter', { count, max })}
      </p>
    </div>
  );
}

export function DetailsStep() {
  const t = useTranslations('listing.details');
  const { control, register } = useFormContext<ListingFormValues>();
  const title = useWatch({ control, name: 'title' });
  const description = useWatch({ control, name: 'description' });
  const errors = {
    title: useFieldError('title'),
    description: useFieldError('description'),
    condition: useFieldError('condition'),
  };
  const ids = { title: useId(), description: useId(), condition: useId() };
  const describedBy = (id: string, error: string | undefined) =>
    `${id}-hint ${id}-counter${error === undefined ? '' : ` ${id}-error`}`;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={ids.title}>{t('titleLabel')}</Label>
        <Input
          id={ids.title}
          autoComplete="off"
          aria-invalid={errors.title === undefined ? undefined : true}
          aria-describedby={describedBy(ids.title, errors.title)}
          {...register('title')}
        />
        <HintWithCounter
          hintId={`${ids.title}-hint`}
          counterId={`${ids.title}-counter`}
          hint={t('titleHint', { min: LISTING_RULES.titleMin, max: LISTING_RULES.titleMax })}
          value={title}
          max={LISTING_RULES.titleMax}
        />
        <FieldError id={`${ids.title}-error`} message={errors.title} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.description}>{t('description')}</Label>
        <Textarea
          id={ids.description}
          rows={7}
          aria-invalid={errors.description === undefined ? undefined : true}
          aria-describedby={describedBy(ids.description, errors.description)}
          {...register('description')}
        />
        <HintWithCounter
          hintId={`${ids.description}-hint`}
          counterId={`${ids.description}-counter`}
          hint={t('descriptionHint', {
            min: LISTING_RULES.descriptionMin,
            max: LISTING_RULES.descriptionMax,
          })}
          value={description}
          max={LISTING_RULES.descriptionMax}
        />
        <FieldError id={`${ids.description}-error`} message={errors.description} />
      </div>
      <fieldset
        className="space-y-3"
        aria-describedby={errors.condition === undefined ? undefined : `${ids.condition}-error`}
      >
        <legend className="mb-3 text-label">{t('condition')}</legend>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {ITEM_CONDITIONS.map((condition) => (
            <ChoiceCard
              key={condition}
              value={condition}
              className="flex-col gap-0.5 px-4 py-3.5"
              aria-invalid={errors.condition === undefined ? undefined : true}
              {...register('condition')}
            >
              <span className="flex items-start justify-between gap-2 text-title group-has-[:checked]:font-extrabold group-has-[:checked]:text-violet-800">
                {t(`conditionCards.${condition}`)}
                <CircleCheck
                  aria-hidden
                  className="mt-0.5 hidden size-4.5 shrink-0 text-brand group-has-[:checked]:block"
                />
              </span>{' '}
              <span className="text-body-sm text-muted-foreground">
                {t(`conditionHints.${condition}`)}
              </span>
            </ChoiceCard>
          ))}
        </div>
        <FieldError id={`${ids.condition}-error`} message={errors.condition} />
      </fieldset>
    </div>
  );
}

/** Pierwsza litera nazwy przewoźnika w kafelku w tonie rodzaju usługi. */
const CARRIER_TONES: Readonly<Record<CarrierDto['kind'], ComponentProps<typeof IconTile>['tone']>> =
  {
    LOCKER: 'warning',
    PICKUP_POINT: 'danger',
    COURIER: 'info',
  };

export function ShippingStep({
  carriers,
  carriersError,
  onRetry,
}: {
  readonly carriers: readonly CarrierDto[] | undefined;
  readonly carriersError: boolean;
  readonly onRetry: () => void;
}) {
  const t = useTranslations('listing.shipping');
  const { control, register, getValues, setValue } = useFormContext<ListingFormValues>();
  const size = useWatch({ control, name: 'packageSize' });
  const sizeError = useFieldError('packageSize');
  const carriersFieldError = useFieldError('allowedCarriers');
  const errors = {
    weightKg: useFieldError('weightKg'),
    lengthCm: useFieldError('lengthCm'),
    widthCm: useFieldError('widthCm'),
    heightCm: useFieldError('heightCm'),
  };
  const baseId = useId();
  const supports = (carrier: CarrierDto, packageSize: string) =>
    packageSize === '' || (carrier.packageSizes as readonly string[]).includes(packageSize);

  return (
    <div className="space-y-7">
      <fieldset
        className="space-y-3"
        aria-describedby={sizeError === undefined ? undefined : `${baseId}-size-error`}
      >
        <legend className="mb-3 text-label">{t('size')}</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PACKAGE_SIZES.map((option) => (
            <ChoiceCard
              key={option}
              value={option}
              className="flex-col items-center gap-1.5 px-3 py-4.5 text-center"
              aria-invalid={sizeError === undefined ? undefined : true}
              {...register('packageSize', {
                onChange: (event: { target: { value: string } }) => {
                  // Przewoźnicy bez obsługi nowego gabarytu znikają z wyboru.
                  const next = event.target.value;
                  setValue(
                    'allowedCarriers',
                    getValues('allowedCarriers').filter((id) => {
                      const carrier = carriers?.find((candidate) => candidate.id === id);
                      return carrier === undefined || supports(carrier, next);
                    }),
                    { shouldDirty: true },
                  );
                },
              })}
            >
              <Package
                aria-hidden
                className="size-6 text-foreground-secondary group-has-[:checked]:text-brand"
              />
              <span className="text-h3 group-has-[:checked]:text-violet-800">{option}</span>{' '}
              <span className="text-body-sm text-muted-foreground">{t(`sizeHints.${option}`)}</span>
            </ChoiceCard>
          ))}
        </div>
        <FieldError id={`${baseId}-size-error`} message={sizeError} />
      </fieldset>

      {size === 'XL' ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-label sm:col-span-2">{t('dimensions')}</legend>
          <TextField
            label={t('length')}
            inputMode="numeric"
            error={errors.lengthCm}
            {...register('lengthCm')}
          />
          <TextField
            label={t('width')}
            inputMode="numeric"
            error={errors.widthCm}
            {...register('widthCm')}
          />
          <TextField
            label={t('height')}
            inputMode="numeric"
            error={errors.heightCm}
            {...register('heightCm')}
          />
          <TextField
            label={t('weight')}
            inputMode="decimal"
            error={errors.weightKg}
            {...register('weightKg')}
          />
        </fieldset>
      ) : null}

      <fieldset
        className="space-y-3"
        aria-describedby={`${baseId}-carriers-hint${carriersFieldError === undefined ? '' : ` ${baseId}-carriers-error`}`}
      >
        <legend className="mb-1 text-label">{t('carriers')}</legend>
        <p id={`${baseId}-carriers-hint`} className="text-body-sm text-muted-foreground">
          {t('carriersHint')}
        </p>
        {carriersError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
          >
            {t('loadError')}
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t('retry')}
            </Button>
          </div>
        ) : null}
        <Controller
          control={control}
          name="allowedCarriers"
          render={({ field }) => (
            <ul className="space-y-2.5">
              {(carriers ?? []).map((carrier) => {
                const id = `${baseId}-${carrier.id}`;
                const enabled = supports(carrier, size);
                const checked = field.value.includes(carrier.id);
                return (
                  <li
                    key={carrier.id}
                    className={cn(
                      'flex items-center gap-3.5 rounded-xl border border-border-strong bg-card px-4 py-3 transition-[border-color,box-shadow] duration-150 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
                      checked && 'border-brand ring-1 ring-brand',
                      !enabled && 'bg-muted',
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={!enabled}
                      aria-invalid={carriersFieldError === undefined ? undefined : true}
                      onCheckedChange={(next) => {
                        field.onChange(
                          next === true
                            ? [...field.value, carrier.id]
                            : field.value.filter((value) => value !== carrier.id),
                        );
                      }}
                    />
                    <Label
                      htmlFor={id}
                      className={cn(
                        'flex flex-1 cursor-pointer items-center gap-3.5 font-normal',
                        !enabled && 'cursor-not-allowed',
                      )}
                    >
                      <IconTile tone={enabled ? CARRIER_TONES[carrier.kind] : 'neutral'}>
                        {carrier.name.charAt(0)}
                      </IconTile>
                      <span className="flex min-w-0 flex-col">
                        <span className={cn('text-title', !enabled && 'text-foreground-secondary')}>
                          {carrier.name}
                        </span>{' '}
                        <span className="text-body-sm text-muted-foreground">
                          {enabled ? t(`kinds.${carrier.kind}`) : t('unsupportedSize', { size })}
                        </span>
                      </span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
        />
        <FieldError id={`${baseId}-carriers-error`} message={carriersFieldError} />
      </fieldset>
    </div>
  );
}

/** Kwota w złotych z sufiksem „zł” w polu (F-63). */
function PriceField({
  label,
  hint,
  error,
  narrow = false,
  ...inputProps
}: ComponentProps<typeof Input> & {
  readonly label: string;
  readonly hint: string;
  readonly error: string | undefined;
  readonly narrow?: boolean;
}) {
  const t = useTranslations('listing.pricing');
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className={cn('relative', narrow && 'sm:max-w-70')}>
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className="pr-12 tabular-nums"
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={`${id}-hint${error === undefined ? '' : ` ${id}-error`}`}
          {...inputProps}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-3 right-3.5 text-title text-foreground-secondary"
        >
          {t('currency')}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">
        {hint}
      </p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function PricingStep({
  maxAuctionValue,
  durationLocked,
  endsAt,
}: {
  readonly maxAuctionValue: number | null | undefined;
  readonly durationLocked: boolean;
  /** Koniec opublikowanej aukcji; dla szkicu liczony od teraz. */
  readonly endsAt: string | null;
}) {
  const t = useTranslations('listing.pricing');
  const format = useFormatter();
  const now = useServerNow();
  const { control, register } = useFormContext<ListingFormValues>();
  const startPrice = parsePrice(useWatch({ control, name: 'startPrice' }));
  const durationDays = Number(useWatch({ control, name: 'durationDays' }));
  const errors = {
    startPrice: useFieldError('startPrice'),
    reservePrice: useFieldError('reservePrice'),
    buyNowPrice: useFieldError('buyNowPrice'),
    durationDays: useFieldError('durationDays'),
  };
  const durationId = useId();
  // Przed hydracją zegara (i w testach bez niego) bez daty końca szkicu.
  const end = durationLocked
    ? endsAt === null
      ? undefined
      : new Date(endsAt)
    : now === null || !Number.isInteger(durationDays) || durationDays <= 0
      ? undefined
      : new Date(now + durationDays * 24 * 60 * 60 * 1_000);
  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <PriceField
          label={t('startPrice')}
          hint={t('startPriceHint')}
          error={errors.startPrice}
          narrow
          {...register('startPrice')}
        />
        {typeof startPrice === 'number' && startPrice >= LISTING_RULES.minStartPrice ? (
          <div className="space-y-1 rounded-lg bg-canvas px-3.5 py-3">
            <p className="text-label">{t('buyerPays')}</p>
            <TotalPrice amount={money(startPrice)} />
          </div>
        ) : null}
      </div>
      <fieldset
        className="space-y-3"
        disabled={durationLocked}
        aria-describedby={
          errors.durationDays === undefined
            ? durationLocked
              ? `${durationId}-locked`
              : undefined
            : `${durationId}-error`
        }
      >
        <legend className="mb-3 text-label">{t('duration')}</legend>
        <div className="flex flex-wrap gap-2">
          {AUCTION_DURATIONS_DAYS.map((days) => (
            <label
              key={days}
              className="relative inline-flex h-11 min-w-21 cursor-pointer items-center justify-center rounded-full border border-border-strong bg-card px-4 text-label font-bold transition-colors duration-150 hover:bg-canvas has-[:checked]:border-brand-strong has-[:checked]:bg-brand-strong has-[:checked]:text-primary-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none"
            >
              <input
                type="radio"
                value={String(days)}
                className="absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
                {...register('durationDays')}
              />
              {t('days', { count: days })}
            </label>
          ))}
        </div>
        {end === undefined ? null : (
          <p className="flex items-center gap-2 text-body-sm font-semibold text-foreground-secondary">
            <CalendarClock aria-hidden className="size-4.5 shrink-0" />
            {t(durationLocked ? 'endsAt' : 'endsIfNow', {
              date: format.dateTime(end, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        )}
        {durationLocked ? (
          <p id={`${durationId}-locked`} className="text-body-sm text-muted-foreground">
            {t('durationLocked')}
          </p>
        ) : null}
        <FieldError id={`${durationId}-error`} message={errors.durationDays} />
      </fieldset>
      <div className="grid gap-5 border-t border-border pt-6 sm:grid-cols-2">
        <PriceField
          label={t('reservePrice')}
          hint={t('reservePriceHint')}
          error={errors.reservePrice}
          {...register('reservePrice')}
        />
        <PriceField
          label={t('buyNowPrice')}
          hint={t('buyNowPriceHint')}
          error={errors.buyNowPrice}
          {...register('buyNowPrice')}
        />
      </div>
      {maxAuctionValue === null || maxAuctionValue === undefined ? null : (
        <Notice tone="info">{t('limit', { value: zl(maxAuctionValue) })}</Notice>
      )}
    </div>
  );
}
