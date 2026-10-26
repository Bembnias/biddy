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

/** Edycja profilu (F-10, układ F-63): zdjęcie obok formularza imienia wyświetlanego. */
export default async function ProfileSettingsPage() {
  const me = await loadMeOrRedirect(routes.profileSettings);
  const t = await getTranslations('profile.settings');
  return (
    <AccountPage
      title={t('title')}
      text={t('text')}
      back={{ href: routes.account, label: t('back') }}
    >
      <div className="flex flex-wrap items-start gap-x-10 gap-y-8 rounded-xl border border-border bg-card p-5 sm:p-7">
        <div className="max-sm:w-full sm:w-60">
          <AvatarSettings userId={me.id} name={me.name} avatarUrl={me.avatarUrl} />
        </div>
        <div className="min-w-0 flex-[1_1_20rem] space-y-5">
          <ProfileForm name={me.name} />
          <p className="text-body-sm">
            <Link
              href={publicProfileUrl(me.id)}
              className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
            >
              {t('viewPublic')}
            </Link>
          </p>
        </div>
      </div>
    </AccountPage>
  );
}
