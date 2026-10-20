'use client';

import { getGetSessionQueryKey } from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { resendVerificationEmail, signOut, signOutEverywhere } from '@/lib/auth/auth-api';
import { routes } from '@/lib/routes';

import { FormAlert, useErrorMessage } from './form-parts';

export function ResendVerificationButton({ email }: { readonly email: string }) {
  const t = useTranslations('auth.account');
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<'idle' | 'pending' | 'sent'>('idle');
  const [error, setError] = useState<string>();
  if (state === 'sent') {
    return (
      <p role="status" className="text-body-sm font-semibold text-success">
        {t('resendDone')}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <Button
        type="button"
        variant="outline"
        disabled={state === 'pending'}
        onClick={() => {
          setState('pending');
          setError(undefined);
          resendVerificationEmail(email).then(
            () => {
              setState('sent');
            },
            (caught: unknown) => {
              setError(errorMessage(caught));
              setState('idle');
            },
          );
        }}
      >
        {state === 'pending' ? t('resendPending') : t('resendVerification')}
      </Button>
    </div>
  );
}

/** Wylogowanie z tego urządzenia albo ze wszystkich (w tym aplikacji mobilnej). */
export function SignOutButtons() {
  const t = useTranslations('auth.account');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    setPending(true);
    setError(undefined);
    action()
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        router.push(routes.home);
        router.refresh();
      })
      .catch((caught: unknown) => {
        setError(errorMessage(caught));
        setPending(false);
      });
  };

  return (
    <div className="space-y-3">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(signOut)}>
          {t('signOut')}
        </Button>
        <Button
          type="button"
          variant="destructive-outline"
          disabled={pending}
          onClick={() =>
            run(async () => {
              await signOutEverywhere();
              await signOut();
            })
          }
        >
          {t('signOutEverywhere')}
        </Button>
      </div>
      <p className="text-body-sm text-muted-foreground">{t('signOutEverywhereHint')}</p>
    </div>
  );
}
