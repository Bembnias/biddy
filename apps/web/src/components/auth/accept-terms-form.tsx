'use client';

import { getGetSessionQueryKey, useAcceptTerms } from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { consentSchema } from '@/lib/auth/schemas';

import { ConsentCheckboxes } from './consent-checkboxes';
import { FormAlert, useErrorMessage } from './form-parts';
import { useValidationMessages } from './use-validation';

/** Akceptacja regulaminu po pierwszym logowaniu przez Google lub Apple (POST /v1/me/terms-acceptances). */
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
    await accept.mutateAsync();
    await queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    router.push(next);
    router.refresh();
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      className="space-y-4"
    >
      <p className="text-muted-foreground">{t('text')}</p>
      {accept.error === null ? null : <FormAlert>{errorMessage(accept.error)}</FormAlert>}
      <ConsentCheckboxes
        control={form.control}
        errors={{
          acceptTerms: errors.acceptTerms?.message,
          adultDeclaration: errors.adultDeclaration?.message,
        }}
      />
      <Button type="submit" className="h-10 w-full" disabled={accept.isPending}>
        {accept.isPending ? t('pending') : t('submit')}
      </Button>
    </form>
  );
}
