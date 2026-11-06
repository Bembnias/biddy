import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MessagesShell } from '@/components/messaging/messages-shell';
import { loadMeOrRedirect } from '@/lib/api/me';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messaging');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Wiadomości (F-29): lista rozmów; bez sesji przekierowanie na logowanie. */
export default async function MessagesPage() {
  await loadMeOrRedirect(routes.messages);
  return <MessagesShell />;
}
