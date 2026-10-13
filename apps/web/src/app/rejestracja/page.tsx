import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AuthCard } from '@/components/auth/form-parts';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { safeNextPath } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.signUp');
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function SignUpPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.signUp');
  const next = safeNextPath(await searchParam(searchParams, 'next'));
  return (
    <AuthCard title={t('title')}>
      <SignUpForm next={next} />
    </AuthCard>
  );
}
