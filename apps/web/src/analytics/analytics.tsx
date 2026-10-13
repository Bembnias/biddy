'use client';

import { useEffect } from 'react';

import { config } from '@/config';

import { CONSENT_CHANGED_EVENT } from './consent';
import { startAnalyticsIfConsented } from './posthog';

/** Startuje analitykę po zgodzie: przy wejściu na stronę i po zmianie wyboru w banerze (F-41). */
export function Analytics() {
  useEffect(() => {
    const start = () => {
      void startAnalyticsIfConsented(config, document.cookie);
    };
    start();
    window.addEventListener(CONSENT_CHANGED_EVENT, start);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, start);
    };
  }, []);
  return null;
}
