import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FakeShippingBanner, FakeShippingPanel } from '@/components/shipping/fake-shipping-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('devShipping.panel');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Panel deweloperski FakeShipping (F-24, PROJECT.md §8): przesyłki symulowanego dostawcy,
 * przesyłka testowa i ręczne statusy. Wymaga logowania; na produkcji API odpowiada 404
 * (FakeShipping jest wyłączony).
 */
export default async function FakeShippingPage() {
  await loadMeOrRedirect(routes.fakeShipping);
  const t = await getTranslations('devShipping.panel');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <FakeShippingBanner />
        <h1 className="mb-2 text-h2 md:text-h1">{t('title')}</h1>
        <p className="mb-6 text-body text-foreground-secondary">{t('lead')}</p>
        <FakeShippingPanel />
      </div>
    </div>
  );
}
