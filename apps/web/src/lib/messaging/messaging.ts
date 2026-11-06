// Wiadomości w web (F-29): wspólne klucze zapytań do odświeżania po zdarzeniach na żywo, rodzaje
// danych kontaktowych w zdaniu ostrzeżenia i grupy dni w rozmowie.
import {
  getGetConversationQueryKey,
  getGetConversationSummaryQueryKey,
  getListConversationMessagesQueryKey,
  getListConversationsQueryKey,
} from '@biddy/api-client';
import type { ContactFlag } from '@biddy/shared';
import type { QueryClient } from '@tanstack/react-query';

import { warsawDay } from '@/lib/dates';

const LIST = new Intl.ListFormat('pl', { type: 'conjunction' });

/** Rodzaje danych w zdaniu: „numer telefonu i adres e-mail”. */
export function contactKinds(
  flags: readonly ContactFlag[],
  label: (flag: ContactFlag) => string,
): string {
  return LIST.format(flags.map(label));
}

/** Odświeżenie list i rozmowy po nowej wiadomości albo odczycie (zdarzenia na żywo, wysyłka). */
export async function refreshConversation(
  queryClient: QueryClient,
  conversationId: string,
  unreadCount?: number,
): Promise<void> {
  if (unreadCount !== undefined) {
    queryClient.setQueryData(getGetConversationSummaryQueryKey(), { unreadCount });
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) }),
    queryClient.invalidateQueries({
      queryKey: getListConversationMessagesQueryKey(conversationId),
    }),
  ]);
}

/** Wiadomości pogrupowane po dniu (Europe/Warsaw), od najstarszej. */
export function groupByDay<T extends { readonly createdAt: string }>(
  messages: readonly T[],
): { readonly day: string; readonly items: readonly T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const message of messages) {
    const day = warsawDay(new Date(message.createdAt));
    const last = groups.at(-1);
    if (last?.day === day) {
      last.items.push(message);
    } else {
      groups.push({ day, items: [message] });
    }
  }
  return groups;
}
