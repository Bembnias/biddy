'use client';

import {
  type CarrierDto,
  getGetMyPickupPointsQueryKey,
  type SavedPickupPointDto,
  savePickupPoint,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { AuthForm, FormAlert, useErrorMessage } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

import type { MapNear } from './pickup-point-map-button';
import { type ChosenPoint, PickupPointPicker } from './pickup-point-picker';

/**
 * Nowy punkt odbioru w koncie (F-64): usługa, punkt z mapy albo wyszukiwarki i „domyślny dla
 * tej usługi”. Pierwszy punkt usługi jest domyślny automatycznie (tak zapisuje go też API).
 */
export function NewPickupPointForm({
  carriers,
  saved,
  near,
}: {
  /** Usługi z punktami odbioru (bez kuriera). */
  readonly carriers: readonly CarrierDto[];
  readonly saved: readonly SavedPickupPointDto[];
  readonly near: MapNear | undefined;
}) {
  const t = useTranslations('addresses.points.form');
  const kinds = useTranslations('checkout.delivery.kinds');
  const id = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [carrierId, setCarrierId] = useState(carriers[0]?.id ?? '');
  const [point, setPoint] = useState<ChosenPoint | null>(null);
  const [pointError, setPointError] = useState<string>();
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const carrier = carriers.find((candidate) => candidate.id === carrierId);
  const first = !saved.some((candidate) => candidate.carrierId === carrierId);

  const submit = async () => {
    setError(undefined);
    if (carrier === undefined || point === null) {
      setPointError(t('pointRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const isDefault = first || makeDefault;
      await savePickupPoint({ carrierId: carrier.id, pointId: point.id, isDefault });
      track('pickup_point_saved', { carrierId: carrier.id, context: 'account', isDefault });
      await queryClient.invalidateQueries({ queryKey: getGetMyPickupPointsQueryKey() });
      router.push(`${routes.addresses}?punkt=zapisany`);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  };

  return (
    <AuthForm
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <fieldset className="min-w-0 space-y-2.5">
        <legend className="mb-2 text-title">{t('carrier')}</legend>
        {carriers.map((candidate) => (
          <label
            key={candidate.id}
            className={cn(
              'flex cursor-pointer items-start gap-3.5 rounded-xl border border-border-strong px-4 py-3.5 transition-[border-color,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring motion-reduce:transition-none',
              carrierId === candidate.id && 'border-brand bg-violet-50 ring-1 ring-brand',
            )}
          >
            <input
              type="radio"
              name={`${id}-carrier`}
              value={candidate.id}
              checked={carrierId === candidate.id}
              onChange={() => {
                setCarrierId(candidate.id);
                setPoint(null);
                setPointError(undefined);
              }}
              className="mt-0.5 size-5 shrink-0 accent-brand"
            />
            <span className="flex flex-col text-title">
              {candidate.name}{' '}
              <span className="text-body-sm font-medium text-muted-foreground">
                {kinds(candidate.kind)}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {carrier === undefined ? null : (
        <PickupPointPicker
          key={carrier.id}
          carrierId={carrier.id}
          carrierKind={carrier.kind}
          pointMap={carrier.pointMap}
          near={near}
          context="account"
          value={point}
          onChange={(next) => {
            setPoint(next);
            setPointError(undefined);
          }}
          error={pointError}
        />
      )}

      <div className="space-y-1">
        <label className="flex items-center gap-2.5 text-body">
          <input
            type="checkbox"
            checked={first || makeDefault}
            disabled={first}
            aria-describedby={first ? `${id}-first` : undefined}
            onChange={(event) => {
              setMakeDefault(event.target.checked);
            }}
            className="size-4.5 accent-brand"
          />
          {t('makeDefault')}
        </label>
        {first ? (
          <p id={`${id}-first`} className="text-body-sm text-muted-foreground">
            {t('firstDefault')}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="cta" disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </AuthForm>
  );
}
