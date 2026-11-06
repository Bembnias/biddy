import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { SecondChanceOffer } from '@/components/orders/second-chance-offer';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes, secondChanceUrl } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('secondChanceOffer');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Oferta drugiej szansy dla licytującego (F-26, §6.8): link z powiadomienia o ofercie. */
export default async function SecondChanceOfferPage({ params }: PageProps) {
  const { id } = await params;
  await loadMeOrRedirect(secondChanceUrl(id));
  const t = await getTranslations('secondChanceOffer');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow space-y-4 px-4 py-8 md:px-6 md:py-10">
        <Link
          href={routes.notifications}
          className="inline-flex items-center gap-1.5 rounded-xs text-label text-link underline-offset-3 outline-none hover:text-link-hover hover:underline focus-visible:shadow-focus-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {t('back')}
        </Link>
        <SecondChanceOffer offerId={id} />
      </div>
    </div>
  );
}
