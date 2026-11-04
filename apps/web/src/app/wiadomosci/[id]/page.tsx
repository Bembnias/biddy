import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ConversationThread } from '@/components/messaging/conversation-thread';
import { MessagesShell } from '@/components/messaging/messages-shell';
import { loadMeOrRedirect } from '@/lib/api/me';
import { conversationUrl } from '@/lib/routes';

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messaging');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Rozmowa (F-29): od 1024 px z listą rozmów obok. Link z listy i z powiadomień. */
export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;
  await loadMeOrRedirect(conversationUrl(id));
  return (
    <MessagesShell activeId={id}>
      <ConversationThread conversationId={id} />
    </MessagesShell>
  );
}
