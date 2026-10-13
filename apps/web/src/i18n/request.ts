// next-intl bez prefiksu języka w adresie: na start tylko polski (PROJECT.md §11.3). Konfiguracja
// nie czyta nagłówków ani ciasteczek, więc strony mogą być renderowane statycznie (ISR).
import { getRequestConfig } from 'next-intl/server';

import messages from '../../messages/pl.json';

export const DEFAULT_LOCALE = 'pl';
export const TIME_ZONE = 'Europe/Warsaw';

export default getRequestConfig(() =>
  Promise.resolve({
    locale: DEFAULT_LOCALE,
    timeZone: TIME_ZONE,
    messages,
  }),
);
