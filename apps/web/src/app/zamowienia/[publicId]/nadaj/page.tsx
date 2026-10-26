import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { DispatchPanel } from '@/components/shipping/dispatch-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { dispatchUrl } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shipping.dispatch');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Nadanie paczki (F-24, PROJECT.md §8.3): link z powiadomienia „Opłacono” i z Moje Biddy.
 * Widok zamówienia dla obu stron doda F-26.
 */
export default async function DispatchPage({ params }: PageProps) {
  const { publicId } = await params;
  await loadMeOrRedirect(dispatchUrl(publicId));
  const t = await getTranslations('shipping.dispatch');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <h1 className="mb-6 text-h2 md:text-h1">{t('title')}</h1>
        <DispatchPanel publicId={publicId} />
      </div>
    </div>
  );
}
