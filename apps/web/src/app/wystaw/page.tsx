import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SellStart } from '@/components/listing/sell-start';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.start');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Start wystawiania (F-14, układ F-63): hero z nową aukcją, korzyści i szkice. Wymaga zalogowania. */
export default async function SellPage() {
  const me = await loadMeOrRedirect(routes.sell);
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow px-4 py-8 md:px-6 md:py-10">
        <SellStart phoneVerified={me.phoneVerified} />
      </div>
    </div>
  );
}
