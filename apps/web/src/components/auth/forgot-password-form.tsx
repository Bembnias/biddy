'use client';

import { useGetAuthOptions } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { LockKeyhole, Mail } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { requestPasswordReset } from '@/lib/auth/auth-api';
import { emailOnlySchema } from '@/lib/auth/schemas';
import { routes } from '@/lib/routes';

import { AuthCard } from './auth-layout';
import { AuthForm, FormAlert, TextField, useErrorMessage } from './form-parts';
import { TurnstileField } from './turnstile-field';
import { useValidationMessages } from './use-validation';

/**
 * Prośba o link do zmiany hasła: zawsze ten sam komunikat (nie zdradza, czy konto istnieje).
 * Formularz i potwierdzenie to dwie karty z płótna F-63.
 */
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
      <AuthCard icon={<Mail />} tone="info" center title={t('forgotPassword.sentTitle')}>
        <div role="status" className="space-y-5">
          <p className="text-body text-foreground-secondary">
            {t.rich('forgotPassword.sentText', {
              email: sentTo,
              strong: (chunks) => <strong className="font-bold text-foreground">{chunks}</strong>,
            })}
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href={routes.signIn}>{t('forgotPassword.backToSignIn')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={<LockKeyhole />}
      title={t('forgotPassword.title')}
      lead={t('forgotPassword.text')}
    >
      <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-5">
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <TextField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TurnstileField ref={turnstile} siteKey={options?.turnstileSiteKey} onToken={setToken} />
        <div className="space-y-2">
          <Button
            type="submit"
            variant="cta"
            size="lg"
            className="w-full"
            disabled={isSubmitting || token === undefined}
          >
            {isSubmitting ? t('forgotPassword.pending') : t('forgotPassword.submit')}
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href={routes.signIn}>{t('forgotPassword.backToSignIn')}</Link>
          </Button>
        </div>
      </AuthForm>
    </AuthCard>
  );
}
