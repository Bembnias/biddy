'use client';

import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Widżet Cloudflare Turnstile (PROJECT.md §16.1). Token trafia do API w nagłówku
 * x-turnstile-token; po każdej próbie trzeba go odświeżyć (`ref.reset()`), bo działa raz.
 */
export function TurnstileField({
  siteKey,
  onToken,
  ref,
}: {
  readonly siteKey: string | undefined;
  readonly onToken: (token: string | undefined) => void;
  readonly ref?: Ref<TurnstileInstance | undefined>;
}) {
  const t = useTranslations('auth.fields');
  if (siteKey === undefined) {
    return <Skeleton className="h-16 w-full max-w-72" />;
  }
  return (
    <div role="group" aria-label={t('captcha')}>
      <Turnstile
        ref={ref}
        siteKey={siteKey}
        options={{ language: 'pl', size: 'flexible' }}
        onSuccess={onToken}
        onExpire={() => {
          onToken(undefined);
        }}
        onError={() => {
          onToken(undefined);
        }}
      />
    </div>
  );
}
