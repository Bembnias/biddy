// Zamówienie dla obu stron (F-26, PROJECT.md §7.2–7.4, §14.1): widok ze stanem, przesyłką
// i akcjami, „Wszystko OK”, zgłoszenie braku paczki i oferta drugiej szansy sprzedającego.
// Rolę sprawdza serwer; inni niż strony zamówienia dostają 404.
import { auctionSlug, CURRENCIES, type CurrencyCode } from '@biddy/shared';
import { Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { REFUND_REASONS, REFUND_STATUSES } from '../../payments/index.js';
import { ShipmentDto, shipmentDto } from '../../shipping/index.js';
import { ORDER_STATUSES, SECOND_CHANCE_STATUSES } from '../db/orders.schema.js';
import { COMPENSATION_DUE_MS } from '../domain/lifecycle-rules.js';
import { OrderLifecycle } from '../lifecycle/order-lifecycle.js';
import { SecondChanceService } from '../second-chance/second-chance.service.js';
import { type OrderDetails, OrderDetailsService } from './order-details.service.js';

const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();
const timestamp = z.iso.datetime();
const optionalTimestamp = timestamp.nullable();

const SECOND_CHANCE_BLOCKERS = [
  'NOT_CANCELLED_UNPAID',
  'NOT_LATEST_ORDER',
  'OFFER_PENDING',
  'WINDOW_PASSED',
  'NO_CANDIDATES',
] as const;

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

export class OrderDetailsDto extends createZodDto(
  z.object({
    id: z.uuid(),
    publicId: z.string().min(1),
    status: z.enum(ORDER_STATUSES),
    role: z.enum(['BUYER', 'SELLER']).describe('Kim jest zalogowana osoba w zamówieniu'),
    title: z.string().describe('Tytuł przedmiotu ze snapshotu'),
    photoUrl: z.string().min(1).nullable(),
    auction: z.object({ id: z.uuid(), publicId: z.string().min(1), slug: z.string().min(1) }),
    counterpart: z.object({ name: z.string() }).describe('Druga strona zamówienia'),
    currency,
    itemsTotal: grosze,
    pokFee: grosze,
    shippingFee: grosze.nullable(),
    total: grosze,
    paymentDueAt: timestamp,
    paidAt: optionalTimestamp,
    shipBy: optionalTimestamp,
    shippedAt: optionalTimestamp,
    deliveredAt: optionalTimestamp,
    inspectionEndsAt: optionalTimestamp.describe('Koniec okna 36 h na sprawdzenie przedmiotu'),
    buyerConfirmedAt: optionalTimestamp,
    completedAt: optionalTimestamp,
    cancelledAt: optionalTimestamp,
    notPickedUpAt: optionalTimestamp,
    lostAt: optionalTimestamp,
    disputedAt: optionalTimestamp.describe(
      'Zgłoszenie problemu (F-28); zostaje po rozstrzygnięciu',
    ),
    refundedAt: optionalTimestamp,
    compensation: z
      .object({ dueAt: timestamp, paidAt: optionalTimestamp })
      .nullable()
      .describe('Rekompensata za zaginioną albo uszkodzoną paczkę (tylko sprzedający)'),
    onHold: z.boolean().describe('Zakończenie wstrzymane przez chargeback'),
    fromSecondChance: z.boolean(),
    shipment: ShipmentDto.schema.nullable(),
    refund: z
      .object({
        amount: grosze,
        reason: z.enum(REFUND_REASONS),
        status: z.enum(REFUND_STATUSES),
        createdAt: timestamp,
        succeededAt: optionalTimestamp,
      })
      .nullable(),
    actions: z.object({
      confirmReceipt: z.boolean().describe('„Wszystko OK” (kupujący, paczka odebrana)'),
      reportNotReceived: z
        .object({ availableAt: timestamp, allowed: z.boolean() })
        .nullable()
        .describe('Zgłoszenie braku paczki (kupujący, paczka w drodze)'),
      openDispute: z
        .object({ until: timestamp, allowed: z.boolean() })
        .nullable()
        .describe('Zgłoszenie problemu do końca okna 36 h (kupujący, paczka odebrana, F-28)'),
    }),
    secondChance: z
      .object({
        next: z.object({ bidder: z.string(), amount: grosze }).nullable(),
        offers: z.array(
          z.object({
            id: z.uuid(),
            bidder: z.string(),
            amount: grosze,
            status: z.enum(SECOND_CHANCE_STATUSES),
            expiresAt: timestamp,
            respondedAt: optionalTimestamp,
            orderPublicId: z.string().min(1).nullable(),
          }),
        ),
        unavailableReason: z.enum(SECOND_CHANCE_BLOCKERS).nullable(),
        sendBy: optionalTimestamp,
      })
      .nullable()
      .describe('Druga szansa (tylko sprzedający zamówienia anulowanego po braku płatności)'),
  }),
) {}

const iso = (value: Date | null) => value?.toISOString() ?? null;

export function orderDetailsDto(details: OrderDetails): OrderDetailsDto {
  const { order, role, snapshot, shipment, refund, notReceived, secondChance } = details;
  const cover = snapshot.item.photos[0]?.urls;
  return {
    id: order.id,
    publicId: order.publicId,
    status: order.status,
    role,
    title: snapshot.item.title,
    photoUrl: cover?.['thumb'] ?? cover?.['medium'] ?? null,
    auction: {
      id: snapshot.auction.id,
      publicId: snapshot.auction.publicId,
      slug: auctionSlug(snapshot.item.title),
    },
    counterpart: { name: details.counterpartName },
    currency: order.currency,
    itemsTotal: order.itemsTotal,
    pokFee: order.pokFee,
    shippingFee: order.shippingFee,
    total: order.total,
    paymentDueAt: order.paymentDueAt.toISOString(),
    paidAt: iso(order.paidAt),
    shipBy: iso(order.shipBy),
    shippedAt: iso(order.shippedAt),
    deliveredAt: iso(order.deliveredAt),
    inspectionEndsAt: iso(order.inspectionEndsAt),
    buyerConfirmedAt: iso(order.buyerConfirmedAt),
    completedAt: iso(order.completedAt),
    cancelledAt: iso(order.cancelledAt),
    notPickedUpAt: iso(order.notPickedUpAt),
    lostAt: iso(order.lostAt),
    disputedAt: iso(order.disputedAt),
    refundedAt: iso(order.refundedAt),
    compensation:
      role === 'SELLER' && order.lostAt !== null
        ? {
            dueAt: new Date(order.lostAt.getTime() + COMPENSATION_DUE_MS).toISOString(),
            paidAt: iso(order.sellerCompensatedAt),
          }
        : null,
    onHold: order.chargebackStatus === 'OPEN',
    fromSecondChance: order.secondChanceOfferId !== null,
    shipment: shipment === undefined ? null : shipmentDto(shipment, role),
    refund:
      refund === undefined
        ? null
        : {
            amount: refund.amount,
            reason: refund.reason,
            status: refund.status,
            createdAt: refund.createdAt.toISOString(),
            succeededAt: iso(refund.succeededAt),
          },
    actions: {
      confirmReceipt:
        role === 'BUYER' && order.status === 'DELIVERED' && order.chargebackStatus !== 'OPEN',
      reportNotReceived:
        notReceived === null
          ? null
          : { availableAt: notReceived.from.toISOString(), allowed: notReceived.allowed },
      openDispute:
        details.openDispute === null
          ? null
          : {
              until: details.openDispute.until.toISOString(),
              allowed: details.openDispute.allowed,
            },
    },
    secondChance:
      secondChance === undefined
        ? null
        : {
            next:
              secondChance.next === null
                ? null
                : { bidder: secondChance.next.bidder, amount: secondChance.next.amount.amount },
            offers: secondChance.offers.map(({ offer, bidder, orderPublicId }) => ({
              id: offer.id,
              bidder,
              amount: offer.amount,
              status: offer.status,
              expiresAt: offer.expiresAt.toISOString(),
              respondedAt: iso(offer.respondedAt),
              orderPublicId,
            })),
            unavailableReason: secondChance.blocker ?? null,
            sendBy: iso(secondChance.sendBy),
          },
  };
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly details: OrderDetailsService,
    private readonly lifecycle: OrderLifecycle,
    private readonly secondChance: SecondChanceService,
  ) {}

  @Get(':id')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Zamówienie (kupujący albo sprzedający)',
    description: 'Stan z datami etapów, kwoty, przesyłka z trackingiem, zwrot i dostępne akcje.',
  })
  @ZodResponse({ status: 200, description: 'Zamówienie', type: OrderDetailsDto })
  async getOrder(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailsDto> {
    return orderDetailsDto(await this.details.forParticipant(params.id, user.id));
  }

  @Post(':id/confirm-receipt')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({
    summary: '„Wszystko OK” (kupujący)',
    description:
      'Kończy odebrane zamówienie i zwalnia środki sprzedającemu. Ponowienie po zakończeniu zwraca zamówienie.',
  })
  @ZodResponse({ status: 200, description: 'Zamówienie zakończone', type: OrderDetailsDto })
  async confirmReceipt(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailsDto> {
    const order = await this.lifecycle.confirmReceipt(params.id, user.id);
    return orderDetailsDto(await this.details.forParticipant(order.id, user.id));
  }

  @Post(':id/report-not-received')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Zgłoszenie braku paczki (kupujący)',
    description:
      '14 dni po nadaniu bez statusu końcowego: zamówienie zaginione, pełny zwrot i reklamacja u przewoźnika.',
  })
  @ZodResponse({ status: 200, description: 'Zgłoszenie przyjęte', type: OrderDetailsDto })
  async reportNotReceived(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailsDto> {
    const order = await this.lifecycle.reportNotReceived(params.id, user.id);
    return orderDetailsDto(await this.details.forParticipant(order.id, user.id));
  }

  @Post(':id/second-chance-offers')
  @RequireSession()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Oferta drugiej szansy (sprzedający)',
    description:
      'Do kolejnego licytującego za jego maksimum, ważna 24 h. Tylko po anulowaniu nieopłaconego zamówienia, do 14 dni.',
  })
  @ZodResponse({ status: 201, description: 'Oferta wysłana', type: OrderDetailsDto })
  async sendSecondChance(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderDetailsDto> {
    const offer = await this.secondChance.send(params.id, user.id);
    return orderDetailsDto(await this.details.forParticipant(offer.sourceOrderId, user.id));
  }
}
