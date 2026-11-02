'use client';

import { isApiError } from '@biddy/api-client';
import { Check, CircleAlert, CircleDashed, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Błąd pola: ikona i tekst (nie sam kolor), powiązany z polem przez aria-describedby. */
export function FieldErrorText({
  id,
  children,
}: {
  readonly id: string;
  readonly children: string;
}) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-body-sm font-semibold text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

/**
 * Pole tekstowe z etykietą, podpowiedzią i błędem powiązanymi przez aria-describedby.
 * `labelAction` stoi w wierszu etykiety po prawej (np. „Nie pamiętasz hasła?”).
 */
export function TextField({
  label,
  hint,
  error,
  labelAction,
  ...inputProps
}: ComponentProps<typeof Input> & {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly labelAction?: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} label={label} action={labelAction} />
      <Input
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...inputProps}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : <FieldErrorText id={errorId}>{error}</FieldErrorText>}
    </div>
  );
}

function FieldLabel({
  htmlFor,
  label,
  action,
}: {
  readonly htmlFor: string;
  readonly label: string;
  readonly action: ReactNode;
}) {
  return action === undefined ? (
    <Label htmlFor={htmlFor}>{label}</Label>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {action}
    </div>
  );
}

/**
 * Hasło (F-63) z przyciskiem pokazania (`aria-pressed`). `rule` pokazuje regułę długości nowego
 * hasła sprawdzaną na bieżąco: ikona i tekst, dla czytnika „spełnione” albo „jeszcze nie”.
 */
export function PasswordField({
  label,
  error,
  labelAction,
  rule,
  className,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, 'type'> & {
  readonly label: string;
  readonly error?: string | undefined;
  readonly labelAction?: ReactNode;
  readonly rule?: { readonly text: string; readonly met: boolean };
}) {
  const t = useTranslations('auth.fields');
  const [visible, setVisible] = useState(false);
  const id = useId();
  const ruleId = `${id}-rule`;
  const errorId = `${id}-error`;
  const describedBy = [rule === undefined ? null : ruleId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ');
  const RuleIcon = rule?.met === true ? Check : CircleDashed;
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} label={label} action={labelAction} />
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={cn('pr-13', className)}
          {...inputProps}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 rounded-md text-foreground-secondary"
          aria-label={t('showPassword')}
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {rule === undefined ? null : (
        <p
          id={ruleId}
          className={cn(
            'flex items-start gap-1.5 text-body-sm font-semibold',
            rule.met ? 'text-success' : 'text-muted-foreground',
          )}
        >
          <RuleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="sr-only">{rule.met ? t('ruleMet') : t('ruleNotMet')} </span>
            {rule.text}
          </span>
        </p>
      )}
      {error === undefined ? null : <FieldErrorText id={errorId}>{error}</FieldErrorText>}
    </div>
  );
}

/**
 * Formularz kont: walidacja w JS (`noValidate`), a `method="post"` na wypadek wysłania przed
 * hydratacją (wolne łącze, Enter tuż po wpisaniu): natywne wysłanie metodą GET wstawiłoby
 * e-mail, hasło albo numer telefonu do adresu URL (historia przeglądarki, logi serwera).
 * POST tylko przeładowuje stronę.
 */
export function AuthForm(props: Omit<ComponentProps<'form'>, 'method' | 'noValidate' | 'action'>) {
  return <form noValidate method="post" {...props} />;
}

/** Komunikat błędu formularza (czytniki ekranu odczytują go od razu). */
export function FormAlert({ children }: { readonly children: ReactNode }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Treść błędu z API (Problem Details po polsku) albo komunikat ogólny. */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('auth');
  return (error) =>
    isApiError(error) && error.problem !== undefined ? error.problem.detail : t('genericError');
}
