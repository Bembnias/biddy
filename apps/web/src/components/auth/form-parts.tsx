'use client';

import { isApiError } from '@biddy/api-client';
import { BadgePercent, CircleAlert, Gavel, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type ReactNode, useId } from 'react';

import logoWhite from '@/assets/brand/biddy-logo-white.png';
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
        {...inputProps}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-body-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="flex items-start gap-1.5 text-body-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
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

/**
 * Układ stron kont (F-62): na desktopie panel marki z lewej (logo, hasło, korzyści), formularz
 * z prawej; na telefonie sam formularz. Nagłówek h1 i opcjonalny opis nad formularzem.
 */
export function AuthCard({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <BrandPanel />
      <div className="flex justify-center px-4 py-10 sm:py-16 lg:items-center">
        <div className="w-full max-w-auth">
          <h1 className="text-center text-h2 md:text-h1">{title}</h1>
          {lead === undefined ? null : (
            <p className="mt-2 text-center text-body text-foreground-secondary">{lead}</p>
          )}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

const PANEL_POINTS = [
  { key: 'protection', Icon: ShieldCheck },
  { key: 'proxy', Icon: Gavel },
  { key: 'zeroFee', Icon: BadgePercent },
] as const;

/**
 * Panel marki: gradient `panel-from` → `panel-to`. Duże hasło stoi na jaśniejszej górze (biały
 * tekst ≥ 24 px), drobniejszy tekst niżej, na ciemniejszej części gradientu.
 */
function BrandPanel() {
  const t = useTranslations('auth.panel');
  return (
    <aside className="hidden flex-col justify-between gap-12 bg-linear-to-b from-panel-from to-panel-to p-12 text-primary-foreground lg:flex xl:p-16">
      <div>
        <Image src={logoWhite} alt="" width={160} height={90} className="h-14 w-auto" />
        <p className="mt-8 max-w-[20ch] text-h2">{t('tagline')}</p>
      </div>
      <ul className="space-y-5">
        {PANEL_POINTS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/15">
              <Icon aria-hidden className="size-5" />
            </span>
            <span className="max-w-[40ch] pt-2 text-body font-semibold">{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="max-w-[44ch] text-body-sm">{t('footnote')}</p>
    </aside>
  );
}
