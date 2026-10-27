import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { AuthCard } from '@/components/auth/auth-layout';
import { UnsubscribeForm } from '@/components/notifications/unsubscribe-form';
import { type SearchParams, searchParam } from '@/lib/page-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications.unsubscribe');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Wypisanie z e-maili linkiem z e-maila (F-20), bez logowania. */
export default async function UnsubscribePage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const token = (await searchParam(searchParams, 'token')) ?? '';
  const t = await getTranslations('notifications.unsubscribe');
  return (
    <AuthCard icon={<Mail />} tone="neutral" title={t('title')}>
      {token === '' ? (
        <p role="alert" className="text-body">
          {t('invalid')}
        </p>
      ) : (
        <UnsubscribeForm token={token} />
      )}
    </AuthCard>
  );
}
