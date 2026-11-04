'use client';

import { useGetSession } from '@biddy/api-client';
import { MessageCircleQuestion } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { newConversationUrl, routes, withNext } from '@/lib/routes';

/**
 * „Zapytaj sprzedającego” na stronie aukcji (F-29). Strona jest statyczna (ISR), więc sesję
 * sprawdza przeglądarka: sprzedający nie widzi przycisku, a gość trafia do logowania z powrotem
 * na stronę nowej wiadomości.
 */
export function AskSellerButton({
  auctionId,
  sellerId,
}: {
  readonly auctionId: string;
  readonly sellerId: string;
}) {
  const t = useTranslations('auction.seller');
  const session = useGetSession({ query: { staleTime: 60_000, retry: false } });
  const user = session.data?.user ?? null;
  if (user?.id === sellerId) {
    return null;
  }
  const target = newConversationUrl({ auctionId });
  return (
    <Button asChild variant="outline" className="w-full">
      <Link href={user === null ? withNext(routes.signIn, target) : target}>
        <MessageCircleQuestion aria-hidden />
        {t('ask')}
      </Link>
    </Button>
  );
}
