'use client';

import type { MessageDto } from '@biddy/api-client';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';

import { useServerNow } from '@/components/auction/use-auction';
import { Button } from '@/components/ui/button';
import { warsawDay } from '@/lib/dates';
import { groupByDay } from '@/lib/messaging/messaging';
import { cn } from '@/lib/utils';

import { ContactWarning } from './contact-warning';

/**
 * Wiadomości rozmowy (F-29) od najstarszej, z separatorami dni: własne z prawej (fiolet), drugiej
 * strony z lewej. Pod oflagowaną wiadomością ostrzeżenie dla obu stron, pod ostatnią przeczytaną
 * własną „Przeczytano”. Nowa wiadomość przewija na dół, a czytnik ekranu ogłasza wiadomość drugiej
 * strony. `reportAction` dodaje „Zgłoś” przy wiadomościach drugiej strony.
 */
export function MessageList({
  messages,
  role,
  counterpartName,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
  reportAction,
}: {
  /** Od najstarszej. */
  readonly messages: readonly MessageDto[];
  readonly role: 'BUYER' | 'SELLER';
  readonly counterpartName: string;
  readonly hasEarlier: boolean;
  readonly loadingEarlier: boolean;
  readonly onLoadEarlier: () => void;
  readonly reportAction?: (message: MessageDto) => ReactNode;
}) {
  const t = useTranslations('messaging.conversation');
  const format = useFormatter();
  const now = useServerNow();
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id;
  const lastRead = messages.findLast(
    (message) => message.senderRole === role && message.readAt !== null,
  );
  const latestTheirs = messages.findLast((message) => message.senderRole !== role);

  useEffect(() => {
    const element = scroller.current;
    if (element !== null && lastId !== undefined) {
      element.scrollTop = element.scrollHeight;
    }
  }, [lastId]);

  const today = now === null ? null : warsawDay(now);
  const yesterday = now === null ? null : warsawDay(now - 24 * 60 * 60 * 1000);
  const dayLabel = (day: string, sample: string) =>
    day === today
      ? t('today')
      : day === yesterday
        ? t('yesterday')
        : format.dateTime(new Date(sample), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div
      ref={scroller}
      role="region"
      // Przewijany obszar musi być osiągalny z klawiatury także bez linków w wiadomościach.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={t('messagesLabel', { name: counterpartName })}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4 outline-none focus-visible:shadow-focus-ring"
    >
      {hasEarlier ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-auto mb-2 flex text-link"
          disabled={loadingEarlier}
          onClick={onLoadEarlier}
        >
          {t('earlier')}
        </Button>
      ) : null}
      {groupByDay(messages).map((group) => (
        <section key={group.day} aria-label={dayLabel(group.day, group.items[0]?.createdAt ?? '')}>
          <p aria-hidden className="my-3 text-center text-caption text-muted-foreground">
            {dayLabel(group.day, group.items[0]?.createdAt ?? '')}
          </p>
          <ol className="space-y-3">
            {group.items.map((message) => {
              const mine = message.senderRole === role;
              return (
                <li
                  key={message.id}
                  className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}
                >
                  <div
                    className={cn(
                      'max-w-[min(34rem,85%)] space-y-2 rounded-2xl px-3.5 py-2.5 text-body',
                      mine
                        ? 'rounded-br-md bg-violet-700 text-primary-foreground'
                        : 'rounded-bl-md border border-border bg-canvas text-foreground',
                    )}
                  >
                    <span className="sr-only">
                      {mine ? t('you') : counterpartName}
                      {': '}
                    </span>
                    {message.body === '' ? null : (
                      <p className="break-words whitespace-pre-line">{message.body}</p>
                    )}
                    {message.photos.length === 0 ? null : (
                      <ul className="flex flex-wrap gap-1.5">
                        {message.photos.map((photo, index) => (
                          <li key={photo.id}>
                            <a
                              href={photo.largeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-lg outline-none focus-visible:shadow-focus-ring"
                            >
                              {/* Zdjęcie prywatne z API (sesja), bez optymalizacji Next. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photo.thumbUrl}
                                alt={t('photo', { position: index + 1 })}
                                className="size-28 rounded-lg bg-muted object-cover"
                              />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p
                    className={cn(
                      'flex items-center gap-1.5 px-1 text-caption text-muted-foreground',
                      mine && 'flex-row-reverse',
                    )}
                  >
                    <time dateTime={message.createdAt}>
                      {format.dateTime(new Date(message.createdAt), { timeStyle: 'short' })}
                    </time>
                    {mine && message.id === lastRead?.id ? <span>· {t('read')}</span> : null}
                    {!mine && reportAction !== undefined ? reportAction(message) : null}
                  </p>
                  {message.contactFlags.length === 0 ? null : (
                    <div className="w-full max-w-[min(34rem,85%)]">
                      <ContactWarning flags={message.contactFlags} variant="message" />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {latestTheirs === undefined
          ? ''
          : t('incoming', {
              name: counterpartName,
              text: latestTheirs.body === '' ? t('photoOnly') : latestTheirs.body,
            })}
      </p>
    </div>
  );
}
