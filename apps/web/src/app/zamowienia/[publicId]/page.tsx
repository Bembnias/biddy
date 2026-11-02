import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { OrderBackLink } from '@/components/orders/order-back-link';
import { OrderPanel } from '@/components/orders/order-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { orderUrl } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Zamówienie dla obu stron (F-26, PROJECT.md §7.2–7.4): link z powiadomień o etapach zamówienia
 * i z Moje Biddy. Rolę (kupujący, sprzedający) zna dopiero API, więc link wstecz wybiera klient.
 */
export default async function OrderPage({ params }: PageProps) {
  const { publicId } = await params;
  await loadMeOrRedirect(orderUrl(publicId));
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-page space-y-4 px-4 py-8 md:px-6 md:py-10">
        <OrderBackLink publicId={publicId} />
        <OrderPanel publicId={publicId} />
      </div>
    </div>
  );
}
