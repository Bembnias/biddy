'use client';

import { isApiError, startConversation, useGetConversationStart } from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ImageOff, Lightbulb, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { track } from '@/analytics/posthog';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { refreshConversation } from '@/lib/messaging/messaging';
import { auctionUrl, conversationUrl, routes } from '@/lib/routes';

import { type ComposedMessage, MessageComposer } from './message-composer';

/** Przedmiot nowej rozmowy z adresu strony. */
export type NewConversationSubject = { readonly auctionId: string } | { readonly orderId: string };

/**
 * Nowa wiadomość (F-29): przedmiot rozmowy, druga strona, wskazówki bezpieczeństwa i pole
 * pierwszej wiadomości. Istniejąca rozmowa pary: przekierowanie do niej. Gdy nie można zacząć
 * rozmowy (własna albo zakończona aukcja, blokada), komunikat z powodem.
 */
export function NewConversation({ subject }: { readonly subject: NewConversationSubject }) {
  const t = useTranslations('messaging.start');
  const statuses = useTranslations('order.statuses');
  const router = useRouter();
  const queryClient = useQueryClient();
  const start = useGetConversationStart(subject, { query: { retry: false } });
  const existing = start.data?.conversationId ?? null;

  useEffect(() => {
    if (existing !== null) {
      router.replace(conversationUrl(existing));
    }
  }, [existing, router]);

  if (start.isPending || existing !== null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (start.isError) {
    const missing = isApiError(start.error) && start.error.status === 404;
    return (
      <EmptyState
        icon={MessagesSquare}
        title={missing ? t('notFound') : t('error')}
        headingLevel="h1"
        action={
          <Button asChild variant="outline">
            <Link href={routes.messages}>{t('back')}</Link>
          </Button>
        }
      />
    );
  }

  const view = start.data;
  const send = async (message: ComposedMessage) => {
    const conversation = await startConversation({
      ...subject,
      body: message.body,
      mediaIds: [...message.mediaIds],
    });
    track('conversation_started', {
      subject: 'orderId' in subject ? 'ORDER' : 'AUCTION',
      role: conversation.role,
    });
    await refreshConversation(queryClient, conversation.id);
    router.replace(conversationUrl(conversation.id));
  };
  const blockedText = view.blockedByMe ? t('blockedByMe') : t('blocked');
  return (
    <div className="space-y-5">
      <h1 className="text-h2 md:text-h1">{t('title')}</h1>
      <section
        aria-label={t('about')}
        className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
      >
        {view.auction?.coverUrl === null || view.auction === null ? (
          <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <ImageOff aria-hidden className="size-6" />
          </span>
        ) : (
          // Miniatura WebP z CDN.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={view.auction.coverUrl}
            alt=""
            className="size-16 shrink-0 rounded-xl object-cover"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-overline text-muted-foreground uppercase">{t('about')}</p>
          {view.auction === null ? null : (
            <Link
              href={auctionUrl(view.auction)}
              className="block text-title break-words text-link underline-offset-3 hover:text-link-hover hover:underline"
            >
              {view.auction.title}
            </Link>
          )}
          {view.order === null ? null : (
            <p className="text-body-sm text-foreground-secondary">
              {t('order', { number: view.order.publicId, status: statuses(view.order.status) })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 max-sm:hidden">
          <UserAvatar
            userId={view.counterpart.id}
            name={view.counterpart.name}
            label=""
            imageUrl={view.counterpart.avatarUrl}
            size="xs"
          />
          <span className="text-body-sm font-semibold">
            {t('to', { name: view.counterpart.name })}
          </span>
        </div>
      </section>
      {view.unavailableReason !== null || !view.canSend ? (
        <Alert variant="info" role="status">
          <MessagesSquare aria-hidden />
          <AlertDescription className="text-foreground">
            {view.unavailableReason === null
              ? blockedText
              : t(`unavailable.${view.unavailableReason}`)}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Alert variant="brand" role="note">
            <Lightbulb aria-hidden />
            <AlertDescription className="text-foreground">{t('tips')}</AlertDescription>
          </Alert>
          <div className="overflow-hidden rounded-2xl border border-border">
            <MessageComposer onSend={send} />
          </div>
        </>
      )}
    </div>
  );
}
