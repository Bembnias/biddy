'use client';

import { reportError } from '@/lib/report-error';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { routes } from '@/lib/routes';

/** Błąd w segmencie strony (układ F-63): komunikat, kod błędu, ponowienie i zgłoszenie do Sentry. */
export default function ErrorPage({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations('error');
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <div className="bg-canvas">
      <div
        role="alert"
        className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-20 text-center md:py-28"
      >
        <IconTile tone="danger" size="lg" className="size-18 rounded-full [&>svg]:size-8">
          <TriangleAlert />
        </IconTile>
        <h1 className="text-h2">{t('title')}</h1>
        <p className="max-w-[46ch] text-body text-foreground-secondary">{t('text')}</p>
        {error.digest === undefined ? null : (
          <p className="rounded-md bg-muted px-2.5 py-1 text-body-sm font-bold text-foreground-secondary tabular-nums">
            {t('reference', { digest: error.digest })}
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2.5">
          <Button asChild variant="outline" size="lg">
            <Link href={routes.home}>{t('home')}</Link>
          </Button>
          <Button size="lg" onClick={reset}>
            {t('retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
