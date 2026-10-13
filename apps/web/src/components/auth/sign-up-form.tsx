'use client';

import { getGetSessionQueryKey, useGetAuthOptions } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import { useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { signUpWithEmail } from '@/lib/auth/auth-api';
import { signUpSchema } from '@/lib/auth/schemas';
import { routes, withNext } from '@/lib/routes';

import { ConsentCheckboxes } from './consent-checkboxes';
import { FormAlert, TextField, useErrorMessage } from './form-parts';
import { SocialButtons } from './social-buttons';
import { TurnstileField } from './turnstile-field';
import { useValidationMessages } from './use-validation';

/** Rejestracja e-mailem: regulamin, 18+, Turnstile; po sukcesie „Sprawdź skrzynkę”. */
type FormValues = z.output<ReturnType<typeof signUpSchema>>;

export function SignUpForm({ next }: { readonly next: string }) {
  const t = useTranslations('auth');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const { data: options } = useGetAuthOptions();
  const [error, setError] = useState<string>();
  const [token, setToken] = useState<string>();
  const [registeredEmail, setRegisteredEmail] = useState<string>();
  const turnstile = useRef<TurnstileInstance>(undefined);
  const form = useForm({
    resolver: zodResolver(signUpSchema(useValidationMessages())),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      acceptTerms: false,
      adultDeclaration: false,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = async (values: FormValues) => {
    setError(undefined);
    if (token === undefined) {
      return;
    }
    try {
      await signUpWithEmail(values, token);
      track('sign_up_completed', { method: 'email' });
      await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      setRegisteredEmail(values.email);
    } catch (caught) {
      setError(errorMessage(caught));
      setToken(undefined);
      turnstile.current?.reset();
    }
  };

  if (registeredEmail !== undefined) {
    return (
      <div role="status" className="space-y-4">
        <MailCheck aria-hidden className="size-10 text-primary" />
        <h2 className="text-xl font-semibold">{t('signUp.checkInboxTitle')}</h2>
        <p className="text-muted-foreground">
          {t('signUp.checkInboxText', { email: registeredEmail })}
        </p>
        <Button asChild className="h-10">
          <Link href={next}>{t('signUp.goToAccount')}</Link>
        </Button>
      </div>
    );
  }

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
          label={t('fields.name')}
          hint={t('fields.nameHint')}
          autoComplete="nickname"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t('fields.password')}
          hint={t('fields.passwordHint')}
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <ConsentCheckboxes
          control={form.control}
          errors={{
            acceptTerms: errors.acceptTerms?.message,
            adultDeclaration: errors.adultDeclaration?.message,
          }}
        />
        <TurnstileField ref={turnstile} siteKey={options?.turnstileSiteKey} onToken={setToken} />
        <Button
          type="submit"
          className="h-10 w-full"
          disabled={isSubmitting || token === undefined}
        >
          {isSubmitting ? t('signUp.pending') : t('signUp.submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('signUp.hasAccount')}{' '}
        <Link
          href={withNext(routes.signIn, next)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('signUp.signIn')}
        </Link>
      </p>
    </div>
  );
}
