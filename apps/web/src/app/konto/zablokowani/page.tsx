import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { BlockedUsers } from '@/components/messaging/blocked-users';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messaging.blocked');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Zablokowani użytkownicy (F-29) z odblokowaniem; link z konta. */
export default async function BlockedUsersPage() {
  await loadMeOrRedirect(routes.blockedUsers);
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow px-4 py-8 md:px-6 md:py-12">
        <BlockedUsers />
      </div>
    </div>
  );
}
