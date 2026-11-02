'use client';

import type { PublicAuctionDto } from '@biddy/api-client';
import { isHotAuction, isLiveAuction } from '@biddy/shared';
import { Eye, Flame } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Chip } from '@/components/ui/chip';
import { useAuctionViewers } from '@/lib/realtime/realtime-provider';

import { LiveBadge } from './live-badge';
import { useAuction, useServerNow } from './use-auction';

/** Liczbę oglądających pokazujemy od tylu osób (mniejsza nic nie mówi, a zdradza obecność). */
export const MIN_VISIBLE_VIEWERS = 3;

/**
 * Sygnały na żywo na zdjęciu aukcji (F-63): LIVE w ostatniej godzinie, „X osób ogląda” (decyzja
 * D1) i „Gorąca aukcja”. Zależą od zegara, więc pojawiają się dopiero w przeglądarce.
 */
export function AuctionSignals({ initial }: { readonly initial: PublicAuctionDto }) {
  const t = useTranslations('auction.live');
  const auction = useAuction(initial);
  const now = useServerNow();
  const viewers = useAuctionViewers(auction.status === 'ACTIVE' ? auction.id : undefined);
  if (now === null) {
    return null;
  }
  const live = isLiveAuction(auction, now);
  const hot = isHotAuction(auction, now);
  const watched = viewers !== null && viewers >= MIN_VISIBLE_VIEWERS;
  if (!live && !hot && !watched) {
    return null;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {live ? <LiveBadge /> : null}
      {watched ? (
        <Chip shape="pill" className="bg-card/95 shadow-xs">
          <Eye aria-hidden />
          {t('viewers', { count: viewers })}
        </Chip>
      ) : null}
      {hot ? (
        <Chip shape="pill" className="bg-primary text-primary-foreground shadow-xs">
          <Flame aria-hidden className="text-pink-300" />
          {t('hot')}
        </Chip>
      ) : null}
    </div>
  );
}
