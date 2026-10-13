'use client';

import { useGetAuthOptions } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { requestPasswordReset } from '@/lib/auth/auth-api';
import { emailOnlySchema } from '@/lib/auth/schemas';
import { routes } from '@/lib/routes';

import { FormAlert, TextField, useErrorMessage } from './form-parts';
import { TurnstileField } from './turnstile-field';
import { useValidationMessages } from './use-validation';

/** Prośba o link do zmiany hasła: zawsze ten sam komunikat (nie zdradza, czy konto istnieje). */
type FormValues = z.output<ReturnType<typeof emailOnlySchema>>;

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const { data: options } = useGetAuthOptions();
  const [error, setError] = useState<string>();
  const [token, setToken] = useState<string>();
  const [sentTo, setSentTo] = useState<string>();
  const turnstile = useRef<TurnstileInstance>(undefined);
  const form = useForm({
    resolver: zodResolver(emailOnlySchema(useValidationMessages())),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = async ({ email }: FormValues) => {
    setError(undefined);
    if (token === undefined) {
      return;
    }
    try {
      await requestPasswordReset(email, token);
      setSentTo(email);
    } catch (caught) {
      setError(errorMessage(caught));
      setToken(undefined);
      turnstile.current?.reset();
    }
  };

  if (sentTo !== undefined) {
    return (
      <div role="status" className="space-y-4">
        <h2 className="text-xl font-semibold">{t('forgotPassword.sentTitle')}</h2>
        <p className="text-muted-foreground">{t('forgotPassword.sentText', { email: sentTo })}</p>
        <Link href={routes.signIn} className="text-primary underline-offset-4 hover:underline">
          {t('forgotPassword.backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="space-y-4"
    >
      <p className="text-muted-foreground">{t('forgotPassword.text')}</p>
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <TextField
        label={t('fields.email')}
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <TurnstileField ref={turnstile} siteKey={options?.turnstileSiteKey} onToken={setToken} />
      <Button type="submit" className="h-10 w-full" disabled={isSubmitting || token === undefined}>
        {isSubmitting ? t('forgotPassword.pending') : t('forgotPassword.submit')}
      </Button>
    </form>
  );
}
