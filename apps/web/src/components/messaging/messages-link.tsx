'use client';

import { useGetConversationSummary, useGetSession } from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { refreshConversation } from '@/lib/messaging/messaging';
import { useUserRealtimeEvents } from '@/lib/realtime/realtime-provider';
import { routes } from '@/lib/routes';

/**
 * Wiadomości w nagłówku (F-29): liczba rozmów z nieprzeczytanymi wiadomościami i odświeżanie
 * list oraz otwartej rozmowy po `message.new` i `conversation.read`. Tylko dla zalogowanych.
 */
export function MessagesLink() {
  const t = useTranslations('messaging');
  const queryClient = useQueryClient();
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const signedIn = session.data?.user !== undefined && session.data.user !== null;
  const summary = useGetConversationSummary({
    query: { enabled: signedIn, staleTime: 60_000, retry: false },
  });

  useUserRealtimeEvents(
    {
      onMessage: (event) => {
        void refreshConversation(queryClient, event.conversationId, event.unreadCount);
      },
      onConversationRead: (event) => {
        void refreshConversation(queryClient, event.conversationId, event.unreadCount);
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
      <Link href={routes.messages} aria-label={t('headerLink', { count })}>
        <MessagesSquare aria-hidden />
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
