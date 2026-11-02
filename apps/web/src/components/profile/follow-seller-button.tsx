'use client';

import {
  type FollowStateDto,
  followSeller,
  getGetFollowStateQueryKey,
  unfollowSeller,
  useGetFollowState,
  useGetSession,
} from '@biddy/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { track } from '@/analytics/posthog';
import { Button } from '@/components/ui/button';
import { publicProfileUrl, routes, withNext } from '@/lib/routes';

/**
 * Obserwowanie sprzedawcy (F-20): powiadomienie o jego nowych aukcjach. Gość: logowanie
 * z powrotem na profil; własny profil: bez przycisku.
 */
export function FollowSellerButton({
  sellerId,
  sellerName,
}: {
  readonly sellerId: string;
  readonly sellerName: string;
}) {
  const t = useTranslations('profile.follow');
  const queryClient = useQueryClient();
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = session.isPending ? undefined : (session.data?.user ?? null);
  const state = useGetFollowState(sellerId, {
    query: { enabled: user !== undefined && user !== null && user.id !== sellerId },
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  if (user === undefined || user?.id === sellerId) {
    return null;
  }
  if (user === null) {
    return (
      <Button asChild variant="outline">
        <Link href={withNext(routes.signIn, publicProfileUrl(sellerId))}>
          <UserPlus aria-hidden />
          {t('guest')}
        </Link>
      </Button>
    );
  }
  if (state.data === undefined) {
    return null;
  }

  const following = state.data.following;
  const key = getGetFollowStateQueryKey(sellerId);
  const toggle = async () => {
    const next = !following;
    setPending(true);
    setError(false);
    queryClient.setQueryData<FollowStateDto>(key, { following: next });
    try {
      await (next ? followSeller(sellerId) : unfollowSeller(sellerId));
      track('seller_followed', { following: next });
    } catch {
      setError(true);
      queryClient.setQueryData<FollowStateDto>(key, { following });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={following ? 'outline' : 'default'}
        aria-pressed={following}
        aria-label={following ? t('unfollowLabel', { name: sellerName }) : undefined}
        disabled={pending}
        onClick={() => void toggle()}
      >
        <UserPlus aria-hidden />
        {following ? t('following') : t('follow')}
      </Button>
      {following ? null : <p className="text-body-sm text-muted-foreground">{t('hint')}</p>}
      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
