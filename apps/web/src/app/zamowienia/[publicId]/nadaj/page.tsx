import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { DispatchPanel } from '@/components/shipping/dispatch-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { dispatchUrl, routes } from '@/lib/routes';

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
      <div className="mx-auto w-full max-w-narrow space-y-4 px-4 py-8 md:px-6 md:py-10">
        <Link
          href={routes.mySales}
          className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('back')}
        </Link>
        <DispatchPanel publicId={publicId} />
      </div>
    </div>
  );
}
