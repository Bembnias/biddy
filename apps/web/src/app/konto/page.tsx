import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ResendVerificationButton, SignOutButtons } from '@/components/auth/account-actions';
import { Button } from '@/components/ui/button';
import { loadMeOrRedirect } from '@/lib/api/me';
import { formatPhoneNumber } from '@/lib/phone';
import { publicProfileUrl, routes, withNext } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.account');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Konto renderowane na serwerze z sesją z ciasteczka (SSR); bez sesji przekierowanie na logowanie. */
export default async function AccountPage() {
  const me = await loadMeOrRedirect(routes.account);
  const t = await getTranslations('auth.account');
  const format = await getFormatter();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:px-6">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-lg">{me.name}</p>
      <dl className="mt-8 space-y-6 rounded-lg border border-border bg-card p-6">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">{t('email')}</dt>
          <dd className="mt-1">
            {me.email}{' '}
            <span className={me.emailVerified ? 'text-success' : 'text-destructive'}>
              ({me.emailVerified ? t('emailVerified') : t('emailNotVerified')})
            </span>
          </dd>
          {me.emailVerified ? null : (
            <dd className="mt-3">
              <ResendVerificationButton email={me.email} />
            </dd>
          )}
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">{t('phone')}</dt>
          <dd className="mt-1">
            {me.phoneNumber === null ? null : `${formatPhoneNumber(me.phoneNumber)} `}
            <span className={me.phoneVerified ? 'text-success' : 'text-destructive'}>
              ({me.phoneVerified ? t('phoneVerified') : t('phoneNotVerified')})
            </span>
          </dd>
          <dd className="mt-3">
            <Button asChild variant="outline">
              <Link href={withNext(routes.verifyPhone, routes.account)}>
                {me.phoneVerified ? t('changePhone') : t('verifyPhone')}
              </Link>
            </Button>
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-muted-foreground">{t('memberSince')}</dt>
          <dd className="mt-1">{format.dateTime(new Date(me.createdAt), { dateStyle: 'long' })}</dd>
        </div>
      </dl>
      <section aria-labelledby="selling-section" className="mt-8">
        <h2 id="selling-section" className="text-xl font-semibold">
          {t('sellingSection')}
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={routes.myAuctions}>{t('myAuctions')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.sell}>{t('sell')}</Link>
          </Button>
        </div>
      </section>
      <section aria-labelledby="profile-section" className="mt-8">
        <h2 id="profile-section" className="text-xl font-semibold">
          {t('profileSection')}
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href={routes.profileSettings}>{t('editProfile')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={routes.addresses}>{t('addresses')}</Link>
          </Button>
          <Button asChild variant="link" className="px-0">
            <Link href={publicProfileUrl(me.id)}>{t('viewPublicProfile')}</Link>
          </Button>
        </div>
      </section>
      <div className="mt-8">
        <SignOutButtons />
      </div>
    </div>
  );
}
