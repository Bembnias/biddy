'use client';

import { useGetSession } from '@biddy/api-client';
import { Gavel } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/** Link do Moje Biddy w nagłówku (F-21), tylko dla zalogowanych; poniżej 1024 px sama ikona. */
export function MyBiddyLink() {
  const t = useTranslations('myBiddy');
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  if (session.data?.user === undefined || session.data.user === null) {
    return null;
  }
  return (
    <Button asChild variant="ghost" className="max-lg:size-10 max-lg:rounded-full max-lg:px-0">
      <Link href={routes.myBiddy}>
        <Gavel aria-hidden />
        <span className="max-lg:sr-only">{t('headerLink')}</span>
      </Link>
    </Button>
  );
}
