import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotificationList } from '@/components/notifications/notification-list';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Centrum powiadomień (F-20, układ F-63); bez sesji przekierowanie na logowanie. */
export default async function NotificationsPage() {
  await loadMeOrRedirect(routes.notifications);
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow px-4 py-8 md:px-6 md:py-12">
        <NotificationList />
      </div>
    </div>
  );
}
