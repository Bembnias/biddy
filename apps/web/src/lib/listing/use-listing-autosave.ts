'use client';

// Autozapis szkicu aukcji (F-14): 1 s po ostatniej zmianie wysyła tylko zmienione pola
// (PATCH /v1/auctions/{id}), jeden zapis naraz. `flush` zapisuje od razu (zmiana kroku,
// publikacja). Przy niezapisanych zmianach przeglądarka pyta przed zamknięciem karty.
import { type ListingDto, type ListingPatchDto, updateAuction } from '@biddy/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { changedFields, convert, formValuesFrom, type ListingFormValues, snapshot } from './form';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const AUTOSAVE_DELAY_MS = 1000;

export function useListingAutosave({
  form,
  auctionId,
  initial,
  enabled,
  onSaved,
}: {
  readonly form: UseFormReturn<ListingFormValues>;
  readonly auctionId: string;
  readonly initial: ListingDto;
  /** Tylko szkic zapisuje się sam; aukcja opublikowana zapisuje zmiany przyciskiem. */
  readonly enabled: boolean;
  readonly onSaved?: (listing: ListingDto) => void;
}) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<unknown>(undefined);
  const saved = useRef<Partial<Record<keyof ListingPatchDto, string>> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);

  const save = useCallback(async (): Promise<boolean> => {
    saved.current ??= snapshot(convert(formValuesFrom(initial)).patch);
    if (inFlight.current !== null) {
      await inFlight.current;
    }
    pending.current = false;
    const changed = changedFields(convert(form.getValues()).patch, saved.current);
    if (Object.keys(changed).length === 0) {
      return true;
    }
    setState('saving');
    const run = updateAuction(auctionId, changed).then(
      (listing) => {
        saved.current = { ...saved.current, ...snapshot(changed) };
        setError(undefined);
        setState('saved');
        onSaved?.(listing);
        return true;
      },
      (caught: unknown) => {
        setError(caught);
        setState('error');
        return false;
      },
    );
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [auctionId, form, initial, onSaved]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const unsubscribe = form.subscribe({
      formState: { values: true },
      callback: () => {
        pending.current = true;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void save();
        }, AUTOSAVE_DELAY_MS);
      },
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current !== null) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unsubscribe();
      clearTimeout(timer.current);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [enabled, form, save]);

  /** Zapis od razu (bez czekania na opóźnienie); false = nie udało się zapisać. */
  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    return save();
  }, [save]);

  return { state, error, flush };
}
