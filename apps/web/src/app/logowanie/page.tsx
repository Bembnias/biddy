import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AuthSplitPage } from '@/components/auth/auth-layout';
import { SignInForm } from '@/components/auth/sign-in-form';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { safeNextPath } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signIn');
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.signIn');
  const next = safeNextPath(await searchParam(searchParams, 'next'));
  return (
    <AuthSplitPage variant="signIn" title={t('title')} lead={t('lead')}>
      <SignInForm next={next} />
    </AuthSplitPage>
  );
}
