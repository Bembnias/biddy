import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

import messages from '../../messages/pl.json';

/** Komponenty z useTranslations w testach: te same komunikaty co w aplikacji. */
export function IntlWrapper({ children }: { readonly children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {children}
    </NextIntlClientProvider>
  );
}

/** Komunikaty i TanStack Query (bez ponowień), jak w layoucie aplikacji. */
export function AppWrapper({ children }: { readonly children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <IntlWrapper>{children}</IntlWrapper>
    </QueryClientProvider>
  );
}
