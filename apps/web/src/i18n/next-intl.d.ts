// Typowane klucze komunikatów i formatów next-intl (błędny klucz = błąd kompilacji).
import type messages from '../../messages/pl.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'pl';
    Messages: typeof messages;
  }
}
