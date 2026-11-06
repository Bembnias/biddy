// Eventy domenowe modułu messaging (F-29, PROJECT.md §14.3). Konsument: powiadomienia. Event niesie
// imię nadawcy i tytuł aukcji, żeby konsument nie czytał tabel rozmów, kont ani aukcji. Treści
// wiadomości nie ma w evencie (e-mail jej nie pokazuje).
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

/**
 * Wiadomości w rozmowie czekają na odczyt od 5 minut (decyzja nr 138): jedno powiadomienie na serię,
 * z kluczem z pierwszej nieprzeczytanej wiadomości. Emituje job `messaging.notify-unread`.
 */
export const MessagesUnread = defineDomainEvent({
  type: 'MessagesUnread',
  version: 1,
  aggregateType: 'conversation',
  payload: z.object({
    conversationId: z.uuid(),
    recipientId: z.uuid(),
    senderId: z.uuid(),
    senderName: z.string(),
    title: z.string(),
    firstMessageId: z.uuid(),
    count: z.int().positive(),
  }),
});
