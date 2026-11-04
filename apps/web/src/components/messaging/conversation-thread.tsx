'use client';

import {
  type ConversationDto,
  getListConversationMessagesQueryKey,
  isApiError,
  listConversationMessages,
  markConversationRead,
  type MessagePageDto,
  sendMessage,
  useGetConversation,
} from '@biddy/api-client';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Flag, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { refreshConversation } from '@/lib/messaging/messaging';
import { auctionUrl, orderUrl, publicProfileUrl, routes } from '@/lib/routes';

import { BlockButton, ConversationActions, ReportDialog } from './conversation-actions';
import { type ComposedMessage, MessageComposer } from './message-composer';
import { MessageList } from './message-list';

/**
 * Rozmowa (F-29): nagłówek z drugą stroną, aukcją i zamówieniem, zgłoszenie i blokada, wiadomości
 * z ostrzeżeniami i pole wiadomości. Otwarta rozmowa oznacza wiadomości drugiej strony jako
 * przeczytane (także po powrocie do karty). Przy blokadzie zamiast pola jest komunikat.
 */
export function ConversationThread({ conversationId }: { readonly conversationId: string }) {
  const t = useTranslations('messaging.conversation');
  const conversation = useGetConversation(conversationId, { query: { retry: false } });

  if (conversation.isPending) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="w-full flex-1 rounded-xl" />
      </div>
    );
  }
  if (conversation.isError) {
    const missing = isApiError(conversation.error) && conversation.error.status === 404;
    return (
      <div className="p-4">
        {missing ? (
          <EmptyState
            icon={MessagesSquare}
            title={t('notFound')}
            headingLevel="h1"
            action={
              <Button asChild variant="outline">
                <Link href={routes.messages}>{t('back')}</Link>
              </Button>
            }
          >
            {t('notFoundText')}
          </EmptyState>
        ) : (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
          >
            {t('error')}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void conversation.refetch()}
            >
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    );
  }
  return <Thread conversation={conversation.data} />;
}

function Thread({ conversation }: { readonly conversation: ConversationDto }) {
  const t = useTranslations('messaging.conversation');
  const statuses = useTranslations('order.statuses');
  const queryClient = useQueryClient();
  const { id, counterpart, auction, order, role } = conversation;
  const messages = useInfiniteQuery({
    queryKey: getListConversationMessagesQueryKey(id),
    queryFn: ({ pageParam, signal }) =>
      listConversationMessages(id, pageParam === undefined ? undefined : { before: pageParam }, {
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: MessagePageDto) => page.nextBefore ?? undefined,
  });
  const items = (messages.data?.pages.flatMap((page) => page.items) ?? []).toReversed();
  const hasUnread = items.some((message) => message.senderRole !== role && message.readAt === null);

  useEffect(() => {
    if (!hasUnread) {
      return undefined;
    }
    const mark = () => {
      if (document.visibilityState === 'visible') {
        void markConversationRead(id).then((result) =>
          refreshConversation(queryClient, id, result.unreadCount),
        );
      }
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => {
      document.removeEventListener('visibilitychange', mark);
    };
  }, [hasUnread, id, queryClient]);

  const send = async (message: ComposedMessage) => {
    await sendMessage(id, { body: message.body, mediaIds: [...message.mediaIds] });
    await refreshConversation(queryClient, id);
  };

  const name = counterpart.available ? counterpart.name : t('unavailableName');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        <Button asChild variant="ghost" size="icon-sm" className="lg:hidden">
          <Link href={routes.messages} aria-label={t('back')}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <UserAvatar
          userId={counterpart.id}
          name={counterpart.name}
          label=""
          imageUrl={counterpart.avatarUrl}
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title">
            {counterpart.available ? (
              <Link
                href={publicProfileUrl(counterpart.id)}
                className="rounded-xs underline-offset-3 outline-none hover:underline focus-visible:shadow-focus-ring"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </h1>
          <p className="truncate text-caption text-muted-foreground">
            {auction === null ? null : (
              <Link
                href={auctionUrl(auction)}
                className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
              >
                {auction.title}
              </Link>
            )}
            {order === null ? null : (
              <>
                {' · '}
                <Link
                  href={orderUrl(order.publicId)}
                  className="font-semibold text-link underline-offset-3 hover:text-link-hover hover:underline"
                >
                  {t('order', { number: order.publicId, status: statuses(order.status) })}
                </Link>
              </>
            )}
          </p>
        </div>
        <ConversationActions conversation={conversation} />
      </header>
      {messages.isPending ? (
        <div className="flex-1 space-y-3 p-4" aria-busy="true">
          <Skeleton className="h-14 w-1/2 rounded-2xl" />
          <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
        </div>
      ) : messages.isError ? (
        <div className="flex-1 p-4">
          <p
            role="alert"
            className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
          >
            {t('error')}
          </p>
        </div>
      ) : (
        <MessageList
          messages={items}
          role={role}
          counterpartName={name}
          hasEarlier={messages.hasNextPage}
          loadingEarlier={messages.isFetchingNextPage}
          onLoadEarlier={() => void messages.fetchNextPage()}
          reportAction={(message) => (
            <ReportDialog
              conversation={conversation}
              messageId={message.id}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t('reportMessage')}
                >
                  <Flag aria-hidden />
                </Button>
              }
            />
          )}
        />
      )}
      {conversation.canSend ? (
        <MessageComposer onSend={send} />
      ) : (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted px-4 py-3.5 text-body-sm text-foreground-secondary"
        >
          {conversation.blockedByMe
            ? t('blockedByMe')
            : counterpart.available
              ? t('blocked')
              : t('unavailable')}
          {conversation.blockedByMe ? (
            <BlockButton conversation={conversation} variant="outline" />
          ) : null}
        </div>
      )}
    </div>
  );
}
