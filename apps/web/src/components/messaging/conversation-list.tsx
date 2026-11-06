'use client';

import {
  type ConversationListDto,
  type ConversationListDtoItemsItem,
  getListConversationsQueryKey,
  listConversations,
} from '@biddy/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ImageOff, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';

import { useServerNow } from '@/components/auction/use-auction';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { conversationUrl } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Conversation = ConversationListDtoItemsItem;

/**
 * Lista rozmów (F-29): druga strona, aukcja z miniaturą, zamówienie pary, początek ostatniej
 * wiadomości i liczba nieprzeczytanych (pogrubienie i kropka). Ostatnia aktywność pierwsza,
 * „Wcześniejsze rozmowy” dociąga kolejne 30. Nowe wiadomości odświeżają listę (`MessagesLink`).
 */
export function ConversationList({ activeId }: { readonly activeId?: string }) {
  const t = useTranslations('messaging.list');
  const list = useInfiniteQuery({
    queryKey: getListConversationsQueryKey(),
    queryFn: ({ pageParam, signal }) =>
      listConversations(pageParam === undefined ? undefined : { before: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: ConversationListDto) => page.nextBefore ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  if (list.isPending) {
    return (
      <div className="space-y-2 p-3" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-18 w-full rounded-xl" />
        <Skeleton className="h-18 w-full rounded-xl" />
        <Skeleton className="h-18 w-full rounded-xl" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div
        role="alert"
        className="m-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState icon={MessagesSquare} title={t('empty')} className="m-3 border-0">
        {t('emptyText')}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-ink-100">
        {items.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            active={conversation.id === activeId}
          />
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          className="mx-auto mb-2 flex text-link"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('more')}
        </Button>
      ) : null}
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
}: {
  readonly conversation: Conversation;
  readonly active: boolean;
}) {
  const t = useTranslations('messaging.list');
  const statuses = useTranslations('order.statuses');
  const format = useFormatter();
  const now = useServerNow();
  const { counterpart, auction, order, lastMessage } = conversation;
  const unread = conversation.unreadCount > 0;
  const preview =
    lastMessage === null
      ? ''
      : lastMessage.preview === ''
        ? t('photo')
        : lastMessage.senderRole === conversation.role
          ? t('you', { text: lastMessage.preview })
          : lastMessage.preview;
  return (
    <li>
      <Link
        href={conversationUrl(conversation.id)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex gap-3 px-4 py-3.5 outline-none transition-colors duration-150 hover:bg-muted focus-visible:shadow-focus-ring motion-reduce:transition-none',
          active && 'bg-violet-50 hover:bg-violet-50',
        )}
      >
        <UserAvatar
          userId={counterpart.id}
          name={counterpart.name}
          label=""
          imageUrl={counterpart.avatarUrl}
        />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-body', unread ? 'font-extrabold' : 'font-semibold')}>
              {counterpart.available ? counterpart.name : t('unavailable')}
            </span>
            <time
              dateTime={conversation.lastMessageAt}
              className="shrink-0 text-caption text-muted-foreground"
            >
              {format.relativeTime(new Date(conversation.lastMessageAt), now ?? undefined)}
            </time>
          </span>
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            {auction?.coverUrl === null || auction === null ? (
              <ImageOff aria-hidden className="size-3.5 shrink-0" />
            ) : (
              // Miniatura WebP z CDN.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={auction.coverUrl}
                alt=""
                className="size-4 shrink-0 rounded-xs object-cover"
              />
            )}
            <span className="truncate">{auction?.title ?? ''}</span>
            {order === null ? null : (
              <span className="shrink-0">· {t('order', { status: statuses(order.status) })}</span>
            )}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate text-body-sm',
                unread ? 'font-semibold text-foreground' : 'text-foreground-secondary',
              )}
            >
              {preview}
            </span>
            {unread ? (
              <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-strong px-1.5 text-badge text-primary-foreground tabular-nums">
                <span aria-hidden>{conversation.unreadCount}</span>
                <span className="sr-only">{t('unread', { count: conversation.unreadCount })}</span>
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
