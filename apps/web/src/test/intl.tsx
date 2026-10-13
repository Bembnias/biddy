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
