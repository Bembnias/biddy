'use client';

// Kroki 1–5 kreatora aukcji (F-14): pola formularza react-hook-form (FormProvider w ListingWizard).
// Reguły i komunikaty błędów pochodzą z `validateListing` (@biddy/shared), tak samo jak w API.
import type { CarrierDto, CategorySchemaDto, ListingDto } from '@biddy/api-client';
import {
  AUCTION_DURATIONS_DAYS,
  formatMoney,
  ITEM_CONDITIONS,
  LISTING_RULES,
  money,
  PACKAGE_SIZES,
} from '@biddy/shared';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { Controller, get, useFormContext, useWatch } from 'react-hook-form';

import { TextField } from '@/components/auth/form-parts';
import { AttributeFields } from '@/components/catalog/attribute-fields';
import { CategoryPicker } from '@/components/catalog/category-picker';
import { PhotoUploader } from '@/components/media/photo-uploader';
import { TotalPrice } from '@/components/pricing/total-price';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { type ListingFormValues, parsePrice } from '@/lib/listing/form';

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
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
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
    <div className="space-y-4">
      <p className="text-muted-foreground">{t('text')}</p>
      {minPhotos > 1 ? (
        <p className="text-sm font-medium">{t('brandSensitive', { min: minPhotos })}</p>
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
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          {t('notice', { notice: schema.listingNotice })}
        </p>
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

function Counter({
  id,
  value,
  max,
}: {
  readonly id: string;
  readonly value: string;
  readonly max: number;
}) {
  const t = useTranslations('listing.details');
  const count = [...value.trim()].length;
  return (
    <p
      id={id}
      className={count > max ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
    >
      {t('counter', { count, max })}
    </p>
  );
}

export function DetailsStep() {
  const t = useTranslations('listing.details');
  const { control, register } = useFormContext<ListingFormValues>();
  const title = useWatch({ control, name: 'title' });
  const description = useWatch({ control, name: 'description' });
  const titleError = useFieldError('title');
  const descriptionError = useFieldError('description');
  const conditionError = useFieldError('condition');
  const ids = { description: useId(), condition: useId() };
  const titleCounterId = useId();
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <TextField
          label={t('titleLabel')}
          hint={t('titleHint', { min: LISTING_RULES.titleMin, max: LISTING_RULES.titleMax })}
          error={titleError}
          autoComplete="off"
          {...register('title')}
        />
        <Counter id={titleCounterId} value={title} max={LISTING_RULES.titleMax} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.description}>{t('description')}</Label>
        <Textarea
          id={ids.description}
          rows={8}
          aria-invalid={descriptionError === undefined ? undefined : true}
          aria-describedby={`${ids.description}-hint ${ids.description}-counter${descriptionError === undefined ? '' : ` ${ids.description}-error`}`}
          {...register('description')}
        />
        <p id={`${ids.description}-hint`} className="text-sm text-muted-foreground">
          {t('descriptionHint', {
            min: LISTING_RULES.descriptionMin,
            max: LISTING_RULES.descriptionMax,
          })}
        </p>
        <Counter
          id={`${ids.description}-counter`}
          value={description}
          max={LISTING_RULES.descriptionMax}
        />
        <FieldError id={`${ids.description}-error`} message={descriptionError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={ids.condition}>{t('condition')}</Label>
        <NativeSelect
          id={ids.condition}
          aria-invalid={conditionError === undefined ? undefined : true}
          aria-describedby={conditionError === undefined ? undefined : `${ids.condition}-error`}
          {...register('condition')}
        >
          <option value="">{t('chooseCondition')}</option>
          {ITEM_CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {t(`conditions.${condition}`)}
            </option>
          ))}
        </NativeSelect>
        <FieldError id={`${ids.condition}-error`} message={conditionError} />
      </div>
    </div>
  );
}

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
    <div className="space-y-6">
      <fieldset
        className="space-y-3"
        aria-describedby={sizeError === undefined ? undefined : `${baseId}-size-error`}
      >
        <legend className="mb-2 font-medium">{t('size')}</legend>
        {PACKAGE_SIZES.map((option) => (
          <label key={option} className="flex items-center gap-3">
            <input
              type="radio"
              value={option}
              className="size-4 accent-primary"
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
            />
            <span>{t(`sizes.${option}`)}</span>
          </label>
        ))}
        <FieldError id={`${baseId}-size-error`} message={sizeError} />
      </fieldset>

      {size === 'XL' ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-medium sm:col-span-2">{t('dimensions')}</legend>
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
        <legend className="mb-1 font-medium">{t('carriers')}</legend>
        <p id={`${baseId}-carriers-hint`} className="text-sm text-muted-foreground">
          {t('carriersHint')}
        </p>
        {carriersError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
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
            <ul className="space-y-2">
              {(carriers ?? []).map((carrier) => {
                const id = `${baseId}-${carrier.id}`;
                const enabled = supports(carrier, size);
                return (
                  <li key={carrier.id} className="flex items-center gap-3">
                    <Checkbox
                      id={id}
                      checked={field.value.includes(carrier.id)}
                      disabled={!enabled}
                      aria-invalid={carriersFieldError === undefined ? undefined : true}
                      onCheckedChange={(checked) => {
                        field.onChange(
                          checked === true
                            ? [...field.value, carrier.id]
                            : field.value.filter((value) => value !== carrier.id),
                        );
                      }}
                    />
                    <Label htmlFor={id} className={enabled ? undefined : 'text-muted-foreground'}>
                      {enabled
                        ? `${carrier.name} (${t(`kinds.${carrier.kind}`)})`
                        : t('unsupported', { name: carrier.name, size })}
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

export function PricingStep({
  maxAuctionValue,
  durationLocked,
}: {
  readonly maxAuctionValue: number | null | undefined;
  readonly durationLocked: boolean;
}) {
  const t = useTranslations('listing.pricing');
  const { control, register } = useFormContext<ListingFormValues>();
  const startPrice = parsePrice(useWatch({ control, name: 'startPrice' }));
  const errors = {
    startPrice: useFieldError('startPrice'),
    reservePrice: useFieldError('reservePrice'),
    buyNowPrice: useFieldError('buyNowPrice'),
    durationDays: useFieldError('durationDays'),
  };
  const durationId = useId();
  return (
    <div className="space-y-6">
      <TextField
        label={t('startPrice')}
        hint={t('startPriceHint')}
        inputMode="decimal"
        autoComplete="off"
        error={errors.startPrice}
        {...register('startPrice')}
      />
      <fieldset
        className="space-y-2"
        disabled={durationLocked}
        aria-describedby={
          errors.durationDays === undefined
            ? durationLocked
              ? `${durationId}-locked`
              : undefined
            : `${durationId}-error`
        }
      >
        <legend className="mb-2 font-medium">{t('duration')}</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {AUCTION_DURATIONS_DAYS.map((days) => (
            <label key={days} className="flex items-center gap-2">
              <input
                type="radio"
                value={String(days)}
                className="size-4 accent-primary"
                {...register('durationDays')}
              />
              {t('days', { count: days })}
            </label>
          ))}
        </div>
        {durationLocked ? (
          <p id={`${durationId}-locked`} className="text-sm text-muted-foreground">
            {t('durationLocked')}
          </p>
        ) : null}
        <FieldError id={`${durationId}-error`} message={errors.durationDays} />
      </fieldset>
      <TextField
        label={t('reservePrice')}
        hint={t('reservePriceHint')}
        inputMode="decimal"
        autoComplete="off"
        error={errors.reservePrice}
        {...register('reservePrice')}
      />
      <TextField
        label={t('buyNowPrice')}
        hint={t('buyNowPriceHint')}
        inputMode="decimal"
        autoComplete="off"
        error={errors.buyNowPrice}
        {...register('buyNowPrice')}
      />
      {maxAuctionValue === null || maxAuctionValue === undefined ? null : (
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          {t('limit', { value: zl(maxAuctionValue) })}
        </p>
      )}
      {typeof startPrice === 'number' && startPrice >= LISTING_RULES.minStartPrice ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('buyerPays')}</p>
          <TotalPrice amount={money(startPrice)} />
        </div>
      ) : null}
    </div>
  );
}
