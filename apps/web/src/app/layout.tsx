import { palette, toHex } from '@biddy/design-tokens';
import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { BottomNav } from '@/components/layout/bottom-nav';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { SkipLink } from '@/components/layout/skip-link';
import { AppProviders } from '@/components/providers/app-providers';
import { config } from '@/config';

import './globals.css';

// Font z tokenów (typography.fontFamily.sans): next/font hostuje go u nas (bez zapytań do Google
// w przeglądarce) i podaje w zmiennej --font-face-sans, z której korzysta motyw Tailwinda.
const sans = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-face-sans',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  const indexable = config.environment === 'production';
  return {
    metadataBase: new URL(config.siteUrl),
    title: { default: t('title'), template: '%s · Biddy' },
    description: t('description'),
    applicationName: 'Biddy',
    openGraph: {
      type: 'website',
      locale: 'pl_PL',
      siteName: 'Biddy',
      title: t('title'),
      description: t('description'),
      url: '/',
    },
    // Poza produkcją (staging, preview) strony nie trafiają do wyszukiwarek; robots.txt też blokuje.
    ...(indexable ? {} : { robots: { index: false, follow: false } }),
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pasek przeglądarki w kolorze nagłówka (biały).
  themeColor: toHex(palette.white),
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="pl" className={sans.variable}>
      <body>
        <NextIntlClientProvider>
          <AppProviders>
            <SkipLink />
            <SiteHeader />
            {/* Strony konta mają tło `canvas`; na krótkich stronach wypełnia ono też resztę ekranu. */}
            <main
              id="main"
              tabIndex={-1}
              className="flex-1 outline-none has-[>.bg-canvas]:bg-canvas"
            >
              {children}
            </main>
            <SiteFooter />
            <BottomNav />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
