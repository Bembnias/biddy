'use client';

import { isApiError, unsubscribe, useGetUnsubscribe } from '@biddy/api-client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { routes } from '@/lib/routes';

/**
 * Wypisanie z e-maili linkiem z e-maila (F-20), bez logowania: co wyłączymy i jeden przycisk.
 * Klient poczty może też wypisać bez tej strony (POST /api/wypisz, RFC 8058).
 */
export function UnsubscribeForm({ token }: { readonly token: string }) {
  const t = useTranslations('notifications.unsubscribe');
  const types = useTranslations('notifications.settings.types');
  const preview = useGetUnsubscribe({ token }, { query: { retry: false } });
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  if (preview.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (preview.isError) {
    const invalid = isApiError(preview.error) && preview.error.status === 400;
    return (
      <div role="alert" className="space-y-4">
        <p>{invalid ? t('invalid') : t('error')}</p>
        <Button asChild variant="ghost" className="w-full">
          <Link href={routes.notificationSettings}>{t('settings')}</Link>
        </Button>
      </div>
    );
  }

  const submit = async () => {
    setState('sending');
    try {
      await unsubscribe({ token });
      track('email_unsubscribed', { type: preview.data.scope });
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div role="status" className="space-y-4">
        <p className="text-title">{t('done')}</p>
        <p className="text-body text-foreground-secondary">{t('inApp')}</p>
        <Button asChild variant="ghost" className="w-full">
          <Link href={routes.notificationSettings}>{t('settings')}</Link>
        </Button>
      </div>
    );
  }
  const scope = preview.data.scope;
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-body">
          {t('lead', {
            scope: scope === 'ALL' ? 'ALL' : 'TYPE',
            type: scope === 'ALL' ? '' : types(scope),
          })}
        </p>
        <p className="text-body text-foreground-secondary">{t('inApp')}</p>
      </div>
      {state === 'error' ? (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {t('error')}
        </p>
      ) : null}
      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={state === 'sending'}
          onClick={() => void submit()}
        >
          {state === 'sending' ? t('sending') : t('action')}
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href={routes.notificationSettings}>{t('settings')}</Link>
        </Button>
      </div>
    </div>
  );
}
