import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.settings');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Ustawienia powiadomień (F-20, układ F-63): e-maile per typ w grupach. */
export default async function NotificationSettingsPage() {
  await loadMeOrRedirect(routes.notificationSettings);
  const t = await getTranslations('notifications.settings');
  return (
    <AccountPage
      title={t('title')}
      text={t('lead')}
      back={{ href: routes.notifications, label: t('back') }}
    >
      <NotificationSettings />
    </AccountPage>
  );
}
