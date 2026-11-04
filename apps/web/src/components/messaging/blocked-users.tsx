'use client';

import {
  getListBlockedUsersQueryKey,
  isApiError,
  unblockUser,
  useListBlockedUsers,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { UserX } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { UserAvatar } from '@/components/profile/user-avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

/** Zablokowani użytkownicy (F-29) z „Odblokuj”; blokada wyłącza tylko wiadomości. */
export function BlockedUsers() {
  const t = useTranslations('messaging.blocked');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const blocked = useListBlockedUsers();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  const unblock = async (userId: string) => {
    setPending(userId);
    setError(undefined);
    try {
      await unblockUser(userId);
      track('user_unblocked', {});
      await queryClient.invalidateQueries({ queryKey: getListBlockedUsersQueryKey() });
    } catch (caught) {
      setError(
        isApiError(caught) && caught.problem !== undefined ? caught.problem.detail : t('error'),
      );
    } finally {
      setPending(undefined);
    }
  };

  let content;
  if (blocked.isPending) {
    content = <Skeleton className="h-20 w-full rounded-xl" />;
  } else if (blocked.isError) {
    content = (
      <p
        role="alert"
        className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {t('error')}
      </p>
    );
  } else if (blocked.data.items.length === 0) {
    content = (
      <EmptyState icon={UserX} title={t('empty')}>
        {t('emptyText')}
      </EmptyState>
    );
  } else {
    content = (
      <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-border bg-card">
        {blocked.data.items.map((item) => (
          <li key={item.userId} className="flex items-center gap-3 px-4 py-3.5">
            <UserAvatar userId={item.userId} name={item.name} label="" imageUrl={item.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold">{item.name}</p>
              <p className="text-caption text-muted-foreground">
                {t('since', {
                  date: format.dateTime(new Date(item.blockedAt), { dateStyle: 'medium' }),
                })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending === item.userId}
              aria-label={t('unblockLabel', { name: item.name })}
              onClick={() => void unblock(item.userId)}
            >
              {t('unblock')}
            </Button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-h2 md:text-h1">{t('title')}</h1>
        <p className="text-body text-foreground-secondary">{t('lead')}</p>
      </div>
      {error === undefined ? null : (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {error}
        </p>
      )}
      {content}
    </div>
  );
}
