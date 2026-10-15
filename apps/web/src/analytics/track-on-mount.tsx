'use client';

import { useEffect } from 'react';

import { track } from './posthog';

/** Zdarzenie przy wejściu na stronę renderowaną na serwerze (np. `email_verified`). */
export function TrackOnMount({
  event,
  properties,
}: {
  readonly event: string;
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}) {
  // Właściwości jako tekst: nowy obiekt przy każdym renderowaniu nie wysyła zdarzenia ponownie.
  const serialized = properties === undefined ? undefined : JSON.stringify(properties);
  useEffect(() => {
    track(
      event,
      serialized === undefined ? undefined : (JSON.parse(serialized) as Record<string, unknown>),
    );
  }, [event, serialized]);
  return null;
}
