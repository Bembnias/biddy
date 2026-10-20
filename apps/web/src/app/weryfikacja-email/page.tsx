import { CircleCheck, CircleX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { TrackOnMount } from '@/analytics/track-on-mount';
import { AuthCard } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verifyEmail');
  return { title: t('metaTitle'), robots: { index: false } };
}

/** API (link z e-maila) przekierowuje tu po weryfikacji; błąd w parametrze `error`. */
export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const t = await getTranslations('auth.verifyEmail');
  const failed = (await searchParam(searchParams, 'error')) !== undefined;
  const Icon = failed ? CircleX : CircleCheck;
  return (
    <AuthCard title={failed ? t('errorTitle') : t('successTitle')}>
      <div role="status" className="space-y-4">
        <Icon
          aria-hidden
          className={failed ? 'size-10 text-destructive' : 'size-10 text-success'}
        />
        <p className="text-body text-foreground-secondary">
          {failed ? t('errorText') : t('successText')}
        </p>
        <Button asChild size="lg">
          <Link href={routes.account}>{t('goToAccount')}</Link>
        </Button>
      </div>
      {failed ? null : <TrackOnMount event="email_verified" />}
    </AuthCard>
  );
}
