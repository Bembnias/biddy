// Eventy domenowe modułu trust-safety (PROJECT.md §14.3). `ReportCreated` (F-29): konsumenci,
// czyli potwierdzenie dla zgłaszającego i kolejka moderacji, dojdą w F-35.
import { REPORT_REASONS } from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import { REPORT_TARGET_TYPES } from './db/trust-safety.schema.js';

/** Nowe zgłoszenie DSA (notice & action): wiadomość albo użytkownik z rozmowy. */
export const ReportCreated = defineDomainEvent({
  type: 'ReportCreated',
  version: 1,
  aggregateType: 'report',
  payload: z.object({
    reporterId: z.uuid(),
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
  }),
});
