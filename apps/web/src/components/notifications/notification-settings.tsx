'use client';

import {
  type NotificationPreferencesDto,
  getGetNotificationPreferencesQueryKey,
  updateNotificationPreferences,
  useGetNotificationPreferences,
} from '@biddy/api-client';
import { NOTIFICATION_TYPES, type NotificationType } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * E-maile per typ powiadomienia (F-20). Zmiana zapisuje się od razu; e-maile transakcyjne
 * (wygrana, sprzedaż) są zawsze włączone. Powiadomienia w aplikacji są zawsze.
 */
export function NotificationSettings() {
  const t = useTranslations('notifications.settings');
  const common = useTranslations('notifications');
  const queryClient = useQueryClient();
  const preferences = useGetNotificationPreferences();
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; type: NotificationType }>();

  if (preferences.isPending) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (preferences.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
      >
        {common('error')}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void preferences.refetch()}
        >
          {common('retry')}
        </Button>
      </div>
    );
  }

  const email = new Map(
    preferences.data.items
      .filter((item) => item.channel === 'EMAIL')
      .map((item) => [item.type, item]),
  );

  const key = getGetNotificationPreferencesQueryKey();
  const setEmail = (type: NotificationType, enabled: boolean) => {
    queryClient.setQueryData<NotificationPreferencesDto>(key, (current) =>
      current === undefined
        ? current
        : {
            items: current.items.map((item) =>
              item.type === type && item.channel === 'EMAIL' ? { ...item, enabled } : item,
            ),
          },
    );
  };

  /** Zmiana widoczna od razu; przy błędzie wraca poprzedni stan. */
  const change = async (type: NotificationType, enabled: boolean) => {
    setStatus(undefined);
    setEmail(type, enabled);
    try {
      const updated = await updateNotificationPreferences({
        items: [{ type, channel: 'EMAIL', enabled }],
      });
      queryClient.setQueryData<NotificationPreferencesDto>(key, updated);
      setStatus({ kind: 'saved', type });
    } catch {
      setEmail(type, !enabled);
      setStatus({ kind: 'error', type });
    }
  };

  return (
    <fieldset className="space-y-4">
      <legend className="mb-4 text-title">{t('email')}</legend>
      {NOTIFICATION_TYPES.map((type) => {
        const entry = email.get(type);
        const id = `email-${type}`;
        return (
          <div key={type} className="flex items-start gap-3">
            <input
              id={id}
              type="checkbox"
              checked={entry?.enabled ?? true}
              disabled={entry?.configurable !== true}
              aria-describedby={entry?.configurable === true ? undefined : `${id}-hint`}
              className="mt-1 size-4.5 accent-brand-strong"
              onChange={(event) => {
                void change(type, event.target.checked);
              }}
            />
            <div>
              <label htmlFor={id} className="text-body text-foreground">
                {t(`types.${type}`)}
              </label>
              {entry?.configurable === true ? null : (
                <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">
                  {t('always')}
                </p>
              )}
              {status?.type === type ? (
                <p
                  role={status.kind === 'error' ? 'alert' : 'status'}
                  className={
                    status.kind === 'error'
                      ? 'text-body-sm text-destructive'
                      : 'text-body-sm font-semibold text-success'
                  }
                >
                  {status.kind === 'error' ? t('error') : t('saved')}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
