'use client';

import { useMyBiddyRealtime } from './use-live-lists';

/** Odświeżanie list Moje Biddy po zdarzeniach użytkownika (bez widoku). */
export function MyBiddyLive() {
  useMyBiddyRealtime();
  return null;
}
