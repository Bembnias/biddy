'use client';

import {
  blockUser,
  type ConversationDto,
  isApiError,
  reportConversation,
  unblockUser,
} from '@biddy/api-client';
import { REPORT_DETAILS_LIMITS, REPORT_REASONS, type ReportReason } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, Flag, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useState } from 'react';

import { track } from '@/analytics/posthog';
import { useToast } from '@/components/providers/toast-provider';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshConversation } from '@/lib/messaging/messaging';
import { cn } from '@/lib/utils';

function problemText(caught: unknown, fallback: string): string {
  return isApiError(caught) && caught.problem !== undefined ? caught.problem.detail : fallback;
}

/** „Zgłoś” i „Zablokuj” / „Odblokuj” w nagłówku rozmowy (F-29). */
export function ConversationActions({ conversation }: { readonly conversation: ConversationDto }) {
  const t = useTranslations('messaging.conversation');
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ReportDialog
        conversation={conversation}
        trigger={
          <Button type="button" variant="ghost" size="sm" aria-label={t('reportUser')}>
            <Flag aria-hidden />
            <span className="max-md:sr-only">{t('report')}</span>
          </Button>
        }
      />
      <BlockButton conversation={conversation} />
    </div>
  );
}

/** Blokada z potwierdzeniem; odblokowanie bez potwierdzenia. */
export function BlockButton({
  conversation,
  variant = 'ghost',
}: {
  readonly conversation: ConversationDto;
  readonly variant?: 'ghost' | 'outline';
}) {
  const t = useTranslations('messaging.block');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const { counterpart } = conversation;

  const change = async (block: boolean) => {
    setSending(true);
    setError(undefined);
    try {
      await (block ? blockUser(counterpart.id) : unblockUser(counterpart.id));
      track(block ? 'user_blocked' : 'user_unblocked', {});
      await refreshConversation(queryClient, conversation.id);
      setOpen(false);
    } catch (caught) {
      setError(problemText(caught, t('error')));
    } finally {
      setSending(false);
    }
  };

  if (conversation.blockedByMe) {
    return (
      <span className="inline-flex flex-col items-end">
        <Button
          type="button"
          variant={variant}
          size="sm"
          disabled={sending}
          onClick={() => void change(false)}
        >
          <ShieldCheck aria-hidden />
          {t('unblock')}
        </Button>
        {error === undefined ? null : (
          <span role="alert" className="text-caption text-destructive">
            {error}
          </span>
        )}
      </span>
    );
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => !sending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size="sm" aria-label={t('open')}>
          <Ban aria-hidden />
          <span className="max-md:sr-only">{t('short')}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="gap-5 rounded-3xl p-7">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle className="text-h3">
            {t('title', { name: counterpart.name })}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-body text-foreground-secondary">
            {t('text')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === undefined ? null : (
          <p role="alert" className="text-body-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter className="gap-2.5 sm:flex-row">
          <AlertDialogCancel disabled={sending} className="sm:flex-1">
            {t('cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="sm:flex-[1.5]"
            disabled={sending}
            onClick={() => void change(true)}
          >
            {t('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Zgłoszenie wiadomości (z `messageId`) albo drugiej strony rozmowy: powód, opis, opcjonalna
 * blokada. Zespół Biddy dostaje fragment rozmowy (migawka po stronie API).
 */
export function ReportDialog({
  conversation,
  messageId,
  trigger,
}: {
  readonly conversation: ConversationDto;
  readonly messageId?: string;
  readonly trigger: ReactNode;
}) {
  const t = useTranslations('messaging.report');
  const id = useId();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>();
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const reset = () => {
    setReason(undefined);
    setDetails('');
    setBlock(false);
    setError(undefined);
  };

  const submit = async () => {
    if (reason === undefined) {
      setError(t('reasonRequired'));
      return;
    }
    if (reason === 'OTHER' && details.trim().length < REPORT_DETAILS_LIMITS.minForOther) {
      setError(t('detailsOther', { min: REPORT_DETAILS_LIMITS.minForOther }));
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const result = await reportConversation(conversation.id, {
        reason,
        ...(messageId === undefined ? {} : { messageId }),
        ...(details.trim() === '' ? {} : { details: details.trim() }),
        block: block && !conversation.blockedByMe,
      });
      track('conversation_reported', { reason, block: result.blocked });
      if (result.blocked) {
        await refreshConversation(queryClient, conversation.id);
      }
      setOpen(false);
      reset();
      toast({
        tone: 'success',
        icon: ShieldCheck,
        title: t('done'),
        ...(result.blocked ? { description: t('doneBlocked') } : {}),
      });
    } catch (caught) {
      setError(problemText(caught, t('error')));
    } finally {
      setSending(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!sending) {
          setOpen(next);
          if (!next) {
            reset();
          }
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90dvh] gap-5 overflow-y-auto rounded-3xl p-7">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle className="text-h3">
            {messageId === undefined
              ? t('titleUser', { name: conversation.counterpart.name })
              : t('titleMessage')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-body text-foreground-secondary">
            {t('lead')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-label">{t('reason')}</legend>
          {REPORT_REASONS.map((option) => (
            <label
              key={option}
              htmlFor={`${id}-${option}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border border-border-strong px-4 py-2.5 text-body has-[:focus-visible]:shadow-focus-ring',
                reason === option && 'border-brand bg-violet-50 ring-1 ring-brand',
              )}
            >
              <input
                id={`${id}-${option}`}
                type="radio"
                name={`${id}-reason`}
                value={option}
                checked={reason === option}
                onChange={() => {
                  setReason(option);
                  setError(undefined);
                }}
                className="mt-0.5 size-5 shrink-0 accent-brand"
              />
              {t(`reasons.${option}`)}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor={`${id}-details`}>
            {reason === 'OTHER' ? t('detailsRequired') : t('details')}
          </Label>
          <Textarea
            id={`${id}-details`}
            value={details}
            maxLength={REPORT_DETAILS_LIMITS.max}
            className="min-h-24"
            onChange={(event) => {
              setDetails(event.target.value);
            }}
          />
        </div>
        {conversation.blockedByMe ? null : (
          <div className="flex items-center gap-3">
            <Checkbox
              id={`${id}-block`}
              checked={block}
              onCheckedChange={(checked) => {
                setBlock(checked === true);
              }}
            />
            <Label htmlFor={`${id}-block`}>{t('block')}</Label>
          </div>
        )}
        {error === undefined ? null : (
          <p role="alert" className="text-body-sm font-semibold text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter className="gap-2.5 sm:flex-row">
          <AlertDialogCancel disabled={sending} className="sm:flex-1">
            {t('cancel')}
          </AlertDialogCancel>
          <Button
            type="button"
            className="sm:flex-[1.5]"
            disabled={sending}
            onClick={() => void submit()}
          >
            {sending ? t('sending') : t('submit')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
