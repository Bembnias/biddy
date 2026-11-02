// Dostawa zamówienia (F-24, PROJECT.md §8.3, §14.1): opcje dostawy dla kupującego, przesyłka
// dla obu stron, „Nadaj” i etykieta dla sprzedającego. Moduł orders sprawdza rolę i stan
// zamówienia, a przesyłką zarządza moduł shipping (jego publiczne API).
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import {
  DispatchShipmentBody,
  ShipmentDto,
  ShipmentService,
  ShippingOptionDto,
  ShippingQuoteService,
  shipmentDto,
  shippingOptionDto,
} from '../../shipping/index.js';
import { ORDER_STATUSES } from '../db/orders.schema.js';
import { parcelFromSnapshot } from './order-parcel.js';
import { OrderService, type ParticipantOrder } from './order.service.js';

class OrderParams extends createZodDto(
  z.object({ id: z.string().min(1).max(64).describe('UUID albo numer zamówienia') }),
) {}

export class OrderShipmentDto extends createZodDto(
  z.object({
    order: z.object({
      id: z.uuid(),
      publicId: z.string().min(1),
      status: z.enum(ORDER_STATUSES),
      role: z.enum(['BUYER', 'SELLER']).describe('Kim jest zalogowana osoba w zamówieniu'),
      title: z.string().describe('Tytuł przedmiotu ze snapshotu'),
    }),
    shipment: ShipmentDto.schema.nullable().describe('Przesyłka; null przed wyborem dostawy'),
  }),
) {}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono zamówienia.' });
}

@ApiTags('orders')
@Controller('orders')
export class OrderShippingController {
  constructor(
    private readonly orders: OrderService,
    private readonly quotes: ShippingQuoteService,
    private readonly shipments: ShipmentService,
  ) {}

  @Get(':id/shipping-options')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Opcje dostawy zamówienia (kupujący)',
    description:
      'Usługi zaakceptowane przez sprzedającego, pasujące do gabarytu i z ceną w cenniku Biddy.',
  })
  @ZodResponse({ status: 200, description: 'Opcje dostawy', type: [ShippingOptionDto] })
  async getShippingOptions(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShippingOptionDto[]> {
    const { order, role, snapshot } = await this.orders.forParticipant(params.id, user.id);
    if (role !== 'BUYER') {
      throw notFound();
    }
    const options = await this.quotes.options(parcelFromSnapshot(snapshot), order.currency);
    return options.map((option) => shippingOptionDto(option, order.currency));
  }

  @Get(':id/shipment')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Przesyłka zamówienia',
    description:
      'Dla kupującego i sprzedającego; dane nadawcy, kod nadania i etykieta tylko dla sprzedającego.',
  })
  @ZodResponse({ status: 200, description: 'Zamówienie z przesyłką', type: OrderShipmentDto })
  async getOrderShipment(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderShipmentDto> {
    return this.view(await this.orders.forParticipant(params.id, user.id));
  }

  @Post(':id/shipment')
  @RequireSession()
  @HttpCode(202)
  @ApiOperation({
    summary: '„Nadaj” (sprzedający)',
    description:
      'Dane nadawcy i sposób nadania; worker tworzy przesyłkę u przewoźnika (kod nadania albo etykieta). Wymaga zamówienia opłaconego z wybraną dostawą; ponowne kliknięcie zwraca bieżący stan.',
  })
  @ZodResponse({ status: 202, description: 'Przesyłka w przygotowaniu', type: OrderShipmentDto })
  async dispatchOrderShipment(
    @Param() params: OrderParams,
    @Body() body: DispatchShipmentBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderShipmentDto> {
    const participant = await this.orders.forParticipant(params.id, user.id);
    const { order, role } = participant;
    if (role !== 'SELLER') {
      throw notFound();
    }
    const shipment = await this.shipments.forOrder(order.id);
    if (order.status !== 'PAID' || shipment === undefined) {
      throw new DomainError({ code: 'ORDER_NOT_AWAITING_SHIPMENT' });
    }
    await this.shipments.dispatch(shipment.shipment.id, {
      sender: body.sender,
      dispatchMethod: body.dispatchMethod,
      declaredValue: { amount: order.itemsTotal, currency: order.currency },
      reference: order.publicId,
    });
    return this.view(participant);
  }

  @Get(':id/label')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Etykieta PDF przesyłki (sprzedający)' })
  @ApiOkResponse({ description: 'Etykieta', schema: { type: 'string', format: 'binary' } })
  async getOrderLabel(
    @Param() params: OrderParams,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const { order, role } = await this.orders.forParticipant(params.id, user.id);
    const shipment = role === 'SELLER' ? await this.shipments.forOrder(order.id) : undefined;
    const pdf =
      shipment === undefined ? undefined : await this.shipments.label(shipment.shipment.id);
    if (pdf === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Etykieta nie jest jeszcze gotowa.' });
    }
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="etykieta-${order.publicId}.pdf"`,
    });
  }

  private async view({ order, role, snapshot }: ParticipantOrder): Promise<OrderShipmentDto> {
    const shipment = await this.shipments.forOrder(order.id);
    return {
      order: {
        id: order.id,
        publicId: order.publicId,
        status: order.status,
        role,
        title: snapshot.item.title,
      },
      shipment: shipment === undefined ? null : shipmentDto(shipment, role),
    };
  }
}
