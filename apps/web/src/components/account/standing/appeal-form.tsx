'use client';

import {
  appealAccountBlock,
  appealStrike,
  getGetMyStandingQueryKey,
  getListMyStrikesQueryKey,
  isApiError,
} from '@biddy/api-client';
import { APPEAL_MESSAGE_MAX_LENGTH, APPEAL_MESSAGE_MIN_LENGTH } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Odwołanie od strike'a albo blokady (F-61, DSA): przycisk „Odwołaj się” rozwija formularz
 * z licznikiem znaków. Jedno odwołanie na decyzję, więc po wysłaniu formularz znika, a lista
 * pokazuje odwołanie w toku.
 */
export function AppealForm({
  subject,
  id,
}: {
  readonly subject: 'strike' | 'block';
  readonly id: string;
}) {
  const t = useTranslations('standing.appeal');
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
    );
  }

  const length = message.trim().length;
  const tooShort = length < APPEAL_MESSAGE_MIN_LENGTH;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tooShort) {
      setError(t('tooShort', { min: APPEAL_MESSAGE_MIN_LENGTH }));
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const body = { message: message.trim() };
      await (subject === 'strike' ? appealStrike(id, body) : appealAccountBlock(id, body));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMyStrikesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMyStandingQueryKey() }),
      ]);
    } catch (caught) {
      const detail = isApiError(caught)
        ? (caught.problem as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : t('error'));
      setSending(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="w-full space-y-2.5" noValidate>
      <Label htmlFor={fieldId}>{t('label')}</Label>
      <Textarea
        id={fieldId}
        value={message}
        maxLength={APPEAL_MESSAGE_MAX_LENGTH}
        aria-describedby={`${fieldId}-hint`}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => setMessage(event.target.value)}
      />
      <div
        id={`${fieldId}-hint`}
        className="flex flex-wrap justify-between gap-2 text-body-sm text-foreground-secondary"
      >
        <span>{t('hint')}</span>
        <span className="tabular-nums">
          {t('counter', { count: length, max: APPEAL_MESSAGE_MAX_LENGTH })}
        </span>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-body-sm font-semibold text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" size="sm" disabled={sending}>
          {sending ? t('sending') : t('submit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={sending}
          onClick={() => {
            setOpen(false);
            setError(undefined);
          }}
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
