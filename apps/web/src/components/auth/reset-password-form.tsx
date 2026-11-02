'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { resetPassword } from '@/lib/auth/auth-api';
import { PASSWORD_MIN_LENGTH, newPasswordSchema } from '@/lib/auth/schemas';
import { routes } from '@/lib/routes';

import { AuthCard } from './auth-layout';
import { AuthForm, FormAlert, PasswordField, useErrorMessage } from './form-parts';
import { useValidationMessages } from './use-validation';

/** Nowe hasło z tokenem z linku (API unieważnia potem wszystkie sesje); wynik w osobnej karcie. */
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
  const password = useWatch({ control: form.control, name: 'password' });

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
      <AuthCard
        icon={<CircleCheck />}
        tone="success"
        center
        title={t('resetPassword.successTitle')}
      >
        <div role="status" className="space-y-5">
          <p className="text-body text-foreground-secondary">{t('resetPassword.successText')}</p>
          <Button asChild size="lg" className="w-full">
            <Link href={routes.signIn}>{t('resetPassword.signIn')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard icon={<KeyRound />} title={t('resetPassword.title')} lead={t('resetPassword.text')}>
      <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-5">
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <PasswordField
          label={t('fields.newPassword')}
          autoComplete="new-password"
          rule={{
            text: t('fields.passwordHint'),
            met: [...password].length >= PASSWORD_MIN_LENGTH,
          }}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label={t('fields.confirmPassword')}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <Button type="submit" variant="cta" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t('resetPassword.pending') : t('resetPassword.submit')}
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
