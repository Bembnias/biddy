// Eventy domenowe modułu media (F-12). Konsument MediaFlagged: kolejka moderacji (F-35).
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';
import { MEDIA_PURPOSES } from './db/media.schema.js';

/** Zdjęcie zatrzymane przez moderację: niepubliczne, czeka na decyzję moderatora. */
export const MediaFlagged = defineDomainEvent({
  type: 'MediaFlagged',
  version: 1,
  aggregateType: 'media',
  payload: z.object({
    ownerId: z.uuid(),
    purpose: z.enum(MEDIA_PURPOSES),
    labels: z.array(z.string()),
  }),
});
