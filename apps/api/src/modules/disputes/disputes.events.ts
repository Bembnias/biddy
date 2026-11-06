// Eventy domenowe modułu disputes (F-28, PROJECT.md §7.5, §14.3). Konsument: powiadomienia stron.
// Każdy event niesie zamówienie, strony i tytuł przedmiotu, żeby konsumenci nie czytali tabel sporu
// ani zamówień.
import {
  CURRENCIES,
  type CurrencyCode,
  DISPUTE_DECIDERS,
  DISPUTE_ESCALATION_CAUSES,
  DISPUTE_FAULTS,
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
} from '@biddy/shared';
import { z } from 'zod';

import { defineDomainEvent } from '../../infra/outbox/index.js';

const money = z.object({
  amount: z.int().nonnegative(),
  currency: z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]),
});

const parties = {
  orderId: z.uuid(),
  orderPublicId: z.string().min(1),
  buyerId: z.uuid(),
  sellerId: z.uuid(),
  title: z.string(),
};

/** Kupujący zgłosił problem: sprzedający ma odpowiedzieć do `responseDueAt` (48 h). */
export const DisputeOpened = defineDomainEvent({
  type: 'DisputeOpened',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({
    ...parties,
    reason: z.enum(DISPUTE_REASONS),
    responseDueAt: z.iso.datetime(),
  }),
});

/** Sprzedający proponuje zwrot części ceny: kupujący odpowiada do `responseDueAt` (48 h). */
export const DisputePartialOffered = defineDomainEvent({
  type: 'DisputePartialOffered',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({ ...parties, amount: money, responseDueAt: z.iso.datetime() }),
});

/** Spór trafił do zespołu Biddy: decyzja do `decisionDueAt` (SLA 72 h). */
export const DisputeEscalated = defineDomainEvent({
  type: 'DisputeEscalated',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({
    ...parties,
    cause: z.enum(DISPUTE_ESCALATION_CAUSES),
    decisionDueAt: z.iso.datetime(),
  }),
});

/** Zwrot z odesłaniem: kupujący nadaje przedmiot do `returnShipBy` (5 dni roboczych). */
export const DisputeReturnRequested = defineDomainEvent({
  type: 'DisputeReturnRequested',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({
    ...parties,
    returnShipBy: z.iso.datetime(),
    decidedBy: z.enum(DISPUTE_DECIDERS),
  }),
});

/** Zwrot dotarł do sprzedającego: weryfikacja do `inspectionEndsAt` (36 h). */
export const DisputeReturnDelivered = defineDomainEvent({
  type: 'DisputeReturnDelivered',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({ ...parties, inspectionEndsAt: z.iso.datetime() }),
});

/** Spór rozstrzygnięty: pieniądze rusza moduł orders w tej samej transakcji. */
export const DisputeResolved = defineDomainEvent({
  type: 'DisputeResolved',
  version: 1,
  aggregateType: 'dispute',
  payload: z.object({
    ...parties,
    outcome: z.enum(DISPUTE_OUTCOMES),
    fault: z.enum(DISPUTE_FAULTS).nullable(),
    /** Kwota dla kupującego: pełna kwota zamówienia, zwrot częściowy albo null. */
    refund: money.nullable(),
    /** Koszty dostawy potrącone sprzedającemu (wina sprzedającego). */
    sellerCosts: money.nullable(),
    decidedBy: z.enum(DISPUTE_DECIDERS),
    statement: z.string().min(1),
  }),
});
