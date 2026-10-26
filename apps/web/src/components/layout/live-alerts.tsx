'use client';

// Toasty o zdarzeniach z innych stron (F-63): przebicie, wygrana i koniec obserwowanej aukcji
// dla zalogowanych, z powiadomień na żywo (`notification.new`, room `user:{id}`). Strona tej
// samej aukcji pokazuje własne, bogatsze toasty (panel licytacji), więc tu je pomijamy.
import { useGetSession } from '@biddy/api-client';
import type { NotificationType } from '@biddy/shared';
import { type LucideIcon, Timer, TriangleAlert, Trophy } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useToast } from '@/components/providers/toast-provider';
import type { ToastTone } from '@/components/ui/toast';
import { useUserRealtimeEvents } from '@/lib/realtime/realtime-provider';

const ALERTS: Partial<
  Record<NotificationType, { readonly tone: ToastTone; readonly icon: LucideIcon }>
> = {
  OUTBID: { tone: 'urgent', icon: TriangleAlert },
  WON: { tone: 'brand', icon: Trophy },
  ENDING_SOON: { tone: 'warning', icon: Timer },
};

export function LiveAlerts() {
  const t = useTranslations('toast');
  const show = useToast();
  const pathname = usePathname();
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const signedIn = session.data?.user !== undefined && session.data.user !== null;

  useUserRealtimeEvents(
    {
      onNotification: (event) => {
        const alert = ALERTS[event.type as NotificationType];
        if (alert === undefined || event.url === pathname) {
          return;
        }
        show({
          id: `notification:${event.id}`,
          tone: alert.tone,
          icon: alert.icon,
          title: event.title,
          description: event.body,
          action: { label: t('open'), href: event.url },
          urgent: event.type === 'OUTBID',
        });
      },
    },
    signedIn,
  );

  return null;
}
