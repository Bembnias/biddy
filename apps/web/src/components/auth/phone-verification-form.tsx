'use client';

import {
  type ApiError,
  type PhoneVerificationDto,
  getGetMeQueryKey,
  getGetSessionQueryKey,
  isApiError,
  useConfirmPhoneVerification,
  useStartPhoneVerification,
} from '@biddy/api-client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { track } from '@/analytics/posthog';
import { useServerClock } from '@/components/providers/server-clock-provider';
import { Button } from '@/components/ui/button';
import {
  PHONE_CODE_LENGTH,
  phoneCodeSchema,
  phoneNumberSchema,
  polishPhoneDigits,
} from '@/lib/auth/schemas';
import { formatPhoneNumber } from '@/lib/phone';

import { AuthForm, FormAlert, TextField, useErrorMessage } from './form-parts';
import { useValidationMessages } from './use-validation';

type NumberValues = z.output<ReturnType<typeof phoneNumberSchema>>;
type CodeValues = z.output<ReturnType<typeof phoneCodeSchema>>;

/** Komunikat błędu pola z Problem Details (VALIDATION_FAILED ma go w `errors`). */
function fieldMessage(error: ApiError, field: string): string | undefined {
  return error.problem?.errors?.find((item) => item.path === field)?.message;
}

/**
 * Sekundy do `target` według zegara serwera, odświeżane co sekundę. `sync` odczytuje zegar od razu
 * (wywołać po ustawieniu nowego terminu, żeby nie pokazać przez sekundę starego odczytu).
 */
function useSecondsUntil(target: string | undefined): { seconds: number; sync: () => void } {
  const clock = useServerClock();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (target === undefined) {
      return;
    }
    const timer = setInterval(() => {
      setNow(clock.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [target, clock]);
  return {
    seconds: target === undefined ? 0 : Math.max(0, Math.ceil((Date.parse(target) - now) / 1_000)),
    sync: () => {
      setNow(clock.now());
    },
  };
}

/**
 * Weryfikacja numeru telefonu (F-08): numer → SMS z kodem → potwierdzenie. Po sukcesie powrót
 * pod `next`. Ponowna wysyłka po odliczeniu (limit API: 60 s).
 */
export function PhoneVerificationForm({ next }: { readonly next: string }) {
  const t = useTranslations('auth.phone');
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const messages = useValidationMessages();
  const start = useStartPhoneVerification();
  const confirm = useConfirmPhoneVerification();
  const [started, setStarted] = useState<PhoneVerificationDto>();
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string>();
  const resendCountdown = useSecondsUntil(started?.resendAvailableAt);
  const secondsToResend = resendCountdown.seconds;

  const numberForm = useForm({
    resolver: zodResolver(phoneNumberSchema(messages)),
    defaultValues: { phoneNumber: '' },
  });
  const codeForm = useForm({
    resolver: zodResolver(phoneCodeSchema(messages)),
    defaultValues: { code: '' },
  });

  const sendCode = async (phoneNumber: string): Promise<boolean> => {
    setError(undefined);
    try {
      setStarted(await start.mutateAsync({ data: { phoneNumber } }));
      resendCountdown.sync();
      track('phone_verification_started');
      return true;
    } catch (caught) {
      const field =
        isApiError(caught) &&
        ['VALIDATION_FAILED', 'PHONE_NUMBER_TAKEN'].includes(caught.code ?? '')
          ? (fieldMessage(caught, 'phoneNumber') ?? caught.problem?.detail)
          : undefined;
      if (field !== undefined && started === undefined) {
        numberForm.setError('phoneNumber', { message: field });
      } else {
        setError(errorMessage(caught));
      }
      return false;
    }
  };

  const submitNumber = async (values: NumberValues) => {
    setResent(false);
    await sendCode(`+48${polishPhoneDigits(values.phoneNumber) ?? ''}`);
  };

  const resend = async () => {
    if (started !== undefined && (await sendCode(started.phoneNumber))) {
      codeForm.reset();
      setResent(true);
    }
  };

  const submitCode = async (values: CodeValues) => {
    setError(undefined);
    try {
      await confirm.mutateAsync({ data: { code: values.code } });
      track('phone_verified');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
      ]);
      router.push(next);
      router.refresh();
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'PHONE_CODE_INVALID') {
        codeForm.setError('code', { message: errorMessage(caught) });
      } else {
        setError(errorMessage(caught));
      }
    }
  };

  if (started === undefined) {
    return (
      <AuthForm
        onSubmit={(event) => void numberForm.handleSubmit(submitNumber)(event)}
        className="space-y-4"
      >
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <TextField
          label={t('phoneLabel')}
          hint={t('phoneHint')}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="500 600 700"
          error={numberForm.formState.errors.phoneNumber?.message}
          {...numberForm.register('phoneNumber')}
        />
        <Button type="submit" className="h-10 w-full" disabled={start.isPending}>
          {start.isPending ? t('sending') : t('send')}
        </Button>
      </AuthForm>
    );
  }

  const phone = formatPhoneNumber(started.phoneNumber);
  return (
    <div className="space-y-4">
      <p role="status" className="text-muted-foreground">
        {resent ? t('resent', { phone }) : t('codeSent', { phone })}
      </p>
      <AuthForm
        onSubmit={(event) => void codeForm.handleSubmit(submitCode)(event)}
        className="space-y-4"
      >
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <TextField
          label={t('codeLabel')}
          hint={t('codeHint')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PHONE_CODE_LENGTH}
          className="h-10 font-mono tracking-widest"
          error={codeForm.formState.errors.code?.message}
          {...codeForm.register('code')}
        />
        <Button type="submit" className="h-10 w-full" disabled={confirm.isPending}>
          {confirm.isPending ? t('confirming') : t('confirm')}
        </Button>
      </AuthForm>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          disabled={secondsToResend > 0 || start.isPending}
          onClick={() => void resend()}
        >
          {secondsToResend > 0 ? t('resendIn', { seconds: secondsToResend }) : t('resend')}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto px-0"
          onClick={() => {
            setStarted(undefined);
            setError(undefined);
            setResent(false);
            codeForm.reset();
          }}
        >
          {t('changeNumber')}
        </Button>
      </div>
    </div>
  );
}
