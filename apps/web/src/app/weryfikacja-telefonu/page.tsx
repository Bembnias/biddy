import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthCard } from '@/components/auth/form-parts';
import { PhoneVerificationForm } from '@/components/auth/phone-verification-form';
import { Button } from '@/components/ui/button';
import { loadMeOrRedirect } from '@/lib/api/me';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { formatPhoneNumber } from '@/lib/phone';
import { routes, safeNextPath, withNext } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.phone');
  return { title: t('metaTitle'), robots: { index: false } };
}

/**
 * Weryfikacja numeru telefonu (F-08): renderowana na serwerze z sesją, bo wymaga konta
 * z potwierdzonym e-mailem i akceptacją regulaminu. Po sukcesie powrót pod `?next=`.
 */
export default async function VerifyPhonePage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const next = safeNextPath(await searchParam(searchParams, 'next'));
  const me = await loadMeOrRedirect(withNext(routes.verifyPhone, next));
  const t = await getTranslations('auth.phone');

  if (!me.emailVerified) {
    return (
      <AuthCard title={t('emailFirstTitle')}>
        <div className="space-y-4">
          <p className="text-muted-foreground">{t('emailFirstText')}</p>
          <Button asChild className="h-10">
            <Link href={routes.account}>{t('goToAccount')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={me.phoneNumber === null ? t('title') : t('changeTitle')}>
      <div className="space-y-6">
        <p className="text-muted-foreground">
          {me.phoneNumber === null
            ? t('intro')
            : t('current', { phone: formatPhoneNumber(me.phoneNumber) })}
        </p>
        <PhoneVerificationForm next={next} />
      </div>
    </AuthCard>
  );
}
