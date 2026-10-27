// Checkout (F-25, PROJECT.md §7.2, §14.1): widok dla kupującego, wybór dostawy i płatność
// z nagłówkiem Idempotency-Key. Kwoty liczy backend; klient wysyła tylko sumę, którą widział.
import { auctionSlug, CURRENCIES, type CurrencyCode } from '@biddy/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '../../payments/index.js';
import {
  CARRIER_KINDS,
  ShippingOptionDto,
  postalAddressSchema,
  shipmentPartySchema,
  shippingOptionDto,
} from '../../shipping/index.js';
import { ORDER_STATUSES } from '../db/orders.schema.js';
import { CHECKOUT_PAYMENT_METHODS } from './checkout-rules.js';
import { CheckoutService, type CheckoutView } from './checkout.service.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,100}$/u;
const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();
const timestamp = z.iso.datetime();

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

export class ChooseDeliveryDto extends createZodDto(
  z.object({
    carrierId: z.string().min(1).max(60).describe('Usługa z opcji dostawy'),
    pickupPointId: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullable()
      .optional()
      .describe('Paczkomat albo punkt odbioru (wymagany dla tych usług)'),
    recipient: shipmentPartySchema.omit({ email: true }).extend({
      address: postalAddressSchema
        .nullable()
        .optional()
        .describe('Adres dostawy (wymagany dla kuriera)'),
    }),
  }),
) {}

export class StartPaymentDto extends createZodDto(
  z
    .object({
      method: z.enum(CHECKOUT_PAYMENT_METHODS),
      blikCode: z
        .string()
        .regex(/^\d{6}$/u, 'Kod BLIK ma 6 cyfr.')
        .nullable()
        .optional()
        .describe('Kod BLIK z aplikacji banku; bez kodu BLIK z przekierowaniem'),
      expectedTotal: grosze.describe('Suma, którą kupujący widział na przycisku (grosze)'),
    })
    .refine(
      (body) => body.method === 'BLIK' || body.blikCode === undefined || body.blikCode === null,
      {
        message: 'Kod BLIK podaje się tylko przy płatności BLIK.',
        path: ['blikCode'],
      },
    ),
) {}

export class CheckoutDto extends createZodDto(
  z.object({
    order: z.object({
      id: z.uuid(),
      publicId: z.string().min(1),
      status: z.enum(ORDER_STATUSES),
      title: z.string().describe('Tytuł przedmiotu ze snapshotu'),
      photoUrl: z.string().min(1).nullable().describe('Miniatura okładki ze snapshotu'),
      auction: z.object({ publicId: z.string().min(1), slug: z.string().min(1) }),
      currency,
      itemsTotal: grosze.describe('Wylicytowana cena'),
      pokFee: grosze.describe('Pakiet Ochrony Kupujących brutto'),
      shippingFee: grosze.nullable().describe('Dostawa; null przed wyborem'),
      total: grosze.describe('Do zapłaty: cena + POK + dostawa'),
      paymentDueAt: timestamp,
      effectiveDueAt: timestamp.describe(
        'Termin z przedłużeniem o 30 min, gdy płatność rozpoczęta przed terminem jest w toku',
      ),
      paidAt: timestamp.nullable(),
      shipBy: timestamp.nullable().describe('Termin nadania przez sprzedającego (po opłaceniu)'),
    }),
    blocker: z
      .enum(['ORDER_NOT_AWAITING_PAYMENT', 'PAYMENT_DEADLINE_PASSED', 'PAYMENT_IN_PROGRESS'])
      .nullable()
      .describe('Dlaczego nie można teraz zmienić dostawy ani zapłacić; null, gdy można'),
    options: z.array(ShippingOptionDto.schema),
    delivery: z
      .object({
        carrierId: z.string().min(1),
        name: z.string().min(1),
        kind: z.enum(CARRIER_KINDS),
        price: grosze,
        pickupPoint: z
          .object({ id: z.string().min(1), name: z.string().min(1), address: z.string() })
          .nullable(),
        recipient: z.object({
          name: z.string().min(1),
          phone: z.string().min(1),
          address: z
            .object({ street: z.string(), postalCode: z.string(), city: z.string() })
            .nullable(),
        }),
      })
      .nullable()
      .describe('Wybrana dostawa; null przed wyborem'),
    payment: z
      .object({
        id: z.uuid(),
        status: z.enum(PAYMENT_STATUSES),
        method: z.enum(PAYMENT_METHODS),
        failureReason: z.enum(PAYMENT_FAILURE_REASONS).nullable(),
        redirectUrl: z
          .string()
          .min(1)
          .nullable()
          .describe('Strona operatora dla płatności w toku z przekierowaniem'),
        amount: grosze,
        createdAt: timestamp,
      })
      .nullable()
      .describe('Ostatnia płatność zamówienia'),
    paymentMethods: z.array(z.enum(CHECKOUT_PAYMENT_METHODS)),
  }),
) {}

function checkoutDto(view: CheckoutView): CheckoutDto {
  const { order, snapshot, shipment, payment } = view;
  const cover = snapshot.item.photos[0]?.urls;
  return {
    order: {
      id: order.id,
      publicId: order.publicId,
      status: order.status,
      title: snapshot.item.title,
      photoUrl: cover?.['thumb'] ?? cover?.['medium'] ?? null,
      auction: {
        publicId: snapshot.auction.publicId,
        slug: auctionSlug(snapshot.item.title),
      },
      currency: order.currency,
      itemsTotal: order.itemsTotal,
      pokFee: order.pokFee,
      shippingFee: order.shippingFee,
      total: order.total,
      paymentDueAt: order.paymentDueAt.toISOString(),
      effectiveDueAt: view.effectiveDueAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      shipBy: order.shipBy?.toISOString() ?? null,
    },
    blocker: view.blocker,
    options: view.options.map((option) => shippingOptionDto(option, order.currency)),
    delivery:
      shipment === undefined
        ? null
        : {
            carrierId: shipment.carrier.id,
            name: shipment.carrier.name,
            kind: shipment.carrier.kind,
            price: shipment.shipment.price,
            pickupPoint: shipment.shipment.pickupPoint,
            recipient: {
              name: shipment.shipment.recipient.name,
              phone: shipment.shipment.recipient.phone,
              address:
                shipment.shipment.recipient.address === null
                  ? null
                  : {
                      street: shipment.shipment.recipient.address.street,
                      postalCode: shipment.shipment.recipient.address.postalCode,
                      city: shipment.shipment.recipient.address.city,
                    },
            },
          },
    payment:
      payment === undefined
        ? null
        : {
            id: payment.id,
            status: payment.status,
            method: payment.method,
            failureReason: payment.failureReason,
            redirectUrl: payment.redirectUrl,
            amount: payment.amount.amount,
            createdAt: payment.createdAt.toISOString(),
          },
    paymentMethods: [...CHECKOUT_PAYMENT_METHODS],
  };
}

function idempotencyKeyOf(value: string | undefined): string {
  if (value === undefined || !IDEMPOTENCY_KEY.test(value)) {
    throw new DomainError({
      code: 'VALIDATION_FAILED',
      detail: 'Brak albo błędny nagłówek Idempotency-Key.',
      errors: [
        {
          path: 'Idempotency-Key',
          code: 'custom',
          message: 'Podaj nagłówek Idempotency-Key: 1–100 znaków (litery, cyfry, _ i -).',
        },
      ],
    });
  }
  return value;
}

@ApiTags('orders')
@Controller('orders')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get(':id/checkout')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Checkout zamówienia (kupujący)',
    description:
      'Kwoty, termin płatności, opcje i wybrana dostawa, ostatnia płatność. Inni niż kupujący: 404.',
  })
  @ZodResponse({ status: 200, description: 'Checkout', type: CheckoutDto })
  async getCheckout(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutDto> {
    return checkoutDto(await this.checkout.view(params.id, user.id));
  }

  @Put(':id/delivery')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Wybór dostawy (kupujący)',
    description:
      'Usługa, punkt odbioru albo adres i odbiorca. Zapisuje cenę dostawy i nową sumę zamówienia. Tylko przed terminem i bez płatności w toku.',
  })
  @ZodResponse({ status: 200, description: 'Checkout z wybraną dostawą', type: CheckoutDto })
  async chooseDelivery(
    @Param() params: OrderParams,
    @Body() body: ChooseDeliveryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CheckoutDto> {
    const view = await this.checkout.chooseDelivery(params.id, user.id, {
      carrierId: body.carrierId,
      pickupPointId: body.pickupPointId ?? null,
      recipient: { ...body.recipient, address: body.recipient.address ?? null },
    });
    return checkoutDto(view);
  }

  @Post(':id/payments')
  @RequireSession()
  @HttpCode(201)
  @Header('cache-control', 'private, no-store')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Klucz żądania (1–100 znaków: litery, cyfry, _ i -); nowy dla każdej próby.',
  })
  @ApiOperation({
    summary: 'Płatność za zamówienie (kupujący)',
    description:
      'Zakłada płatność na sumę z zamówienia, gdy równa się expectedTotal (inaczej 409 CHECKOUT_TOTAL_CHANGED). Płatność z przekierowaniem ma redirectUrl. Ponowienie z tym samym Idempotency-Key zwraca tę samą płatność (nagłówek idempotent-replayed: true).',
  })
  @ZodResponse({ status: 201, description: 'Checkout z płatnością', type: CheckoutDto })
  async startPayment(
    @Param() params: OrderParams,
    @Body() body: StartPaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CheckoutDto> {
    const { view, replayed } = await this.checkout.startPayment(params.id, user, {
      method: body.method,
      blikCode: body.blikCode ?? null,
      expectedTotal: body.expectedTotal,
      idempotencyKey: idempotencyKeyOf(idempotencyKey),
      ip: request.ip,
    });
    if (replayed) {
      void reply.header('idempotent-replayed', 'true');
    }
    return checkoutDto(view);
  }
}
