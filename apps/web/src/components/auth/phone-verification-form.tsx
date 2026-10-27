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
import { Check, Clock, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useEffect, useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { cn } from '@/lib/utils';

import { AuthCard } from './auth-layout';
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

/** Postęp pierwszej weryfikacji nad kartą (F-63): e-mail potwierdzony, teraz telefon. */
function VerificationProgress() {
  const t = useTranslations('auth.phone.progress');
  const pill = 'inline-flex h-7.5 items-center gap-1.5 rounded-full px-3';
  return (
    <ol aria-label={t('label')} className="flex items-center justify-center gap-2 text-label">
      <li className="flex items-center gap-2">
        <span className={cn(pill, 'bg-success-soft text-success')}>
          <Check aria-hidden className="size-3.5" />
          <span className="sr-only">{t('done')} </span>
          {t('email')}
        </span>
        <span aria-hidden className="h-0.5 w-5 bg-border-strong" />
      </li>
      <li aria-current="step" className="flex items-center gap-2">
        <span className={cn(pill, 'bg-brand-strong text-primary-foreground')}>{t('phone')}</span>
        <span aria-hidden className="h-0.5 w-5 bg-border-strong" />
      </li>
      <li>
        <span className={cn(pill, 'border border-border-strong bg-card text-foreground-secondary')}>
          {t('bid')}
        </span>
      </li>
    </ol>
  );
}

/**
 * Kod z SMS-a (F-63): wygląda jak sześć kafelków, ale to jedno pole `one-time-code`
 * (przezroczyste, nad kafelkami), więc działają autouzupełnianie kodu z SMS-a i wklejanie.
 * Kafelki są dekoracją; czytnik ekranu widzi zwykłe pole z etykietą.
 */
function CodeField({
  label,
  hint,
  error,
  value,
  onBlur,
  ...inputProps
}: ComponentProps<'input'> & {
  readonly label: string;
  readonly hint: string;
  readonly error: string | undefined;
  readonly value: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const digits = [...value];
  const active = Math.min(digits.length, PHONE_CODE_LENGTH - 1);
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">
        <div aria-hidden className="flex gap-2">
          {Array.from({ length: PHONE_CODE_LENGTH }, (_, index) => (
            <span
              key={index}
              className={cn(
                'grid h-13 w-11 place-items-center rounded-lg border bg-card text-h2 font-extrabold tabular-nums transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none sm:h-15 sm:w-13',
                error === undefined ? 'border-input' : 'border-destructive',
                focused && index === active && 'border-ring ring-3 ring-violet-100',
              )}
            >
              {digits[index] ?? ''}
            </span>
          ))}
        </div>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PHONE_CODE_LENGTH}
          aria-describedby={error === undefined ? `${id}-hint` : `${id}-hint ${id}-error`}
          aria-invalid={error === undefined ? undefined : true}
          className="absolute inset-0 size-full cursor-text appearance-none bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...inputProps}
        />
      </div>
      <p className="text-body-sm text-muted-foreground">
        <label htmlFor={id} className="font-semibold text-foreground-secondary">
          {label}
        </label>
        {', '}
        <span id={`${id}-hint`}>{hint}</span>
      </p>
      {error === undefined ? null : (
        <p id={`${id}-error`} className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Weryfikacja numeru telefonu (F-08, układ F-63): numer → SMS z kodem → potwierdzenie, w karcie
 * z postępem nad nią (`showProgress`, tylko pierwsza weryfikacja). Po sukcesie powrót pod
 * `next`. Ponowna wysyłka po odliczeniu (limit API: 60 s).
 */
export function PhoneVerificationForm({
  next,
  title,
  intro,
  showProgress = false,
}: {
  readonly next: string;
  readonly title?: string;
  readonly intro?: string;
  readonly showProgress?: boolean;
}) {
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
  const code = useWatch({ control: codeForm.control, name: 'code' });

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

  const card = (lead: ReactNode, body: ReactNode) => (
    <AuthCard
      icon={<Smartphone />}
      title={title ?? t('title')}
      lead={lead}
      above={showProgress ? <VerificationProgress /> : undefined}
      below={t('footnote')}
    >
      {body}
    </AuthCard>
  );

  if (started === undefined) {
    return card(
      intro ?? t('intro'),
      <AuthForm
        onSubmit={(event) => void numberForm.handleSubmit(submitNumber)(event)}
        className="space-y-5"
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
        <Button type="submit" variant="cta" size="lg" className="w-full" disabled={start.isPending}>
          {start.isPending ? t('sending') : t('send')}
        </Button>
      </AuthForm>,
    );
  }

  const phone = formatPhoneNumber(started.phoneNumber);
  const strong = (chunks: ReactNode) => (
    <strong className="font-bold whitespace-nowrap text-foreground tabular-nums">{chunks}</strong>
  );
  return card(
    <p role="status">
      {resent ? t.rich('resent', { phone, strong }) : t.rich('codeSent', { phone, strong })}
    </p>,
    <div className="space-y-5">
      <AuthForm
        onSubmit={(event) => void codeForm.handleSubmit(submitCode)(event)}
        className="space-y-5"
      >
        {error === undefined ? null : <FormAlert>{error}</FormAlert>}
        <CodeField
          label={t('codeLabel')}
          hint={t('codeHint')}
          value={code}
          error={codeForm.formState.errors.code?.message}
          {...codeForm.register('code')}
        />
        <Button
          type="submit"
          variant="cta"
          size="lg"
          className="w-full"
          disabled={confirm.isPending}
        >
          {confirm.isPending ? t('confirming') : t('confirm')}
        </Button>
      </AuthForm>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="link"
          className="h-auto px-0 tabular-nums no-underline disabled:text-muted-foreground disabled:opacity-100"
          disabled={secondsToResend > 0 || start.isPending}
          onClick={() => void resend()}
        >
          <Clock aria-hidden className="size-4" />
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
    </div>,
  );
}
