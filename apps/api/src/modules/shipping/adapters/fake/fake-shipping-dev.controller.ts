// Trasy deweloperskie FakeShipping (F-24): panel /dev/fake-shipping w web. Przesyłka testowa
// bez zamówienia przechodzi ten sam przepływ co prawdziwa (wybór dostawy, „Nadaj”, utworzenie
// w workerze, automat statusów, webhooki, tracking). Gdy FakeShipping jest wyłączony
// (produkcja), każda trasa odpowiada 404, zanim sprawdzi sesję.
import {
  Body,
  type CanActivate,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { PACKAGE_SIZES } from '@biddy/shared';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { DomainError } from '../../../../infra/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../../identity/index.js';
import { ShipmentService } from '../../application/shipment.service.js';
import { TrackingSync } from '../../application/tracking-sync.js';
import { FAKE_PARCEL_STATUSES, FAKE_SHIPPING_SCENARIOS } from '../../db/fake-shipping.schema.js';
import { DispatchShipmentBody, ShipmentDto, shipmentDto } from '../../http/shipment-dto.js';
import { type FakeParcelOverview, FakeShippingSimulator } from './fake-shipping-simulator.js';

/** 404, gdy FakeShipping nie działa w tym środowisku (produkcja). */
@Injectable()
export class FakeShippingEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.shipping.fake.enabled) {
      throw new DomainError({ code: 'NOT_FOUND' });
    }
    return true;
  }
}

const timestamp = z.iso.datetime();

export class FakeParcelDto extends createZodDto(
  z.object({
    id: z.string().describe('ID przesyłki u FakeShipping'),
    status: z.enum(FAKE_PARCEL_STATUSES).describe('Status w notacji FakeShipping'),
    scenario: z.enum(FAKE_SHIPPING_SCENARIOS),
    tracking: z.array(
      z.object({
        status: z.enum(FAKE_PARCEL_STATUSES),
        description: z.string(),
        occurredAt: timestamp,
      }),
    ),
    webhooks: z.array(
      z.object({
        id: z.string(),
        attempts: z.int().nonnegative(),
        lastError: z.string().min(1).nullable(),
        deliveredAt: timestamp.nullable(),
        createdAt: timestamp,
      }),
    ),
  }),
) {}

export class FakeShipmentDto extends createZodDto(
  z.object({
    shipment: ShipmentDto.schema,
    orderId: z.uuid().nullable().describe('Zamówienie; null dla przesyłki testowej'),
    parcel: FakeParcelDto.schema.nullable().describe('Stan u FakeShipping; null przed „Nadaj”'),
  }),
) {}

export class FakeShippingOverviewDto extends createZodDto(
  z.object({ shipments: z.array(FakeShipmentDto.schema) }),
) {}

class ShipmentParams extends createZodDto(z.object({ id: z.uuid() })) {}
class ParcelParams extends createZodDto(z.object({ id: z.string().min(1).max(100) })) {}

class CreateTestShipmentBody extends createZodDto(
  z.object({
    carrierId: z.string().min(1).max(60).describe('Usługa, np. inpost-paczkomat'),
    packageSize: z.enum(PACKAGE_SIZES),
    pickupPointId: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .describe('Punkt odbioru (paczkomat, punkt); …-NOPICKUP i …-LOST ustawiają scenariusz'),
  }),
) {}

class AdvanceParcelBody extends createZodDto(
  z.object({
    status: z
      .enum(FAKE_PARCEL_STATUSES)
      .optional()
      .describe('Wskazany status; bez niego następny według scenariusza'),
    deliverWebhook: z
      .boolean()
      .default(true)
      .describe('false: bez webhooka (zaginiony webhook, test synchronizacji)'),
  }),
) {}

class ParcelScenarioBody extends createZodDto(
  z.object({ scenario: z.enum(FAKE_SHIPPING_SCENARIOS) }),
) {}

/** Odbiorca przesyłki testowej: zalogowana osoba z numerem testowym (adres dla kuriera). */
const TEST_RECIPIENT_PHONE = '+48500600700';
const TEST_ADDRESS = { street: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa' };
/** Paczka XL przesyłki testowej mieści się w limitach kurierów (§8.2). */
const TEST_XL_PARCEL = { weightGrams: 12_000, dimensionsCm: { length: 80, width: 50, height: 40 } };

function parcelDto(overview: FakeParcelOverview): FakeParcelDto {
  return {
    id: overview.parcel.id,
    status: overview.parcel.status,
    scenario: overview.parcel.scenario,
    tracking: overview.tracking.map((entry) => ({
      status: entry.status,
      description: entry.description,
      occurredAt: entry.occurredAt.toISOString(),
    })),
    webhooks: overview.webhooks.map((webhook) => ({
      id: webhook.id,
      attempts: webhook.attempts,
      lastError: webhook.lastError,
      deliveredAt: webhook.deliveredAt?.toISOString() ?? null,
      createdAt: webhook.createdAt.toISOString(),
    })),
  };
}

/** Narzędzia deweloperskie FakeShipping; poza produkcją, dla zalogowanych. */
@ApiTags('dev')
@Controller('dev/fake-shipping')
@UseGuards(FakeShippingEnabledGuard)
export class FakeShippingDevController {
  constructor(
    private readonly simulator: FakeShippingSimulator,
    private readonly shipments: ShipmentService,
    private readonly tracking: TrackingSync,
  ) {}

  @Get()
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Panel FakeShipping',
    description: 'Najnowsze przesyłki FakeShipping ze stanem w Biddy i u dostawcy.',
  })
  @ZodResponse({ status: 200, description: 'Stan FakeShipping', type: FakeShippingOverviewDto })
  async getFakeShippingOverview(): Promise<FakeShippingOverviewDto> {
    const rows = await this.simulator.overview();
    const shipments = await Promise.all(
      rows.map(async (row) => {
        const details = await this.shipments.details(row.shipment.id);
        return details === undefined
          ? undefined
          : {
              shipment: shipmentDto(details, 'SELLER'),
              orderId: row.shipment.orderId,
              parcel: row.parcel === null ? null : parcelDto(row.parcel),
            };
      }),
    );
    return { shipments: shipments.filter((row) => row !== undefined) };
  }

  @Post('shipments')
  @RequireSession()
  @ApiOperation({
    summary: 'Nowa przesyłka testowa FakeShipping',
    description:
      'Przesyłka bez zamówienia z odbiorcą testowym; potem „Nadaj” jak dla zamówienia. Cena z cennika Biddy.',
  })
  @ZodResponse({ status: 201, description: 'Przesyłka czeka na nadanie', type: ShipmentDto })
  async createTestShipment(
    @Body() body: CreateTestShipmentBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ShipmentDto> {
    const xl = body.packageSize === 'XL';
    const details = await this.shipments.prepare({
      orderId: null,
      direction: 'OUTBOUND',
      carrierId: body.carrierId,
      parcel: {
        packageSize: body.packageSize,
        weightGrams: xl ? TEST_XL_PARCEL.weightGrams : null,
        dimensionsCm: xl ? TEST_XL_PARCEL.dimensionsCm : null,
        allowedCarriers: [body.carrierId],
      },
      currency: 'PLN',
      pickupPointId: body.pickupPointId ?? null,
      recipient: {
        name: user.name.length >= 3 ? user.name : 'Odbiorca Testowy',
        phone: TEST_RECIPIENT_PHONE,
        email: user.email,
        address: TEST_ADDRESS,
      },
    });
    return shipmentDto(details, 'SELLER');
  }

  @Post('shipments/:id/dispatch')
  @RequireSession()
  @HttpCode(202)
  @ApiOperation({
    summary: '„Nadaj” przesyłkę testową FakeShipping',
    description: 'Jak POST /orders/:id/shipment dla zamówienia: worker tworzy przesyłkę.',
  })
  @ZodResponse({ status: 202, description: 'Przesyłka w przygotowaniu', type: ShipmentDto })
  async dispatchTestShipment(
    @Param() params: ShipmentParams,
    @Body() body: DispatchShipmentBody,
  ): Promise<ShipmentDto> {
    await this.testShipment(params.id);
    const details = await this.shipments.dispatch(params.id, {
      sender: body.sender,
      dispatchMethod: body.dispatchMethod,
      declaredValue: null,
      reference: null,
    });
    return shipmentDto(details, 'SELLER');
  }

  @Get('shipments/:id/label')
  @RequireSession()
  @Header('cache-control', 'private, no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Etykieta PDF przesyłki FakeShipping' })
  @ApiOkResponse({ description: 'Etykieta', schema: { type: 'string', format: 'binary' } })
  async getTestShipmentLabel(@Param() params: ShipmentParams): Promise<StreamableFile> {
    await this.simulator.shipment(params.id);
    const pdf = await this.shipments.label(params.id);
    if (pdf === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Etykieta nie jest jeszcze gotowa.' });
    }
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="etykieta-${params.id}.pdf"`,
    });
  }

  @Post('shipments/:id/sync')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Synchronizuj tracking przesyłki FakeShipping',
    description: 'Pobiera tracking od dostawcy bez webhooka (jak polling zapasowy).',
  })
  @ZodResponse({ status: 200, description: 'Przesyłka po synchronizacji', type: ShipmentDto })
  async syncShipment(@Param() params: ShipmentParams): Promise<ShipmentDto> {
    await this.simulator.shipment(params.id);
    await this.tracking.sync(params.id);
    const details = await this.shipments.details(params.id);
    if (details === undefined) {
      throw new DomainError({ code: 'NOT_FOUND' });
    }
    return shipmentDto(details, 'SELLER');
  }

  @Post('parcels/:id/advance')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Następny albo wskazany status przesyłki FakeShipping',
    description: 'Dodaje status u dostawcy i (domyślnie) wysyła webhook. Koniec scenariusza: 409.',
  })
  @ZodResponse({ status: 200, description: 'Przesyłka u FakeShipping', type: FakeParcelDto })
  async advanceParcel(
    @Param() params: ParcelParams,
    @Body() body: AdvanceParcelBody,
  ): Promise<FakeParcelDto> {
    await this.simulator.advance(params.id, {
      ...(body.status === undefined ? {} : { status: body.status }),
      deliverWebhook: body.deliverWebhook,
    });
    return this.parcel(params.id);
  }

  @Post('parcels/:id/scenario')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({ summary: 'Zmień scenariusz automatu przesyłki FakeShipping' })
  @ZodResponse({ status: 200, description: 'Przesyłka u FakeShipping', type: FakeParcelDto })
  async setParcelScenario(
    @Param() params: ParcelParams,
    @Body() body: ParcelScenarioBody,
  ): Promise<FakeParcelDto> {
    await this.simulator.setScenario(params.id, body.scenario);
    return this.parcel(params.id);
  }

  /** Tylko przesyłka testowa (bez zamówienia): „Nadaj” zamówienia idzie przez /orders. */
  private async testShipment(shipmentId: string): Promise<void> {
    const shipment = await this.simulator.shipment(shipmentId);
    if (shipment.orderId !== null) {
      throw new DomainError({
        code: 'NOT_FOUND',
        detail: 'To nie jest przesyłka testowa: nadaj ją ze strony zamówienia.',
      });
    }
  }

  private async parcel(parcelId: string): Promise<FakeParcelDto> {
    return parcelDto(await this.simulator.parcelOverview(parcelId));
  }
}
