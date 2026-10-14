import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { ProfileForm } from '@/components/profile/profile-form';
import { loadMeOrRedirect } from '@/lib/api/me';
import { publicProfileUrl, routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile.settings');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Edycja profilu (F-10): imię wyświetlane. */
export default async function ProfileSettingsPage() {
  const me = await loadMeOrRedirect(routes.profileSettings);
  const t = await getTranslations('profile.settings');
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.account, label: t('back') }}
    >
      <div className="rounded-lg border border-border bg-card p-6">
        <ProfileForm name={me.name} />
      </div>
      <p className="mt-6 text-sm">
        <Link
          href={publicProfileUrl(me.id)}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t('viewPublic')}
        </Link>
      </p>
    </AccountPage>
  );
}
