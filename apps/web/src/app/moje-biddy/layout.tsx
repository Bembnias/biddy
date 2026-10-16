import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MyBiddyLive } from '@/components/my-biddy/my-biddy-live';
import { MyBiddyTabs } from '@/components/my-biddy/my-biddy-tabs';

/** Moje Biddy (F-21): nagłówek, zakładki i odświeżanie list na żywo. Strony sprawdzają sesję. */
export default async function MyBiddyLayout({ children }: { readonly children: ReactNode }) {
  const t = await getTranslations('myBiddy');
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="mb-4 text-2xl font-bold md:text-3xl">{t('title')}</h1>
      <MyBiddyTabs />
      <MyBiddyLive />
      <div className="mt-6 space-y-8">{children}</div>
    </div>
  );
}
