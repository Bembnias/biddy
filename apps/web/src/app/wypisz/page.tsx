import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

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
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-xl px-4 py-12 md:px-6">
        <h1 className="mb-6 text-h2">{t('title')}</h1>
        <div className="rounded-xl border border-border bg-card p-6">
          {token === '' ? (
            <p role="alert" className="text-body">
              {t('invalid')}
            </p>
          ) : (
            <UnsubscribeForm token={token} />
          )}
        </div>
      </div>
    </div>
  );
}
