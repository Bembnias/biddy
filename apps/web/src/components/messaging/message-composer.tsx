'use client';

import { isApiError } from '@biddy/api-client';
import { detectContactData, MESSAGE_LIMITS } from '@biddy/shared';
import { ImagePlus, SendHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { track } from '@/analytics/posthog';
import { PhotoUploader } from '@/components/media/photo-uploader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { ContactWarning } from './contact-warning';

export interface ComposedMessage {
  readonly body: string;
  readonly mediaIds: readonly string[];
}

/**
 * Pole wiadomości (F-29): treść z licznikiem, zdjęcia prywatne (do 5) i podpowiedź przy wykrytych
 * danych kontaktowych. Enter wysyła, Shift+Enter dodaje nową linię. Błąd wysyłki zostawia treść.
 */
export function MessageComposer({
  onSend,
}: {
  readonly onSend: (message: ComposedMessage) => Promise<void>;
}) {
  const t = useTranslations('messaging.composer');
  const id = useId();
  const [body, setBody] = useState('');
  const [mediaIds, setMediaIds] = useState<readonly string[]>([]);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const flags = detectContactData(body);
  const flagged = flags.length > 0;
  const warned = useRef(false);

  useEffect(() => {
    if (flagged && !warned.current) {
      warned.current = true;
      track('contact_warning_shown', { place: 'composer' });
    }
  }, [flagged]);

  const send = async () => {
    if (sending) {
      return;
    }
    const text = body.trim();
    if (text.length === 0 && mediaIds.length === 0) {
      setError(t('empty'));
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await onSend({ body: text, mediaIds });
      track('message_sent', { photos: mediaIds.length > 0, contact: flagged });
      setBody('');
      setMediaIds([]);
      setPhotosOpen(false);
      setUploaderKey((key) => key + 1);
    } catch (caught) {
      setError(
        isApiError(caught) && caught.problem !== undefined ? caught.problem.detail : t('error'),
      );
    } finally {
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const hintId = `${id}-hint`;
  const contactId = `${id}-contact`;
  const errorId = `${id}-error`;
  return (
    <form onSubmit={submit} className="space-y-2.5 border-t border-border bg-card px-4 py-3">
      {error === undefined ? null : (
        <p
          id={errorId}
          role="alert"
          className="rounded-lg bg-destructive-soft px-3.5 py-2.5 text-body-sm text-destructive"
        >
          {error}
        </p>
      )}
      <ContactWarning flags={flags} variant="hint" id={contactId} />
      {photosOpen ? (
        <PhotoUploader
          key={uploaderKey}
          purpose="MESSAGE_PHOTO"
          max={MESSAGE_LIMITS.photos}
          hint={t('photosHint')}
          onChange={setMediaIds}
        />
      ) : null}
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={photosOpen}
          aria-label={photosOpen ? t('hidePhotos') : t('photos')}
          onClick={() => {
            setPhotosOpen((open) => !open);
          }}
        >
          <ImagePlus aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${id}-body`} className="sr-only">
            {t('label')}
          </Label>
          <Textarea
            id={`${id}-body`}
            rows={1}
            value={body}
            maxLength={MESSAGE_LIMITS.bodyMax}
            placeholder={t('placeholder')}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={[hintId, flagged ? contactId : '', error === undefined ? '' : errorId]
              .filter(Boolean)
              .join(' ')}
            className="max-h-40 min-h-11 resize-none py-2.5"
            onChange={(event) => {
              setBody(event.target.value);
              if (error !== undefined) {
                setError(undefined);
              }
            }}
            onKeyDown={keyDown}
          />
        </div>
        <Button type="submit" disabled={sending} aria-label={sending ? t('sending') : t('send')}>
          <SendHorizontal aria-hidden />
          <span className="max-sm:sr-only">{sending ? t('sending') : t('send')}</span>
        </Button>
      </div>
      <p id={hintId} className="flex justify-between gap-3 text-caption text-muted-foreground">
        <span className="max-sm:hidden">{t('keyboard')}</span>
        <span className="ml-auto tabular-nums">
          {t('counter', { count: body.length, max: MESSAGE_LIMITS.bodyMax })}
        </span>
      </p>
    </form>
  );
}
