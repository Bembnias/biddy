'use client';

import { reportError } from '@/lib/report-error';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/** Błąd w segmencie strony: komunikat, ponowienie i zgłoszenie do Sentry. */
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
    <div
      role="alert"
      className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center"
    >
      <TriangleAlert aria-hidden className="size-12 text-destructive" />
      <h1 className="mt-6 text-3xl font-bold">{t('title')}</h1>
      <p className="mt-4 text-muted-foreground">{t('text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>{t('retry')}</Button>
        <Button asChild variant="outline">
          <Link href={routes.home}>{t('home')}</Link>
        </Button>
      </div>
      {error.digest === undefined ? null : (
        <p className="mt-6 text-xs text-muted-foreground">
          {t('reference', { digest: error.digest })}
        </p>
      )}
    </div>
  );
}
