'use client';

import { isApiError } from '@biddy/api-client';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Pole tekstowe z etykietą, podpowiedzią i błędem powiązanymi przez aria-describedby. */
export function TextField({
  label,
  hint,
  error,
  ...inputProps
}: ComponentProps<typeof Input> & {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className="h-10"
        {...inputProps}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
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

/** Karta formularza kont: wyśrodkowana, z nagłówkiem h1. */
export function AuthCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
