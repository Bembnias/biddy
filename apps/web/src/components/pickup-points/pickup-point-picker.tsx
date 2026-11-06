'use client';

import {
  getPickupPoint,
  isApiError,
  type PickupPointDto,
  type SavedPickupPointDto,
  useGetPickupPoints,
} from '@biddy/api-client';
import { MapPin, Search, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { FieldErrorText } from '@/components/auth/form-parts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  type MapNear,
  mapAvailable,
  PickupPointMapButton,
  type PointMapConfig,
} from './pickup-point-map-button';

/** Wybrany punkt odbioru (checkout, konto). */
export interface ChosenPoint {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

/** Skąd pochodzi wybór: mapa, wyszukiwarka albo zapisane punkty (analityka F-64). */
export type PointSource = 'map' | 'search' | 'saved';

export type PickerContext = 'checkout' | 'account';

const POINTS_LIMIT = 10;

const cardClass =
  'flex cursor-pointer items-start gap-3 rounded-xl border border-border-strong px-4 py-3 transition-[border-color,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring hover:bg-canvas motion-reduce:transition-none';

/**
 * Wybór paczkomatu albo punktu odbioru (F-25, F-64): zapisane punkty usługi, mapa Furgonetki
 * (gdy jest klucz i dostawca punktów ją ma) i wyszukiwarka po mieście, adresie albo kodzie.
 * Wyszukiwarka jest drogą dla klawiatury i czytnika ekranu oraz zapasem, gdy mapa zawiedzie.
 * Punkt z mapy sprawdzamy w API Biddy, które podaje też adres.
 */
export function PickupPointPicker({
  carrierId,
  carrierKind,
  pointMap,
  saved = [],
  near,
  context,
  value,
  onChange,
  error,
}: {
  readonly carrierId: string;
  readonly carrierKind: string;
  readonly pointMap: PointMapConfig | null;
  /** Zapisane punkty tej usługi. */
  readonly saved?: readonly SavedPickupPointDto[];
  readonly near?: MapNear;
  readonly context: PickerContext;
  readonly value: ChosenPoint | null;
  readonly onChange: (point: ChosenPoint | null, source?: PointSource) => void;
  readonly error: string | undefined;
}) {
  const t = useTranslations('pickupPoints');
  const id = useId();
  const withMap = mapAvailable(pointMap);
  const [searchOpen, setSearchOpen] = useState(!withMap);
  const [mapFailed, setMapFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [mapError, setMapError] = useState<string>();

  const choose = (point: ChosenPoint, source: PointSource) => {
    track('pickup_point_selected', { carrierId, source, context });
    onChange(point, source);
  };

  const fromMap = async (code: string, type: string) => {
    setMapError(undefined);
    if (pointMap === null || type !== pointMap.service) {
      track('pickup_point_map_failed', { carrierId, reason: 'type_mismatch' });
      setMapError(t('invalidPoint'));
      return;
    }
    setChecking(true);
    try {
      const point = await getPickupPoint(code, { carrier: carrierId });
      choose({ id: point.id, name: point.name, address: point.address }, 'map');
    } catch (caught) {
      const code = isApiError(caught) ? caught.problem?.code : undefined;
      const notFound = code === 'PICKUP_POINT_NOT_FOUND' || code === 'SHIPPING_OPTION_UNAVAILABLE';
      if (notFound) {
        track('pickup_point_map_failed', { carrierId, reason: 'not_found' });
      }
      setMapError(notFound ? t('invalidPoint') : t('checkError'));
    } finally {
      setChecking(false);
    }
  };

  if (value !== null) {
    return (
      <div className="space-y-2">
        <p className="text-label">{t('selected')}</p>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-brand bg-violet-50 px-4 py-3.5">
          <p className="flex min-w-0 items-start gap-2.5">
            <MapPin aria-hidden className="mt-0.5 size-4.5 shrink-0 text-violet-700" />
            <span className="min-w-0 break-words">
              <span className="block text-title">{value.name}</span>
              <span className="block text-body-sm text-foreground-secondary">{value.address}</span>
            </span>
          </p>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              onChange(null);
            }}
          >
            {t('change')}
            <span className="sr-only">: {value.name}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {saved.length === 0 ? null : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-2 text-label">{t('saved')}</legend>
          {saved.map((point) => (
            <label key={point.id} className={cardClass}>
              <input
                type="radio"
                name={`${id}-saved`}
                value={point.pointId}
                onChange={() => {
                  choose({ id: point.pointId, name: point.name, address: point.address }, 'saved');
                }}
                className="mt-1 size-5 shrink-0 accent-brand"
              />
              <span className="min-w-0 break-words">
                <span className="block text-title">
                  {point.name}
                  {point.isDefault ? (
                    <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-caption font-semibold text-violet-700">
                      {t('defaultBadge')}
                    </span>
                  ) : null}
                </span>{' '}
                <span className="block text-body-sm text-foreground-secondary">
                  {point.address}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {withMap ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <PickupPointMapButton
            pointMap={pointMap}
            carrierKind={carrierKind}
            near={near}
            selectedId={undefined}
            onOpen={() => {
              setMapError(undefined);
              track('pickup_point_map_opened', { carrierId, context });
            }}
            onPick={(point) => {
              void fromMap(point.code, point.type);
            }}
            onError={(reason) => {
              track('pickup_point_map_failed', { carrierId, reason });
              setMapFailed(true);
              setSearchOpen(true);
            }}
          />
          {searchOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={false}
              onClick={() => {
                setSearchOpen(true);
              }}
            >
              <Search aria-hidden />
              {t('openSearch')}
            </Button>
          )}
        </div>
      ) : null}

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {checking ? (
          <div aria-busy="true" className="space-y-1">
            <p className="text-body-sm text-foreground-secondary">{t('checking')}</p>
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : null}
        {mapFailed ? (
          <Alert variant="warning" role="note">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{t('mapFailed')}</AlertDescription>
          </Alert>
        ) : null}
        {mapError === undefined ? null : (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {mapError}
          </p>
        )}
      </div>

      {searchOpen ? (
        <PointSearch carrierId={carrierId} error={error} onChoose={choose} />
      ) : error === undefined ? null : (
        <FieldErrorText id={`${id}-error`}>{error}</FieldErrorText>
      )}
    </div>
  );
}

/** Wyszukiwarka punktów po mieście, adresie albo kodzie i lista do 10 wyników (F-25). */
function PointSearch({
  carrierId,
  error,
  onChoose,
}: {
  readonly carrierId: string;
  readonly error: string | undefined;
  readonly onChoose: (point: ChosenPoint, source: PointSource) => void;
}) {
  const t = useTranslations('pickupPoints');
  const id = useId();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<string>();
  const [tooShort, setTooShort] = useState(false);
  const points = useGetPickupPoints(
    { carrier: carrierId, q: submitted ?? '', limit: POINTS_LIMIT },
    { query: { enabled: submitted !== undefined, staleTime: 60_000 } },
  );

  const search = () => {
    const phrase = query.trim();
    setTooShort(phrase.length < 2);
    if (phrase.length >= 2) {
      setSubmitted(phrase);
    }
  };

  const results: readonly PickupPointDto[] = points.data ?? [];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-query`}>{t('search')}</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-query`}
            value={query}
            autoComplete="off"
            aria-describedby={[hintId, error === undefined && !tooShort ? null : errorId]
              .filter(Boolean)
              .join(' ')}
            aria-invalid={error === undefined && !tooShort ? undefined : true}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter szuka punktów zamiast wysyłać cały formularz.
              if (event.key === 'Enter') {
                event.preventDefault();
                search();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={search}>
            <Search aria-hidden />
            {t('searchButton')}
          </Button>
        </div>
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {t('searchHint')}
        </p>
        {tooShort ? (
          <FieldErrorText id={errorId}>{t('queryTooShort')}</FieldErrorText>
        ) : error === undefined ? null : (
          <FieldErrorText id={errorId}>{error}</FieldErrorText>
        )}
      </div>
      {submitted === undefined ? null : points.isPending ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t('searching')}</span>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : points.isError ? (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {t('searchError')}
        </p>
      ) : results.length === 0 ? (
        <p role="status" className="text-body-sm text-foreground-secondary">
          {t('noResults')}
        </p>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">{t('results')}</legend>
          {results.map((point) => (
            <label key={point.id} className={cn(cardClass)}>
              <input
                type="radio"
                name={`${id}-point`}
                value={point.id}
                onChange={() => {
                  onChoose({ id: point.id, name: point.name, address: point.address }, 'search');
                }}
                className="mt-1 size-5 shrink-0 accent-brand"
              />
              <span className="min-w-0 break-words">
                <span className="block text-title">{point.name}</span>{' '}
                <span className="block text-body-sm text-foreground-secondary">
                  {point.address}
                  {point.openingHours === null ? '' : ` · ${point.openingHours}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
