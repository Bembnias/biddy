import { getMyAuction, isApiError, type ListingDto } from '@biddy/api-client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ListingWizard } from '@/components/listing/listing-wizard';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { listingWizardUrl, routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.wizard');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Kreator aukcji (F-14) dla szkicu albo aukcji bez ofert; cudza albo nieistniejąca: 404. */
export default async function ListingWizardPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const me = await loadMeOrRedirect(listingWizardUrl(id));
  let listing: ListingDto;
  try {
    listing = await getMyAuction(id, await withSessionCookies());
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }
  const t = await getTranslations('listing.wizard');
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
      <Link
        href={routes.myAuctions}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        {t('toMyAuctions')}
      </Link>
      <h1 className="mt-4 mb-8 text-3xl font-bold">
        {listing.status === 'DRAFT' ? t('title') : t('editTitle')}
      </h1>
      <ListingWizard initial={listing} phoneVerified={me.phoneVerified} />
    </div>
  );
}
