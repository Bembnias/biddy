import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotificationSettings } from '@/components/notifications/notification-settings';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.settings');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Ustawienia powiadomień (F-20): e-maile per typ. */
export default async function NotificationSettingsPage() {
  await loadMeOrRedirect(routes.notificationSettings);
  const t = await getTranslations('notifications.settings');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6 md:py-12">
        <h1 className="text-h2 md:text-h1">{t('title')}</h1>
        <p className="mt-2 mb-6 text-body text-foreground-secondary">{t('lead')}</p>
        <div className="rounded-xl border border-border bg-card p-6">
          <NotificationSettings />
        </div>
      </div>
    </div>
  );
}
