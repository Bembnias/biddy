'use client';

import { getGetSessionQueryKey, useAcceptTerms } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { consentSchema } from '@/lib/auth/schemas';

import { AuthCard } from './auth-layout';
import { ConsentCheckboxes } from './consent-checkboxes';
import { AuthForm, FormAlert, useErrorMessage } from './form-parts';
import { useValidationMessages } from './use-validation';

/**
 * Akceptacja regulaminu z oświadczeniem 18+ po pierwszym logowaniu przez Google lub Apple
 * (POST /v1/me/terms-acceptances).
 */
export function AcceptTermsForm({ next }: { readonly next: string }) {
  const t = useTranslations('auth.acceptTerms');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const accept = useAcceptTerms();
  const form = useForm({
    resolver: zodResolver(consentSchema(useValidationMessages())),
    defaultValues: { acceptTerms: false, adultDeclaration: false },
  });
  const { errors } = form.formState;

  const submit = async () => {
    // Schemat formularza wymaga zaznaczenia obu pól, więc oświadczenie 18+ jest zawsze true.
    await accept.mutateAsync({ data: { adultDeclaration: true } });
    await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    router.push(next);
    router.refresh();
  };

  return (
    <AuthCard icon={<ShieldCheck />} title={t('title')} lead={t('text')}>
      <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-5">
        {accept.error === null ? null : <FormAlert>{errorMessage(accept.error)}</FormAlert>}
        <ConsentCheckboxes
          control={form.control}
          errors={{
            acceptTerms: errors.acceptTerms?.message,
            adultDeclaration: errors.adultDeclaration?.message,
          }}
        />
        <Button
          type="submit"
          variant="cta"
          size="lg"
          className="w-full"
          disabled={accept.isPending}
        >
          {accept.isPending ? t('pending') : t('submit')}
        </Button>
      </AuthForm>
    </AuthCard>
  );
}
