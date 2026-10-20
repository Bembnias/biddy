'use client';

import { useGetAuthOptions } from '@biddy/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { type SocialProvider, signInWithProvider } from '@/lib/auth/auth-api';

import { FormAlert, useErrorMessage } from './form-parts';

/** Logowanie Google/Apple: przyciski tylko dla dostawców włączonych w API (GET /v1/auth-options). */
export function SocialButtons({ next }: { readonly next: string }) {
  const t = useTranslations('auth.social');
  const errorMessage = useErrorMessage();
  const { data } = useGetAuthOptions();
  const [error, setError] = useState<string>();
  const providers: readonly SocialProvider[] = data?.socialProviders ?? [];
  if (providers.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => {
            signInWithProvider(provider, next).catch((caught: unknown) => {
              setError(errorMessage(caught));
            });
          }}
        >
          {t(provider)}
        </Button>
      ))}
      <p className="flex items-center gap-4 pt-2 text-caption text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </p>
    </div>
  );
}
