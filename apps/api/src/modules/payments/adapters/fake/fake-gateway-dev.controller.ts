// Trasy deweloperskie FakeGateway (F-23, PROJECT.md §7.8): testowa strona płatności w web
// (/dev/fake-pay/:paymentId) i panel zdarzeń (/dev/fake-gateway). Gdy FakeGateway jest wyłączony
// (produkcja), każda trasa odpowiada 404, zanim sprawdzi sesję. Strona płatności działa bez
// logowania, jak strona operatora (identyfikator płatności jest trudny do odgadnięcia); panel
// wymaga sesji.
import {
  type CanActivate,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../../infra/config/index.js';
import { DomainError } from '../../../../infra/http/index.js';
import { RequireSession } from '../../../identity/index.js';
import {
  FAKE_CHARGEBACK_STATUSES,
  FAKE_PAYOUT_STATUSES,
  type FakeGatewayEventRow,
  type FakeGatewayPaymentRow,
  type FakeGatewayPayoutRow,
  type FakeGatewaySellerRow,
} from '../../db/fake-gateway.schema.js';
import {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SELLER_ACCOUNT_TYPES,
  SELLER_STATUSES,
} from '../../domain/payment-values.js';
import { isPaymentGatewayError } from '../../ports/payment-gateway.port.js';
import { FakeGatewaySimulator } from './fake-gateway-simulator.js';

/** 404, gdy FakeGateway nie działa w tym środowisku (produkcja). */
@Injectable()
export class FakeGatewayEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.payments.fake.enabled) {
      throw new DomainError({ code: 'NOT_FOUND' });
    }
    return true;
  }
}

const currency = z.enum(['PLN']);
const grosze = z.int().nonnegative();
const timestamp = z.iso.datetime();

export class FakePaymentDto extends createZodDto(
  z.object({
    id: z.string().describe('ID płatności u FakeGateway'),
    status: z.enum(PAYMENT_STATUSES),
    method: z.enum(PAYMENT_METHODS),
    currency,
    amount: grosze.describe('Kwota płatności w groszach'),
    sellerAmount: grosze.describe('Część sprzedawcy'),
    platformAmount: grosze.describe('Część Biddy (POK + dostawa)'),
    refundedAmount: grosze.describe('Suma rozliczonych zwrotów'),
    failureReason: z.enum(PAYMENT_FAILURE_REASONS).nullable(),
    returnUrl: z.string().describe('Dokąd wrócić po płatności (strona Biddy)'),
    chargebackStatus: z.enum(FAKE_CHARGEBACK_STATUSES).nullable(),
    createdAt: timestamp,
    settledAt: timestamp.nullable(),
  }),
) {}

export class FakeSellerDto extends createZodDto(
  z.object({
    id: z.string(),
    sellerRef: z.uuid().describe('Użytkownik Biddy'),
    displayName: z.string(),
    type: z.enum(SELLER_ACCOUNT_TYPES),
    status: z.enum(SELLER_STATUSES),
    currency,
    balance: z.int().describe('Saldo u operatora w groszach (może być ujemne po zwrocie)'),
    createdAt: timestamp,
  }),
) {}

export class FakePayoutDto extends createZodDto(
  z.object({
    id: z.string(),
    sellerId: z.string(),
    currency,
    amount: grosze,
    status: z.enum(FAKE_PAYOUT_STATUSES),
    createdAt: timestamp,
  }),
) {}

export class FakeWebhookEventDto extends createZodDto(
  z.object({
    id: z.string(),
    type: z.string().describe('Typ w notacji FakeGateway, np. payment.completed'),
    objectId: z.string(),
    attempts: z.int().nonnegative().describe('Liczba prób dostarczenia'),
    lastError: z.string().min(1).nullable().describe('Błąd ostatniej nieudanej próby'),
    deliveredAt: timestamp.nullable(),
    createdAt: timestamp,
  }),
) {}

export class FakeGatewayOverviewDto extends createZodDto(
  z.object({
    payments: z.array(FakePaymentDto.schema),
    sellers: z.array(FakeSellerDto.schema),
    payouts: z.array(FakePayoutDto.schema),
    events: z.array(FakeWebhookEventDto.schema),
  }),
) {}

class FakeObjectParams extends createZodDto(z.object({ id: z.string().min(1).max(100) })) {}

class CompleteFakePaymentBody extends createZodDto(
  z.object({
    outcome: z.enum(['SUCCEEDED', 'FAILED']).describe('Wynik wybrany przez kupującego'),
    deliverWebhook: z
      .boolean()
      .default(true)
      .describe('false: rozliczenie bez webhooka (zaginiony webhook, test pollingu)'),
  }),
) {}

class FakeChargebackBody extends createZodDto(
  z.object({ action: z.enum(['OPEN', 'WON', 'LOST']).describe('Otwarcie albo wynik chargebacku') }),
) {}

class FakeSellerStatusBody extends createZodDto(z.object({ status: z.enum(SELLER_STATUSES) })) {}

function paymentDto(row: FakeGatewayPaymentRow): FakePaymentDto {
  return {
    id: row.id,
    status: row.status,
    method: row.method,
    currency: row.currency,
    amount: row.amount,
    sellerAmount: row.sellerAmount,
    platformAmount: row.platformAmount,
    refundedAmount: row.refundedAmount,
    failureReason: row.failureReason,
    returnUrl: row.returnUrl,
    chargebackStatus: row.chargebackStatus,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}

function sellerDto(row: FakeGatewaySellerRow): FakeSellerDto {
  return {
    id: row.id,
    sellerRef: row.sellerRef,
    displayName: row.displayName,
    type: row.type,
    status: row.status,
    currency: row.currency,
    balance: row.balance,
    createdAt: row.createdAt.toISOString(),
  };
}

function payoutDto(row: FakeGatewayPayoutRow): FakePayoutDto {
  return {
    id: row.id,
    sellerId: row.sellerId,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function eventDto(row: FakeGatewayEventRow): FakeWebhookEventDto {
  return {
    id: row.id,
    type: row.type,
    objectId: row.objectId,
    attempts: row.attempts,
    lastError: row.lastError,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Błędy symulatora jako odpowiedzi: nieznany obiekt 404, operacja niezgodna ze stanem 409. */
async function simulated<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPaymentGatewayError(error, 'NOT_FOUND')) {
      throw new DomainError({ code: 'NOT_FOUND', detail: error.message, cause: error });
    }
    if (isPaymentGatewayError(error)) {
      throw new DomainError({ code: 'CONFLICT', detail: error.message, cause: error });
    }
    throw error;
  }
}

/** Narzędzia deweloperskie FakeGateway; poza produkcją. */
@ApiTags('dev')
@Controller('dev/fake-gateway')
@UseGuards(FakeGatewayEnabledGuard)
export class FakeGatewayDevController {
  constructor(private readonly simulator: FakeGatewaySimulator) {}

  @Get('payments/:id')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Płatność FakeGateway (testowa strona płatności)',
    description: 'Bez logowania, jak strona operatora. 404, gdy FakeGateway jest wyłączony.',
  })
  @ZodResponse({ status: 200, description: 'Płatność', type: FakePaymentDto })
  async getFakePayment(@Param() params: FakeObjectParams): Promise<FakePaymentDto> {
    return paymentDto(await simulated(() => this.simulator.payment(params.id)));
  }

  @Post('payments/:id/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Zapłać albo odrzuć płatność FakeGateway',
    description:
      'Rozlicza płatność w toku i (domyślnie) wysyła webhook. Płatność już rozliczona: 409.',
  })
  @ZodResponse({ status: 200, description: 'Rozliczona płatność', type: FakePaymentDto })
  async completeFakePayment(
    @Param() params: FakeObjectParams,
    @Body() body: CompleteFakePaymentBody,
  ): Promise<FakePaymentDto> {
    const row = await simulated(() =>
      this.simulator.settlePayment(params.id, body.outcome, { deliver: body.deliverWebhook }),
    );
    return paymentDto(row);
  }

  @Get()
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Panel FakeGateway',
    description: 'Najnowsze płatności, sprzedawcy, wypłaty i webhooki ze stanem dostarczenia.',
  })
  @ZodResponse({ status: 200, description: 'Stan FakeGateway', type: FakeGatewayOverviewDto })
  async getFakeGatewayOverview(): Promise<FakeGatewayOverviewDto> {
    const overview = await this.simulator.overview();
    return {
      payments: overview.payments.map(paymentDto),
      sellers: overview.sellers.map(sellerDto),
      payouts: overview.payouts.map(payoutDto),
      events: overview.events.map(eventDto),
    };
  }

  @Post('payments/:id/chargeback')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({ summary: 'Chargeback płatności FakeGateway (otwarcie albo wynik)' })
  @ZodResponse({ status: 200, description: 'Płatność ze stanem chargebacku', type: FakePaymentDto })
  async fakeChargeback(
    @Param() params: FakeObjectParams,
    @Body() body: FakeChargebackBody,
  ): Promise<FakePaymentDto> {
    return paymentDto(await simulated(() => this.simulator.chargeback(params.id, body.action)));
  }

  @Post('payouts/:id/fail')
  @RequireSession()
  @HttpCode(204)
  @ApiOperation({ summary: 'Odrzuć wypłatę FakeGateway (kwota wraca na saldo)' })
  @ApiNoContentResponse({ description: 'Wypłata odrzucona, webhook w drodze' })
  async failFakePayout(@Param() params: FakeObjectParams): Promise<void> {
    await simulated(() => this.simulator.failPayout(params.id));
  }

  @Post('sellers/:id/status')
  @RequireSession()
  @HttpCode(200)
  @ApiOperation({ summary: 'Zmień status weryfikacji sprzedawcy FakeGateway (symulacja KYC)' })
  @ZodResponse({ status: 200, description: 'Sprzedawca', type: FakeSellerDto })
  async setFakeSellerStatus(
    @Param() params: FakeObjectParams,
    @Body() body: FakeSellerStatusBody,
  ): Promise<FakeSellerDto> {
    return sellerDto(await simulated(() => this.simulator.setSellerStatus(params.id, body.status)));
  }

  @Post('events/:id/redeliver')
  @RequireSession()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Wyślij ponownie webhook FakeGateway',
    description: 'To samo zdarzenie drugi raz: API pominie je jako przetworzone.',
  })
  @ApiNoContentResponse({ description: 'Webhook w kolejce' })
  async redeliverFakeEvent(@Param() params: FakeObjectParams): Promise<void> {
    await simulated(() => this.simulator.redeliver(params.id));
  }
}
