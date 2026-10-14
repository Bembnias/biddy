'use client';

import {
  getGetMeQueryKey,
  getGetSessionQueryKey,
  isApiError,
  useUpdateMe,
} from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { AuthForm, FormAlert, TextField, useErrorMessage } from '@/components/auth/form-parts';
import { useValidationMessages } from '@/components/auth/use-validation';
import { Button } from '@/components/ui/button';
import { profileSchema } from '@/lib/auth/schemas';

type FormValues = z.output<ReturnType<typeof profileSchema>>;

/** Zmiana imienia wyświetlanego (PATCH /v1/me, F-10). */
export function ProfileForm({ name }: { readonly name: string }) {
  const t = useTranslations('profile.settings');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const update = useUpdateMe();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const form = useForm({
    resolver: zodResolver(profileSchema(useValidationMessages())),
    defaultValues: { name },
  });

  const submit = async (values: FormValues) => {
    setError(undefined);
    setSaved(false);
    try {
      const me = await update.mutateAsync({ data: { name: values.name } });
      form.reset({ name: me.name });
      setSaved(true);
      track('profile_updated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }),
      ]);
      router.refresh();
    } catch (caught) {
      const field = isApiError(caught)
        ? caught.problem?.errors?.find((item) => item.path === 'name')?.message
        : undefined;
      if (field === undefined) {
        setError(errorMessage(caught));
      } else {
        form.setError('name', { message: field });
      }
    }
  };

  return (
    <AuthForm onSubmit={(event) => void form.handleSubmit(submit)(event)} className="space-y-4">
      {error === undefined ? null : <FormAlert>{error}</FormAlert>}
      <TextField
        label={t('nameLabel')}
        hint={t('nameHint')}
        autoComplete="nickname"
        error={form.formState.errors.name?.message}
        {...form.register('name', {
          onChange: () => {
            setSaved(false);
          },
        })}
      />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" className="h-10" disabled={update.isPending}>
          {update.isPending ? t('pending') : t('submit')}
        </Button>
        <p role="status" className="text-sm text-success">
          {saved ? t('saved') : null}
        </p>
      </div>
    </AuthForm>
  );
}
