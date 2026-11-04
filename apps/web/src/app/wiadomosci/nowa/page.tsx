import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  NewConversation,
  type NewConversationSubject,
} from '@/components/messaging/new-conversation';
import { loadMeOrRedirect } from '@/lib/api/me';
import { type SearchParams, searchParam } from '@/lib/page-params';
import { newConversationUrl } from '@/lib/routes';

interface PageProps {
  readonly searchParams: SearchParams;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messaging.start');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Nowa wiadomość (F-29) o aukcji (`?aukcja=`) albo zamówieniu (`?zamowienie=`): z przycisku
 * „Zapytaj sprzedającego” i ze strony zamówienia. Istniejąca rozmowa pary: przekierowanie.
 */
export default async function NewConversationPage({ searchParams }: PageProps) {
  const [auctionId, orderId] = await Promise.all([
    searchParam(searchParams, 'aukcja'),
    searchParam(searchParams, 'zamowienie'),
  ]);
  let subject: NewConversationSubject;
  let path: string;
  if (auctionId !== undefined && auctionId !== '') {
    subject = { auctionId };
    path = newConversationUrl({ auctionId });
  } else if (orderId !== undefined && orderId !== '') {
    subject = { orderId };
    path = newConversationUrl({ orderPublicId: orderId });
  } else {
    notFound();
  }
  await loadMeOrRedirect(path);
  return (
    <div className="bg-canvas">
      <div className="mx-auto w-full max-w-narrow px-4 py-8 md:px-6 md:py-12">
        <NewConversation subject={subject} />
      </div>
    </div>
  );
}
