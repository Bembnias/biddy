'use client';

import { useEffect } from 'react';

import { track } from './posthog';

/** Zdarzenie przy wejściu na stronę renderowaną na serwerze (np. `email_verified`). */
export function TrackOnMount({ event }: { readonly event: string }) {
  useEffect(() => {
    track(event);
  }, [event]);
  return null;
}
