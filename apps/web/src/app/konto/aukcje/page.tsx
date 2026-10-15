import { getMyAuctions } from '@biddy/api-client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { MyAuctions } from '@/components/listing/my-auctions';
import { Button } from '@/components/ui/button';
import { loadMeOrRedirect } from '@/lib/api/me';
import { withSessionCookies } from '@/lib/api/server';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('listing.mine');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Moje aukcje (F-14): szkice, aktywne, w moderacji, zakończone i anulowane. */
export default async function MyAuctionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly opublikowano?: string | string[] }>;
}) {
  await loadMeOrRedirect(routes.myAuctions);
  const [auctions, query, t] = await Promise.all([
    getMyAuctions(undefined, await withSessionCookies()),
    searchParams,
    getTranslations('listing.mine'),
  ]);
  const published = typeof query.opublikowano === 'string' ? query.opublikowano : undefined;
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.account, label: t('back') }}
    >
      <div className="mb-6">
        <Button asChild className="h-10">
          <Link href={routes.sell}>{t('new')}</Link>
        </Button>
      </div>
      <MyAuctions initial={auctions} publishedId={published} />
    </AccountPage>
  );
}
