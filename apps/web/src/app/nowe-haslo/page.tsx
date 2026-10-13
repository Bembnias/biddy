import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthCard } from '@/components/auth/form-parts';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Button } from '@/components/ui/button';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.resetPassword');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Strona z linku resetu: API przekierowuje tu z ?token=… albo z ?error=INVALID_TOKEN. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.resetPassword');
  const token = await searchParam(searchParams, 'token');
  const error = await searchParam(searchParams, 'error');
  if (token === undefined || error !== undefined) {
    return (
      <AuthCard title={t('invalidLinkTitle')}>
        <p className="text-muted-foreground">{t('invalidLinkText')}</p>
        <Button asChild className="mt-6 h-10">
          <Link href={routes.forgotPassword}>{t('requestNew')}</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('title')}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
