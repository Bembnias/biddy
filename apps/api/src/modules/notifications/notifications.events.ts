// Eventy domenowe modułu notifications (F-20).
import { NOTIFICATION_TYPES } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

/**
 * Powiadomienie zapisane: dostarczenie (na żywo, e-mail) po zatwierdzeniu transakcji, w której
 * powstało (konsument `notifications.deliver`).
 */
export const NotificationCreated = defineDomainEvent({
  type: 'NotificationCreated',
  version: 1,
  aggregateType: 'notification',
  payload: z.object({ userId: z.uuid(), type: z.enum(NOTIFICATION_TYPES) }),
});
