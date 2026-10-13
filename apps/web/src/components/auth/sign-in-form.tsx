'use client';

import { getGetSessionQueryKey, isApiError, useGetAuthOptions } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { signInWithEmail } from '@/lib/auth/auth-api';
import { signInSchema } from '@/lib/auth/schemas';
import { routes, withNext } from '@/lib/routes';

import { FormAlert, TextField, useErrorMessage } from './form-parts';
import { SocialButtons } from './social-buttons';
import { TurnstileField } from './turnstile-field';
import { useValidationMessages } from './use-validation';

const CAPTCHA_CODES = new Set(['CAPTCHA_REQUIRED', 'CAPTCHA_FAILED']);

/**
 * Logowanie e-mailem i hasłem. Turnstile pojawia się dopiero, gdy API go zażąda (po 5
 * nieudanych próbach, PROJECT.md §16.1); przerwę między próbami podaje komunikat z API.
 */
type FormValues = z.output<ReturnType<typeof signInSchema>>;

export function SignInForm({ next }: { readonly next: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const { data: options } = useGetAuthOptions();
  const [error, setError] = useState<string>();
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [token, setToken] = useState<string>();
  const turnstile = useRef<TurnstileInstance>(undefined);
  const form = useForm({
    resolver: zodResolver(signInSchema(useValidationMessages())),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = async (values: FormValues) => {
    setError(undefined);
    try {
      await signInWithEmail(values, token);
      track('login_completed', { method: 'email' });
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      router.push(next);
      router.refresh();
    } catch (caught) {
      const captcha = isApiError(caught) && CAPTCHA_CODES.has(caught.code ?? '');
      if (captcha) {
        setCaptchaRequired(true);
      }
      setError(
        isApiError(caught) && caught.code === 'CAPTCHA_REQUIRED'
          ? t('signIn.captchaRequired')
          : errorMessage(caught),
      );
      // Token Turnstile działa raz: kolejna próba potrzebuje nowego.
      setToken(undefined);
      turnstile.current?.reset();
    }
  };

  return (
    <div className="space-y-6">
      <SocialButtons next={next} />
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="space-y-4"
      >
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <TextField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        {captchaRequired ? (
          <TurnstileField ref={turnstile} siteKey={options?.turnstileSiteKey} onToken={setToken} />
        ) : null}
        <Button
          type="submit"
          className="h-10 w-full"
          disabled={isSubmitting || (captchaRequired && token === undefined)}
        >
          {isSubmitting ? t('signIn.pending') : t('signIn.submit')}
        </Button>
      </form>
      <div className="space-y-2 text-sm">
        <p>
          <Link
            href={routes.forgotPassword}
            className="text-primary underline-offset-4 hover:underline"
          >
            {t('signIn.forgotPassword')}
          </Link>
        </p>
        <p className="text-muted-foreground">
          {t('signIn.noAccount')}{' '}
          <Link
            href={withNext(routes.signUp, next)}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('signIn.signUp')}
          </Link>
        </p>
      </div>
    </div>
  );
}
