import { getMyAuction, isApiError, type ListingDto } from '@biddy/api-client';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ListingWizard } from '@/components/listing/listing-wizard';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { listingWizardUrl } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.wizard');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Kreator aukcji (F-14) dla szkicu albo aukcji bez ofert; cudza albo nieistniejąca: 404. Od
 * 1024 px formularz i podgląd w dwóch kolumnach (F-63), stąd szerokość stron publicznych.
 */
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
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-page px-4 py-8 md:px-6 md:py-10">
        <ListingWizard initial={listing} phoneVerified={me.phoneVerified} />
      </div>
    </div>
  );
}
