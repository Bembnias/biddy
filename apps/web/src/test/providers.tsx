import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/providers/toast-provider';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';

import messages from '../../messages/pl.json';
import { fakeRealtimeClient } from './realtime';

/** Komponenty z useTranslations w testach: te same komunikaty co w aplikacji. */
export function IntlWrapper({ children }: { readonly children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {children}
    </NextIntlClientProvider>
  );
}

/** Klient realtime w pamięci (bez połączenia), gdy test nie podaje własnego providera. */
const createIdleRealtime = () => Promise.resolve(fakeRealtimeClient().client);

/**
 * Komunikaty, TanStack Query (bez ponowień), realtime w pamięci i toasty (F-63), jak w layoucie
 * aplikacji.
 */
export function AppWrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <RealtimeProvider createClient={createIdleRealtime}>
        <IntlWrapper>
          <ToastProvider>{children}</ToastProvider>
        </IntlWrapper>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}
