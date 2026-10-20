'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { resetPassword } from '@/lib/auth/auth-api';
import { newPasswordSchema } from '@/lib/auth/schemas';
import { routes } from '@/lib/routes';

import { AuthForm, FormAlert, TextField, useErrorMessage } from './form-parts';
import { useValidationMessages } from './use-validation';

/** Nowe hasło z tokenem z linku (API unieważnia potem wszystkie sesje). */
type FormValues = z.output<ReturnType<typeof newPasswordSchema>>;

export function ResetPasswordForm({ token }: { readonly token: string }) {
  const t = useTranslations('auth');
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const form = useForm({
    resolver: zodResolver(newPasswordSchema(useValidationMessages())),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = async ({ password }: FormValues) => {
    setError(undefined);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (done) {
    return (
      <div role="status" className="space-y-4">
        <h2 className="text-h3">{t('resetPassword.successTitle')}</h2>
        <p className="text-body text-foreground-secondary">{t('resetPassword.successText')}</p>
        <Button asChild size="lg">
          <Link href={routes.signIn}>{t('resetPassword.signIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-4">
      <p className="text-body text-foreground-secondary">{t('resetPassword.text')}</p>
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <TextField
        label={t('fields.newPassword')}
        hint={t('fields.passwordHint')}
        type="password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <TextField
        label={t('fields.confirmPassword')}
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...form.register('confirmPassword')}
      />
      <Button type="submit" variant="cta" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('resetPassword.pending') : t('resetPassword.submit')}
      </Button>
    </AuthForm>
  );
}
