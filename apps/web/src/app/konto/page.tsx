import { getMe, isApiError, type MeDto } from '@biddy/api-client';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ResendVerificationButton, SignOutButtons } from '@/components/auth/account-actions';
import { withSessionCookies } from '@/lib/api/server';
import { routes, withNext } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.account');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Konto renderowane na serwerze z sesją z ciasteczka (SSR); bez sesji przekierowanie na logowanie. */
async function loadMe(): Promise<MeDto> {
  try {
    return await getMe(await withSessionCookies());
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      redirect(withNext(routes.signIn, routes.account));
    }
    throw error;
  }
}

export default async function AccountPage() {
  const me = await loadMe();
  if (!me.termsAccepted) {
    redirect(withNext(routes.acceptTerms, routes.account));
  }
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
          <dt className="text-sm font-medium text-muted-foreground">{t('memberSince')}</dt>
          <dd className="mt-1">{format.dateTime(new Date(me.createdAt), { dateStyle: 'long' })}</dd>
        </div>
      </dl>
      <div className="mt-8">
        <SignOutButtons />
      </div>
    </div>
  );
}
