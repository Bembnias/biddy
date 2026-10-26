import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { MyBiddyLive } from '@/components/my-biddy/my-biddy-live';
import { MyBiddyTabs } from '@/components/my-biddy/my-biddy-tabs';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/**
 * Moje Biddy (F-21, wygląd F-62 i F-63): tło `canvas`, nagłówek z „Wystaw przedmiot” (na telefonie
 * jest w dolnym pasku), zakładki i odświeżanie list na żywo. Strony sprawdzają sesję.
 */
export default async function MyBiddyLayout({ children }: { readonly children: ReactNode }) {
  const t = await getTranslations('myBiddy');
  const layout = await getTranslations('layout');
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow px-4 py-8 md:px-6 md:py-12">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-h2 md:text-h1">{t('title')}</h1>
            <p className="text-body text-foreground-secondary max-md:hidden">{t('lead')}</p>
          </div>
          <Button asChild variant="cta" size="lg" className="max-md:hidden">
            <Link href={routes.sell}>
              <Plus aria-hidden />
              {layout('sell')}
            </Link>
          </Button>
        </div>
        <MyBiddyTabs />
        <MyBiddyLive />
        <div className="mt-6 space-y-10">{children}</div>
      </div>
    </div>
  );
}
