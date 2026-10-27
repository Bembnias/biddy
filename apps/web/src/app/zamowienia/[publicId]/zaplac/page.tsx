import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { CheckoutPanel } from '@/components/checkout/checkout-panel';
import { loadMeOrRedirect } from '@/lib/api/me';
import { checkoutUrl, routes } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly publicId: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('checkout');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Checkout zamówienia (F-25, PROJECT.md §7.2): link z powiadomienia o wygranej, z Moje Biddy
 * i z panelu wygranej. Tu wraca też kupujący ze strony operatora płatności.
 */
export default async function CheckoutPage({ params }: PageProps) {
  const { publicId } = await params;
  await loadMeOrRedirect(checkoutUrl(publicId));
  const t = await getTranslations('checkout');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-page space-y-4 px-4 py-8 md:px-6 md:py-10">
        <Link
          href={routes.myWins}
          className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('back')}
        </Link>
        <CheckoutPanel publicId={publicId} />
      </div>
    </div>
  );
}
