import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountPage } from '@/components/account/account-page';
import { AvatarSettings } from '@/components/media/avatar-settings';
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
      <div className="space-y-8 rounded-xl border border-border bg-card p-6">
        <AvatarSettings userId={me.id} name={me.name} avatarUrl={me.avatarUrl} />
        <ProfileForm name={me.name} />
      </div>
      <p className="mt-6 text-body-sm">
        <Link
          href={publicProfileUrl(me.id)}
          className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
        >
          {t('viewPublic')}
        </Link>
      </p>
    </AccountPage>
  );
}
