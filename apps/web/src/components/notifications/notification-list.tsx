'use client';

import {
  type NotificationListDto,
  getGetMyNotificationsQueryKey,
  getGetNotificationSummaryQueryKey,
  getMyNotifications,
  markNotificationsRead,
} from '@biddy/api-client';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Centrum powiadomień (F-20): od najnowszych, nieprzeczytane wyróżnione. Kliknięcie oznacza
 * powiadomienie jako przeczytane i prowadzi do aukcji; nowe powiadomienia odświeżają listę
 * (dzwonek unieważnia zapytanie przy `notification.new`).
 */
export function NotificationList() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [markingAll, setMarkingAll] = useState(false);
  const list = useInfiniteQuery({
    queryKey: getGetMyNotificationsQueryKey(),
    queryFn: ({ pageParam, signal }) =>
      getMyNotifications(pageParam === undefined ? undefined : { before: pageParam }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: NotificationListDto) => page.nextBefore ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  const afterRead = async (unreadCount: number) => {
    queryClient.setQueryData(getGetNotificationSummaryQueryKey(), { unreadCount });
    await queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
  };

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await afterRead((await markNotificationsRead({ all: true })).unreadCount);
    } finally {
      setMarkingAll(false);
    }
  };

  if (list.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
        <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }
  if (items.length === 0) {
    return <EmptyState icon={Bell} title={t('empty')} />;
  }
  return (
    <div className="space-y-4">
      {unread === 0 ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={markingAll}
          onClick={() => void markAll()}
        >
          {t('markAll')}
        </Button>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.url}
              className={cn(
                'flex gap-3 px-5 py-4 outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-canvas focus-visible:shadow-focus-ring',
                !item.read && 'bg-accent hover:bg-violet-100',
              )}
              onClick={() => {
                track('notification_opened', { type: item.type });
                if (!item.read) {
                  void markNotificationsRead({ ids: [item.id] }).then((result) =>
                    afterRead(result.unreadCount),
                  );
                }
              }}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-2 size-2 shrink-0 rounded-full',
                  item.read ? 'bg-transparent' : 'bg-brand',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-title">
                  {item.read ? null : <span className="sr-only">{t('unread')}: </span>}
                  {item.title}
                </span>
                <span className="mt-0.5 block text-body-sm text-muted-foreground">{item.body}</span>
                <time
                  dateTime={item.createdAt}
                  className="mt-1 block text-caption text-muted-foreground"
                >
                  {format.relativeTime(new Date(item.createdAt))}
                </time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('more')}
        </Button>
      ) : null}
    </div>
  );
}
