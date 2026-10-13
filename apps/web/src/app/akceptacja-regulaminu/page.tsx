import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AcceptTermsForm } from '@/components/auth/accept-terms-form';
import { AuthCard } from '@/components/auth/form-parts';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { safeNextPath } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.acceptTerms');
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function AcceptTermsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.acceptTerms');
  const next = safeNextPath(await searchParam(searchParams, 'next'));
  return (
    <AuthCard title={t('title')}>
      <AcceptTermsForm next={next} />
    </AuthCard>
  );
}
