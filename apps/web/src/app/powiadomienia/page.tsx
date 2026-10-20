import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { NotificationList } from '@/components/notifications/notification-list';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Centrum powiadomień (F-20); bez sesji przekierowanie na logowanie. */
export default async function NotificationsPage() {
  await loadMeOrRedirect(routes.notifications);
  const t = await getTranslations('notifications');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-h2 md:text-h1">{t('title')}</h1>
          <Link
            href={routes.notificationSettings}
            className="text-label text-link underline-offset-3 hover:text-link-hover hover:underline"
          >
            {t('settingsLink')}
          </Link>
        </div>
        <NotificationList />
      </div>
    </div>
  );
}
