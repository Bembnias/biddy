'use client';

import {
  getGetMyNotificationsQueryKey,
  getGetNotificationSummaryQueryKey,
  useGetNotificationSummary,
  useGetSession,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useUserRealtimeEvents } from '@/lib/realtime/realtime-provider';
import { routes } from '@/lib/routes';

/**
 * Dzwonek w nagłówku (F-20): liczba nieprzeczytanych powiadomień, aktualizowana na żywo
 * (`notification.new`, F-17), i link do centrum powiadomień. Tylko dla zalogowanych.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const queryClient = useQueryClient();
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const signedIn = session.data?.user !== undefined && session.data.user !== null;
  const summary = useGetNotificationSummary({
    query: { enabled: signedIn, staleTime: 60_000, retry: false },
  });

  useUserRealtimeEvents(
    {
      onNotification: (event) => {
        queryClient.setQueryData(getGetNotificationSummaryQueryKey(), {
          unreadCount: event.unreadCount,
        });
        void queryClient.invalidateQueries({ queryKey: getGetMyNotificationsQueryKey() });
      },
    },
    signedIn,
  );

  if (!signedIn) {
    return null;
  }
  const count = summary.data?.unreadCount ?? 0;
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link href={routes.notifications} aria-label={t('bell', { count })}>
        <Bell aria-hidden />
        {count === 0 ? null : (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full border-2 border-background bg-brand-strong px-1 text-badge text-primary-foreground tabular-nums"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
