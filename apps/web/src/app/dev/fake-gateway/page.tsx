import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FakeGatewayPanel } from '@/components/payments/fake-gateway-panel';
import { FakeGatewayBanner } from '@/components/payments/fake-pay-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('devPayments.panel');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Panel deweloperski FakeGateway (F-23, PROJECT.md §7.8): stan symulowanego operatora i ręczne
 * zdarzenia. Wymaga logowania; na produkcji API odpowiada 404 (FakeGateway jest wyłączony).
 */
export default async function FakeGatewayPage() {
  await loadMeOrRedirect(routes.fakeGateway);
  const t = await getTranslations('devPayments.panel');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
        <FakeGatewayBanner />
        <h1 className="mb-2 text-h2 md:text-h1">{t('title')}</h1>
        <p className="mb-6 text-body text-foreground-secondary">{t('lead')}</p>
        <FakeGatewayPanel />
      </div>
    </div>
  );
}
