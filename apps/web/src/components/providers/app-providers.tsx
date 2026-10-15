'use client';

import { configureApiClient } from '@biddy/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { Analytics } from '@/analytics/analytics';
import { SessionAnalytics } from '@/analytics/session-analytics';
import { config } from '@/config';
import { createQueryClient } from '@/lib/query-client';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';

import { ServerClockProvider } from './server-clock-provider';

// Klient API w przeglądarce: adres z konfiguracji, ciasteczko sesji (domyślne credentials).
configureApiClient({ baseUrl: config.apiUrl });

/**
 * Dostawcy po stronie przeglądarki: TanStack Query, realtime (połączenie dopiero przy pierwszej
 * subskrypcji), zegar serwera, analityka po zgodzie (z sesją).
 */
export function AppProviders({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <ServerClockProvider>{children}</ServerClockProvider>
      </RealtimeProvider>
      <Analytics />
      <SessionAnalytics />
    </QueryClientProvider>
  );
}
