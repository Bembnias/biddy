'use client';

import {
  type MyBiddingDto,
  type PublicAuctionDto,
  type SessionDto,
  getGetMyBiddingQueryKey,
  unwatchAuction,
  watchAuction,
} from '@biddy/api-client';
import { auctionPath } from '@biddy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { routes, withNext } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Obserwowanie aukcji (F-20): powiadomienie godzinę przed końcem. Gość: logowanie z powrotem na
 * aukcję; sprzedający i zakończona aukcja: bez przycisku. Zmiana od razu w interfejsie.
 */
export function WatchButton({
  auction,
  user,
  bidding,
}: {
  readonly auction: PublicAuctionDto;
  readonly user: NonNullable<SessionDto['user']> | null | undefined;
  readonly bidding: MyBiddingDto | undefined;
}) {
  const t = useTranslations('auction.watch');
  const queryClient = useQueryClient();
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  if (user === undefined || auction.status !== 'ACTIVE' || user?.id === auction.seller.id) {
    return null;
  }
  if (user === null) {
    return (
      <Button asChild variant="soft" className="w-full">
        <Link href={withNext(routes.signIn, auctionPath(auction.slug, auction.publicId))}>
          <Heart aria-hidden />
          {t('guest')}
        </Link>
      </Button>
    );
  }
  if (bidding === undefined || bidding.isSeller) {
    return null;
  }

  const watching = bidding.watching;
  const key = getGetMyBiddingQueryKey(auction.publicId);
  const toggle = async () => {
    const next = !watching;
    setError(false);
    setPending(true);
    queryClient.setQueryData<MyBiddingDto>(key, (current) =>
      current === undefined ? current : { ...current, watching: next },
    );
    try {
      await (next ? watchAuction(auction.id) : unwatchAuction(auction.id));
      track('auction_watched', { watching: next });
    } catch {
      setError(true);
      queryClient.setQueryData<MyBiddingDto>(key, (current) =>
        current === undefined ? current : { ...current, watching },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <Button
        type="button"
        variant="soft"
        className="w-full"
        aria-pressed={watching}
        aria-label={watching ? t('unwatchLabel') : t('watchLabel')}
        disabled={pending}
        onClick={() => void toggle()}
      >
        <Heart aria-hidden className={cn(watching && 'fill-current text-brand-strong')} />
        {watching ? t('watching') : t('watch')}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-body-sm text-destructive">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
