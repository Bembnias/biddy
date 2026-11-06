// DTO sporu (F-28): widok dla stron i personelu oraz body akcji. Zdjęcia mają adresy API (prywatne,
// tylko dla stron sporu i personelu), a przesyłka zwrotna widok nadawcy dla kupującego.
import {
  CURRENCIES,
  type CurrencyCode,
  DISPUTE_ACTORS,
  DISPUTE_DECIDERS,
  DISPUTE_EVENT_TYPES,
  DISPUTE_FAULTS,
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
  DISPUTE_SELLER_ACTIONS,
  DISPUTE_STATUSES,
  DISPUTE_TEXT_LIMITS,
  MAX_DISPUTE_PHOTOS,
} from '@biddy/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { REFUND_STATUSES } from '../../payments/index.js';
import {
  DispatchShipmentBody,
  ShipmentDto,
  ShippingOptionDto,
  shipmentDto,
  shippingOptionDto,
} from '../../shipping/index.js';
import type { SellerResponseInput } from '../application/dispute.service.js';
import type { DisputeView } from '../application/dispute-view.service.js';

const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();
const timestamp = z.iso.datetime();
const optionalTimestamp = timestamp.nullable();

function text(label: string, limits: { readonly min: number; readonly max: number }) {
  return z
    .string()
    .trim()
    .min(limits.min, `${label}: co najmniej ${String(limits.min)} znaków.`)
    .max(limits.max, `${label}: najwyżej ${String(limits.max)} znaków.`);
}

const mediaIds = z
  .array(z.uuid())
  .max(MAX_DISPUTE_PHOTOS, `Najwyżej ${String(MAX_DISPUTE_PHOTOS)} zdjęć.`)
  .describe('Zdjęcia DISPUTE_EVIDENCE (przetworzone, własne)');

const photo = z.object({
  id: z.uuid(),
  thumbUrl: z.url(),
  largeUrl: z.url(),
});

const disputeSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderPublicId: z.string().min(1),
  title: z.string(),
  status: z.enum(DISPUTE_STATUSES),
  role: z.enum(['BUYER', 'SELLER', 'STAFF']).describe('Kim jest oglądający'),
  reason: z.enum(DISPUTE_REASONS),
  description: z.string(),
  currency,
  itemsTotal: grosze.describe('Cena przedmiotu: najwyższy zwrot częściowy'),
  shippingFee: grosze,
  orderTotal: grosze.describe('Kwota zamówienia: pełny zwrot'),
  createdAt: timestamp,
  responseDueAt: optionalTimestamp.describe(
    'Termin odpowiedzi sprzedającego (AWAITING_SELLER) albo kupującego (PARTIAL_OFFERED)',
  ),
  escalatedAt: optionalTimestamp,
  decisionDueAt: optionalTimestamp.describe('SLA decyzji zespołu Biddy (72 h od eskalacji)'),
  partialOffer: grosze.nullable().describe('Propozycja zwrotu części ceny od sprzedającego'),
  resolution: z
    .object({
      outcome: z.enum(DISPUTE_OUTCOMES),
      fault: z.enum(DISPUTE_FAULTS).nullable(),
      refundAmount: grosze.nullable().describe('Kwota dla kupującego'),
      decidedBy: z.enum(DISPUTE_DECIDERS),
      statement: z.string().min(1).describe('Uzasadnienie widoczne dla stron (DSA)'),
      decidedAt: timestamp,
      resolvedAt: optionalTimestamp.describe('null, gdy rozstrzygnięcie czeka na zwrot'),
      sellerCosts: grosze
        .nullable()
        .describe('Dostawa w obie strony potrącona sprzedającemu (nie dla kupującego)'),
      refund: z
        .object({ status: z.enum(REFUND_STATUSES), succeededAt: optionalTimestamp })
        .nullable()
        .describe('Zwrot pieniędzy u operatora'),
    })
    .nullable(),
  return: z
    .object({
      shipBy: optionalTimestamp,
      shippedAt: optionalTimestamp,
      deliveredAt: optionalTimestamp,
      inspectionEndsAt: optionalTimestamp,
      shipment: ShipmentDto.schema
        .nullable()
        .describe('Przesyłka zwrotna (kupujący widzi ją jako nadawca)'),
    })
    .nullable()
    .describe('Zwrot z odesłaniem przedmiotu'),
  returnQuote: ShippingOptionDto.schema
    .nullable()
    .describe('Usługa i cena zwrotu (sprzedający przed odpowiedzią); null: zwrot niedostępny'),
  events: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(DISPUTE_EVENT_TYPES),
      actor: z.enum(DISPUTE_ACTORS),
      note: z.string().min(1).nullable(),
      amount: grosze.nullable(),
      photos: z.array(photo),
      createdAt: timestamp,
    }),
  ),
  actions: z.object({
    respond: z.boolean().describe('Odpowiedź sprzedającego na zgłoszenie'),
    answerOffer: z.boolean().describe('Odpowiedź kupującego na propozycję'),
    shipReturn: z.boolean().describe('Nadanie zwrotu (kupujący)'),
    reviewReturn: z.boolean().describe('Weryfikacja zwrotu (sprzedający)'),
    comment: z.boolean().describe('Wyjaśnienie strony przed rozstrzygnięciem'),
  }),
});

export class DisputeDto extends createZodDto(disputeSchema) {}

export class AdminDisputeDto extends createZodDto(
  disputeSchema.extend({
    buyerId: z.uuid(),
    sellerId: z.uuid(),
    decidedByStaffId: z.uuid().nullable(),
  }),
) {}

export class AdminDisputeListDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        id: z.uuid(),
        orderPublicId: z.string().min(1),
        title: z.string(),
        status: z.enum(DISPUTE_STATUSES),
        reason: z.enum(DISPUTE_REASONS),
        currency,
        itemsTotal: grosze,
        createdAt: timestamp,
        escalatedAt: optionalTimestamp,
        decisionDueAt: optionalTimestamp,
      }),
    ),
  }),
) {}

export class OpenDisputeBody extends createZodDto(
  z
    .object({
      reason: z.enum(DISPUTE_REASONS),
      description: text('Opis problemu', DISPUTE_TEXT_LIMITS.description),
      mediaIds: mediaIds.default([]),
    })
    .strict(),
) {}

const note = text('Notatka', DISPUTE_TEXT_LIMITS.note);

export class SellerResponseBody extends createZodDto(
  z
    .object({
      action: z
        .enum(DISPUTE_SELLER_ACTIONS)
        .describe('ACCEPT: zwrot pełnej kwoty; OFFER_PARTIAL: zwrot części ceny; REJECT: do Biddy'),
      returnRequired: z
        .boolean()
        .optional()
        .describe('ACCEPT: z odesłaniem przedmiotu (etykieta od Biddy)'),
      amount: z.int().positive().optional().describe('OFFER_PARTIAL: kwota w groszach, do ceny'),
      note: note.optional().describe('REJECT: wyjaśnienie (co najmniej 10 znaków)'),
      mediaIds: mediaIds.optional().describe('REJECT: zdjęcia'),
    })
    .strict()
    .superRefine((body, context) => {
      if (body.action === 'ACCEPT' && body.returnRequired === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['returnRequired'],
          message: 'Wybierz zwrot z odesłaniem albo bez.',
        });
      }
      if (body.action === 'OFFER_PARTIAL' && body.amount === undefined) {
        context.addIssue({ code: 'custom', path: ['amount'], message: 'Podaj kwotę zwrotu.' });
      }
      if (
        body.action === 'REJECT' &&
        (body.note?.length ?? 0) < DISPUTE_TEXT_LIMITS.explanation.min
      ) {
        context.addIssue({
          code: 'custom',
          path: ['note'],
          message: `Wyjaśnienie: co najmniej ${String(DISPUTE_TEXT_LIMITS.explanation.min)} znaków.`,
        });
      }
    }),
) {}

/** Odpowiedź sprzedającego z body po walidacji (pola zależne od akcji). */
export function sellerResponseInput(body: SellerResponseBody): SellerResponseInput {
  switch (body.action) {
    case 'ACCEPT':
      return {
        action: 'ACCEPT',
        returnRequired: body.returnRequired === true,
        ...(body.note === undefined ? {} : { note: body.note }),
      };
    case 'OFFER_PARTIAL':
      return {
        action: 'OFFER_PARTIAL',
        amount: body.amount ?? 0,
        ...(body.note === undefined ? {} : { note: body.note }),
      };
    case 'REJECT':
      return { action: 'REJECT', note: body.note ?? '', mediaIds: body.mediaIds ?? [] };
  }
}

export class OfferResponseBody extends createZodDto(
  z.object({ accept: z.boolean(), note: note.optional() }).strict(),
) {}

export class ReturnReviewBody extends createZodDto(
  z
    .object({
      accept: z.boolean().describe('false: problem ze zwrotem, spór trafia do Biddy'),
      note: note.optional().describe('Wymagane (co najmniej 10 znaków) przy accept: false'),
      mediaIds: mediaIds.optional(),
    })
    .strict(),
) {}

export class CommentBody extends createZodDto(
  z.object({ note, mediaIds: mediaIds.optional() }).strict(),
) {}

export class DecisionBody extends createZodDto(
  z
    .object({
      outcome: z.enum(DISPUTE_OUTCOMES),
      fault: z.enum(DISPUTE_FAULTS).optional().describe('Wymagane przy FULL_REFUND'),
      returnRequired: z
        .boolean()
        .optional()
        .describe('Zwrot z odesłaniem (FULL_REFUND z winy SELLER)'),
      amount: z.int().positive().optional().describe('Kwota zwrotu częściowego w groszach'),
      statement: text('Uzasadnienie', DISPUTE_TEXT_LIMITS.statement).describe(
        'Uzasadnienie widoczne dla stron (DSA)',
      ),
    })
    .strict(),
) {}

export { DispatchShipmentBody as ShipReturnBody };

/** Adresy API zdjęć ze sporu (`apiUrl` bez /v1). */
function photoUrls(apiUrl: string, disputeId: string, mediaId: string) {
  const base = `${apiUrl}/v1/disputes/${disputeId}/photos/${mediaId}`;
  return { id: mediaId, thumbUrl: `${base}/thumb`, largeUrl: `${base}/large` };
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function disputeDto(view: DisputeView, apiUrl: string): DisputeDto {
  const { dispute, viewer } = view;
  const buyer = viewer === 'BUYER';
  const seller = viewer === 'SELLER';
  const open = dispute.status !== 'RESOLVED';
  return {
    id: dispute.id,
    orderId: dispute.orderId,
    orderPublicId: dispute.orderPublicId,
    title: dispute.title,
    status: dispute.status,
    role: viewer,
    reason: dispute.reason,
    description: dispute.description,
    currency: dispute.currency,
    itemsTotal: dispute.itemsTotal,
    shippingFee: dispute.shippingFee,
    orderTotal: dispute.orderTotal,
    createdAt: dispute.createdAt.toISOString(),
    responseDueAt: iso(dispute.responseDueAt),
    escalatedAt: iso(dispute.escalatedAt),
    decisionDueAt: iso(dispute.decisionDueAt),
    partialOffer: dispute.partialOfferAmount,
    resolution:
      dispute.outcome === null ||
      dispute.decidedBy === null ||
      dispute.statement === null ||
      dispute.decidedAt === null
        ? null
        : {
            outcome: dispute.outcome,
            fault: dispute.fault,
            refundAmount: view.refundAmount?.amount ?? null,
            decidedBy: dispute.decidedBy,
            statement: dispute.statement,
            decidedAt: dispute.decidedAt.toISOString(),
            resolvedAt: iso(dispute.resolvedAt),
            sellerCosts: view.sellerCosts?.amount ?? null,
            refund:
              view.refund === undefined
                ? null
                : { status: view.refund.status, succeededAt: iso(view.refund.succeededAt) },
          },
    return:
      dispute.returnShipmentId === null
        ? null
        : {
            shipBy: iso(dispute.returnShipBy),
            shippedAt: iso(dispute.returnShippedAt),
            deliveredAt: iso(dispute.returnDeliveredAt),
            inspectionEndsAt: iso(dispute.returnInspectionEndsAt),
            // W zwrocie nadawcą jest kupujący: widzi przesyłkę jak sprzedający swoją (kod nadania,
            // etykieta), a sprzedający jako odbiorca.
            shipment:
              view.returnShipment === undefined
                ? null
                : shipmentDto(
                    view.returnShipment,
                    buyer || viewer === 'STAFF' ? 'SELLER' : 'BUYER',
                  ),
          },
    returnQuote:
      view.returnQuote === undefined || view.returnQuote === null
        ? null
        : shippingOptionDto(view.returnQuote, dispute.currency),
    events: view.events.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor,
      note: event.note === '' ? null : event.note,
      amount: event.amount,
      photos: event.mediaIds.map((mediaId) => photoUrls(apiUrl, dispute.id, mediaId)),
      createdAt: event.createdAt.toISOString(),
    })),
    actions: {
      respond: seller && dispute.status === 'AWAITING_SELLER',
      answerOffer: buyer && dispute.status === 'PARTIAL_OFFERED',
      shipReturn:
        buyer &&
        dispute.status === 'AWAITING_RETURN' &&
        view.returnShipment?.shipment.status === 'PENDING',
      reviewReturn: seller && dispute.status === 'RETURN_DELIVERED',
      comment: (buyer || seller) && open,
    },
  };
}

export function adminDisputeDto(view: DisputeView, apiUrl: string): AdminDisputeDto {
  const { dispute } = view;
  return {
    ...disputeDto(view, apiUrl),
    buyerId: dispute.buyerId,
    sellerId: dispute.sellerId,
    decidedByStaffId: dispute.decidedByStaffId,
  };
}
