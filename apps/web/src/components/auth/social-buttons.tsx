'use client';

import { useGetAuthOptions } from '@biddy/api-client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { type SocialProvider, signInWithProvider } from '@/lib/auth/auth-api';
import { cn } from '@/lib/utils';

import { FormAlert, useErrorMessage } from './form-parts';

const INITIALS: Readonly<Record<SocialProvider, string>> = { google: 'G', apple: 'A' };

/**
 * Logowanie Google/Apple: przyciski tylko dla dostawców włączonych w API (GET /v1/auth-options),
 * nad formularzem e-mail z separatorem „albo e-mailem” (F-63). `compact` (rejestracja): kafelki
 * w jednym rzędzie z samą literą dostawcy i pełną nazwą dla czytnika ekranu.
 */
export function SocialButtons({
  next,
  compact = false,
}: {
  readonly next: string;
  readonly compact?: boolean;
}) {
  const t = useTranslations('auth.social');
  const errorMessage = useErrorMessage();
  const { data } = useGetAuthOptions();
  const [error, setError] = useState<string>();
  const providers: readonly SocialProvider[] = data?.socialProviders ?? [];
  if (providers.length === 0) {
    return null;
  }
  return (
    <div className="space-y-6">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <div className={cn(compact ? 'flex gap-2.5' : 'space-y-2.5')}>
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            size="lg"
            className={compact ? 'flex-1' : 'w-full'}
            aria-label={compact ? t(`signUp.${provider}`) : undefined}
            onClick={() => {
              signInWithProvider(provider, next).catch((caught: unknown) => {
                setError(errorMessage(caught));
              });
            }}
          >
            <span
              aria-hidden
              className="grid size-5.5 place-items-center rounded-full bg-muted text-caption font-extrabold"
            >
              {INITIALS[provider]}
            </span>
            {compact ? null : t(provider)}
          </Button>
        ))}
      </div>
      <p className="flex items-center gap-3 text-body-sm text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </p>
    </div>
  );
}
