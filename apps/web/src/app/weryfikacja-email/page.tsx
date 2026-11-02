import { CircleCheck, CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { AuthCard } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { routes, withNext } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verifyEmail');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * API (link z e-maila) przekierowuje tu po weryfikacji; błąd w parametrze `error`. Po sukcesie
 * następny krok to weryfikacja telefonu (F-63).
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.verifyEmail');
  const failed = (await searchParam(searchParams, 'error')) !== undefined;
  return (
    <AuthCard
      icon={failed ? <CircleX /> : <CircleCheck />}
      tone={failed ? 'danger' : 'success'}
      center
      title={failed ? t('errorTitle') : t('successTitle')}
    >
      <div role="status" className="space-y-5">
        <p className="text-body text-foreground-secondary">
          {failed ? t('errorText') : t('successText')}
        </p>
        <div className="space-y-2">
          {failed ? (
            <Button asChild size="lg" className="w-full">
              <Link href={routes.account}>{t('goToAccount')}</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" className="w-full">
                <Link href={withNext(routes.verifyPhone, routes.account)}>{t('verifyPhone')}</Link>
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href={routes.account}>{t('goToAccount')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
      {failed ? null : <TrackOnMount event="email_verified" />}
    </AuthCard>
  );
}
