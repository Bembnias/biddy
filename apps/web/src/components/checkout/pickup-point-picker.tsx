'use client';

import { type PickupPointDto, useGetPickupPoints } from '@biddy/api-client';
import { MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { FieldErrorText } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Punkt odbioru wybrany w checkoutcie. */
export interface ChosenPoint {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

const POINTS_LIMIT = 10;

/**
 * Wybór paczkomatu albo punktu odbioru (F-25): wyszukiwarka po mieście, adresie albo kodzie punktu
 * i lista do 10 wyników jako karty wyboru. Wybrany punkt pokazuje się z „Zmień punkt”. Mapa
 * dojdzie później (otwarte pytanie w specyfikacji).
 */
export function PickupPointPicker({
  carrierId,
  value,
  onChange,
  error,
}: {
  readonly carrierId: string;
  readonly value: ChosenPoint | null;
  readonly onChange: (point: ChosenPoint | null) => void;
  readonly error: string | undefined;
}) {
  const t = useTranslations('checkout.delivery');
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

  if (value !== null) {
    return (
      <div className="space-y-2">
        <p className="text-label">{t('pointSelected')}</p>
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
            {t('pointChange')}
            <span className="sr-only">: {value.name}</span>
          </Button>
        </div>
      </div>
    );
  }

  const results: readonly PickupPointDto[] = points.data ?? [];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-query`}>{t('pointSearch')}</Label>
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
              // Enter szuka punktów zamiast wysyłać cały formularz checkoutu.
              if (event.key === 'Enter') {
                event.preventDefault();
                search();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={search}>
            <Search aria-hidden />
            {t('pointSearchButton')}
          </Button>
        </div>
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {t('pointSearchHint')}
        </p>
        {tooShort ? (
          <FieldErrorText id={errorId}>{t('pointQueryTooShort')}</FieldErrorText>
        ) : error === undefined ? null : (
          <FieldErrorText id={errorId}>{error}</FieldErrorText>
        )}
      </div>
      {submitted === undefined ? null : points.isPending ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t('pointSearching')}</span>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : points.isError ? (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {t('pointError')}
        </p>
      ) : results.length === 0 ? (
        <p role="status" className="text-body-sm text-foreground-secondary">
          {t('pointNoResults')}
        </p>
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">{t('pointResults')}</legend>
          {results.map((point) => (
            <label
              key={point.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border border-border-strong px-4 py-3 transition-[border-color,background-color] duration-150 has-[:focus-visible]:shadow-focus-ring hover:bg-canvas motion-reduce:transition-none',
              )}
            >
              <input
                type="radio"
                name={`${id}-point`}
                value={point.id}
                onChange={() => {
                  onChange({ id: point.id, name: point.name, address: point.address });
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
