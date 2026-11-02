import type { Metadata } from 'next';
import { MailWarning } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthCard } from '@/components/auth/auth-layout';
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
 * z potwierdzonym e-mailem i akceptacją regulaminu. Po sukcesie powrót pod `?next=`. Postęp
 * „E-mail, Telefon, Licytujesz” tylko przy pierwszej weryfikacji, nie przy zmianie numeru.
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
      <AuthCard
        icon={<MailWarning />}
        tone="warning"
        title={t('emailFirstTitle')}
        lead={t('emailFirstText')}
      >
        <Button asChild size="lg" className="w-full">
          <Link href={routes.account}>{t('goToAccount')}</Link>
        </Button>
      </AuthCard>
    );
  }

  return me.phoneNumber === null ? (
    <PhoneVerificationForm next={next} showProgress />
  ) : (
    <PhoneVerificationForm
      next={next}
      title={t('changeTitle')}
      intro={t('current', { phone: formatPhoneNumber(me.phoneNumber) })}
    />
  );
}
