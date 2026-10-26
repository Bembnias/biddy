'use client';

import {
  type NotificationListDto,
  type NotificationListDtoItemsItem,
  getGetMyNotificationsQueryKey,
  getGetNotificationSummaryQueryKey,
  getMyNotifications,
  markNotificationsRead,
} from '@biddy/api-client';
import type { NotificationType } from '@biddy/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  BadgeCheck,
  Bell,
  CheckCheck,
  CircleX,
  Clock,
  type LucideIcon,
  Package,
  Settings,
  Store,
  TriangleAlert,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';

import { track } from '@/analytics/posthog';
import { useServerNow } from '@/components/auction/use-auction';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { warsawDay } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Notification = NotificationListDtoItemsItem;

/** Ikona w tonie typu (F-63): pełna czerwień dla przebicia, pełny fiolet dla wygranej. */
const TYPE_TILES: Record<
  NotificationType,
  { readonly tone: ComponentProps<typeof IconTile>['tone']; readonly Icon: LucideIcon }
> = {
  OUTBID: { tone: 'urgent', Icon: TriangleAlert },
  ENDING_SOON: { tone: 'brand', Icon: Clock },
  WON: { tone: 'won', Icon: Trophy },
  SOLD: { tone: 'success', Icon: BadgeCheck },
  ORDER_PAID: { tone: 'success', Icon: Package },
  UNSOLD: { tone: 'danger', Icon: CircleX },
  AUCTION_CANCELLED: { tone: 'neutral', Icon: Ban },
  FOLLOWED_SELLER_NEW_AUCTION: { tone: 'info', Icon: Store },
};

function NotificationItem({
  item,
  now,
  onOpen,
}: {
  readonly item: Notification;
  readonly now: number | null;
  readonly onOpen: () => void;
}) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const { tone, Icon } = TYPE_TILES[item.type];
  const unread = !item.read;
  return (
    <li>
      <Link
        href={item.url}
        data-unread={unread || undefined}
        className={cn(
          'relative flex gap-4 px-4 py-4 outline-none hover:bg-canvas focus-visible:z-10 focus-visible:shadow-focus-ring sm:px-5',
          unread && 'bg-violet-50 hover:bg-violet-100',
        )}
        onClick={onOpen}
      >
        <IconTile tone={tone}>
          <Icon />
        </IconTile>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span
              className={cn(
                'min-w-0 text-title break-words',
                unread ? 'font-extrabold' : 'font-semibold',
              )}
            >
              {unread ? <span className="sr-only">{t('unread')}: </span> : null}
              {item.title}
            </span>
            <span className="flex shrink-0 items-center gap-2 pt-0.5 text-caption text-muted-foreground">
              <time dateTime={item.createdAt}>
                {format.relativeTime(new Date(item.createdAt), now ?? undefined)}
              </time>
              {unread ? <span aria-hidden className="size-2.5 rounded-full bg-brand" /> : null}
            </span>
          </span>
          <span className="mt-0.5 block text-body-sm text-foreground-secondary">{item.body}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Centrum powiadomień (F-20, układ F-63): liczba nowych przy tytule, grupy „Dzisiaj”
 * i „Wcześniej” (dzień w Europe/Warsaw), nieprzeczytane z kropką, tłem i pogrubionym tytułem.
 * Kliknięcie oznacza powiadomienie jako przeczytane i prowadzi do aukcji; nowe powiadomienia
 * odświeżają listę (dzwonek unieważnia zapytanie przy `notification.new`).
 */
export function NotificationList() {
  const t = useTranslations('notifications');
  const queryClient = useQueryClient();
  const now = useServerNow();
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

  const open = (item: Notification) => () => {
    track('notification_opened', { type: item.type });
    if (!item.read) {
      void markNotificationsRead({ ids: [item.id] }).then((result) =>
        afterRead(result.unreadCount),
      );
    }
  };

  let content;
  if (list.isPending) {
    content = (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  } else if (list.isError) {
    content = (
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
  } else if (items.length === 0) {
    content = <EmptyState icon={Bell} title={t('empty')} />;
  } else {
    // Przed hydracją zegara (i w testach bez niego) jedna lista bez podziału na dni.
    const today = now === null ? null : warsawDay(now);
    const groups = [
      {
        key: 'today',
        items: items.filter((item) => warsawDay(new Date(item.createdAt)) === today),
      },
      {
        key: 'earlier',
        items: items.filter((item) => warsawDay(new Date(item.createdAt)) !== today),
      },
    ] as const;
    content = (
      <div className="space-y-6">
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <section
              key={group.key}
              aria-labelledby={today === null ? undefined : `notifications-${group.key}`}
              className="space-y-2.5"
            >
              {today === null ? null : (
                <h2
                  id={`notifications-${group.key}`}
                  className="text-overline text-muted-foreground uppercase"
                >
                  {t(`groups.${group.key}`)}
                </h2>
              )}
              <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-border bg-card">
                {group.items.map((item) => (
                  <NotificationItem key={item.id} item={item} now={now} onOpen={open(item)} />
                ))}
              </ul>
            </section>
          ),
        )}
        {list.hasNextPage ? (
          <Button
            type="button"
            variant="ghost"
            className="mx-auto flex text-link"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('more')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-h2 md:text-h1">{t('title')}</h1>
          {unread === 0 ? null : (
            <span className="inline-flex h-6.5 items-center rounded-full bg-urgent px-2.5 text-caption font-extrabold text-primary-foreground tabular-nums">
              {t('newCount', { count: unread })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {unread === 0 ? null : (
            <Button
              type="button"
              variant="ghost"
              disabled={markingAll}
              onClick={() => void markAll()}
            >
              <CheckCheck aria-hidden />
              {t('markAll')}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={routes.notificationSettings} aria-label={t('settingsLink')}>
              <Settings aria-hidden />
              {t('settingsShort')}
            </Link>
          </Button>
        </div>
      </div>
      {content}
    </>
  );
}
