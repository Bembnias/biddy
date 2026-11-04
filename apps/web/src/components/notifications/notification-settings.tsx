'use client';

import {
  type NotificationPreferencesDto,
  getGetNotificationPreferencesQueryKey,
  updateNotificationPreferences,
  useGetNotificationPreferences,
} from '@biddy/api-client';
import type { NotificationType } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Ban,
  Banknote,
  BellRing,
  CircleCheck,
  CircleX,
  Clock,
  Gavel,
  Gift,
  HandCoins,
  Landmark,
  Lock,
  type LucideIcon,
  MessageSquareWarning,
  MessagesSquare,
  Package,
  PackageCheck,
  PackageOpen,
  PackageSearch,
  PackageX,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Store,
  TriangleAlert,
  Trophy,
  Truck,
  Undo2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

/**
 * Grupy ustawień (F-63): licytacje, zakupy, sprzedaż, wypłaty, spory, obserwowani sprzedawcy
 * i konto.
 */
const GROUPS: readonly {
  readonly key:
    | 'bidding'
    | 'buying'
    | 'selling'
    | 'payouts'
    | 'disputes'
    | 'messages'
    | 'following'
    | 'account';
  readonly types: readonly NotificationType[];
}[] = [
  {
    key: 'bidding',
    types: ['OUTBID', 'ENDING_SOON', 'WON', 'AUCTION_CANCELLED', 'SECOND_CHANCE_OFFER'],
  },
  {
    key: 'buying',
    types: ['PAYMENT_REMINDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'ORDER_REFUNDED'],
  },
  {
    key: 'selling',
    types: [
      'SOLD',
      'ORDER_PAID',
      'SHIP_REMINDER',
      'ORDER_COMPLETED',
      'ORDER_CANCELLED',
      'ORDER_NOT_PICKED_UP',
      'ORDER_LOST',
      'SECOND_CHANCE_ANSWERED',
      'UNSOLD',
    ],
  },
  { key: 'payouts', types: ['PAYOUT_PAID', 'PAYOUT_FAILED', 'PAYOUT_ACCOUNT_CHANGED'] },
  {
    key: 'disputes',
    types: [
      'DISPUTE_OPENED',
      'DISPUTE_PARTIAL_OFFERED',
      'DISPUTE_ESCALATED',
      'DISPUTE_RETURN_REQUESTED',
      'DISPUTE_RETURN_DELIVERED',
      'DISPUTE_RESOLVED',
    ],
  },
  { key: 'messages', types: ['NEW_MESSAGE'] },
  { key: 'following', types: ['FOLLOWED_SELLER_NEW_AUCTION'] },
  {
    key: 'account',
    types: [
      'STRIKE_ISSUED',
      'STRIKE_REVOKED',
      'ACCOUNT_BLOCKED',
      'ACCOUNT_UNBLOCKED',
      'APPEAL_REJECTED',
    ],
  },
];

/** Ikona typu w spokojnym tonie (w ustawieniach nic nie wymaga reakcji). */
const TYPE_TILES: Record<
  NotificationType,
  { readonly tone: ComponentProps<typeof IconTile>['tone']; readonly Icon: LucideIcon }
> = {
  OUTBID: { tone: 'danger', Icon: TriangleAlert },
  ENDING_SOON: { tone: 'brand', Icon: Clock },
  WON: { tone: 'brand', Icon: Trophy },
  AUCTION_CANCELLED: { tone: 'neutral', Icon: Ban },
  SOLD: { tone: 'success', Icon: BadgeCheck },
  ORDER_PAID: { tone: 'success', Icon: Package },
  PAYMENT_REMINDER: { tone: 'brand', Icon: BellRing },
  SHIP_REMINDER: { tone: 'brand', Icon: BellRing },
  ORDER_CANCELLED: { tone: 'neutral', Icon: PackageX },
  ORDER_SHIPPED: { tone: 'info', Icon: Truck },
  ORDER_DELIVERED: { tone: 'success', Icon: PackageCheck },
  ORDER_COMPLETED: { tone: 'success', Icon: CircleCheck },
  ORDER_NOT_PICKED_UP: { tone: 'neutral', Icon: RotateCcw },
  ORDER_LOST: { tone: 'neutral', Icon: PackageSearch },
  ORDER_REFUNDED: { tone: 'neutral', Icon: Undo2 },
  SECOND_CHANCE_OFFER: { tone: 'brand', Icon: Gift },
  SECOND_CHANCE_ANSWERED: { tone: 'neutral', Icon: Gift },
  PAYOUT_PAID: { tone: 'success', Icon: Banknote },
  PAYOUT_FAILED: { tone: 'neutral', Icon: TriangleAlert },
  PAYOUT_ACCOUNT_CHANGED: { tone: 'neutral', Icon: Landmark },
  DISPUTE_OPENED: { tone: 'neutral', Icon: MessageSquareWarning },
  DISPUTE_PARTIAL_OFFERED: { tone: 'neutral', Icon: HandCoins },
  DISPUTE_ESCALATED: { tone: 'neutral', Icon: Scale },
  DISPUTE_RETURN_REQUESTED: { tone: 'neutral', Icon: PackageOpen },
  DISPUTE_RETURN_DELIVERED: { tone: 'neutral', Icon: PackageCheck },
  DISPUTE_RESOLVED: { tone: 'neutral', Icon: Gavel },
  UNSOLD: { tone: 'danger', Icon: CircleX },
  FOLLOWED_SELLER_NEW_AUCTION: { tone: 'neutral', Icon: Store },
  STRIKE_ISSUED: { tone: 'neutral', Icon: ShieldAlert },
  STRIKE_REVOKED: { tone: 'neutral', Icon: ShieldCheck },
  ACCOUNT_BLOCKED: { tone: 'neutral', Icon: Ban },
  ACCOUNT_UNBLOCKED: { tone: 'neutral', Icon: ShieldCheck },
  APPEAL_REJECTED: { tone: 'neutral', Icon: Scale },
  NEW_MESSAGE: { tone: 'neutral', Icon: MessagesSquare },
};

/** Typy z opisem pod nazwą (`settings.hints`). */
const HINT_TYPES = ['OUTBID', 'ENDING_SOON', 'WON', 'AUCTION_CANCELLED', 'NEW_MESSAGE'] as const;

function hasHint(type: NotificationType): type is (typeof HINT_TYPES)[number] {
  return (HINT_TYPES as readonly string[]).includes(type);
}

/**
 * E-maile per typ powiadomienia (F-20, układ F-63): grupy w kartach, przełącznik
 * (`role="switch"`) przy każdym typie. Zmiana zapisuje się od razu; e-maile transakcyjne
 * (wygrana, sprzedaż, opłacone zamówienie, decyzje o koncie z F-61) są zawsze włączone i mają
 * kłódkę zamiast przełącznika.
 * Powiadomienia w aplikacji są zawsze.
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
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`settings-${group.key}`}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <h2 id={`settings-${group.key}`} className="text-title font-extrabold">
              {t(`groups.${group.key}`)}
            </h2>
            <span aria-hidden className="text-overline text-muted-foreground uppercase">
              {t('email')}
            </span>
          </div>
          <ul>
            {group.types.map((type) => {
              const entry = email.get(type);
              const id = `email-${type}`;
              const { tone, Icon } = TYPE_TILES[type];
              return (
                <li
                  key={type}
                  className="flex items-center gap-4 border-t border-ink-100 px-5 py-4 sm:px-6"
                >
                  <IconTile tone={tone}>
                    <Icon />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <p id={`${id}-label`} className="text-title">
                      {t(`types.${type}`)}
                    </p>
                    {hasHint(type) ? (
                      <p id={`${id}-hint`} className="text-body-sm text-muted-foreground">
                        {t(`hints.${type}`)}
                      </p>
                    ) : null}
                  </div>
                  {entry?.configurable === true ? (
                    <Switch
                      id={id}
                      checked={entry.enabled}
                      aria-labelledby={`${id}-label`}
                      aria-describedby={hasHint(type) ? `${id}-hint` : undefined}
                      onCheckedChange={(checked) => {
                        void change(type, checked);
                      }}
                    />
                  ) : (
                    <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 text-caption font-bold text-ink-700">
                      <Lock aria-hidden className="size-3.5" />
                      {t('always')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {status?.kind === 'error' ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-4 py-3 text-body-sm text-destructive"
        >
          {t('error', { type: t(`types.${status.type}`) })}
        </p>
      ) : null}
      {/* Region stały, żeby czytnik ogłosił „Zapisano” po każdej zmianie. */}
      <p role="status" className="min-h-9">
        {status?.kind === 'saved' ? (
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-success-soft px-3.5 text-label text-success">
            <CircleCheck aria-hidden className="size-4" />
            {t('saved')}
          </span>
        ) : null}
      </p>
    </div>
  );
}
