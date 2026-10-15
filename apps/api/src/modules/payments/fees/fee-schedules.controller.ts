import { DEFAULT_CURRENCY, feeScheduleSchema } from '@biddy/shared';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import { FeeScheduleService } from './fee-schedule.service.js';

export class FeeScheduleDto extends createZodDto(
  feeScheduleSchema.extend({
    id: z
      .uuid()
      .describe('Identyfikator wersji cennika (zamówienie zapisuje go jako feeScheduleId)'),
    validFrom: z.iso.datetime().describe('Początek obowiązywania (włącznie)'),
    validTo: z.iso
      .datetime()
      .nullable()
      .describe('Koniec obowiązywania (wyłącznie) albo null, gdy cennik nie ma końca'),
  }),
) {}

class CurrentFeeScheduleQuery extends createZodDto(
  z.object({
    currency: feeScheduleSchema.shape.currency
      .default(DEFAULT_CURRENCY)
      .describe('Waluta cennika (domyślnie PLN)'),
  }),
) {}

/**
 * Cennik POK (F-13). Publiczny: web i mobile liczą kwotę łączną tym samym kodem z @biddy/shared
 * (`calculatePok`), a kwotę zamówienia i tak liczy backend.
 */
@ApiTags('fee-schedules')
@Controller('fee-schedules')
export class FeeSchedulesController {
  constructor(private readonly feeSchedules: FeeScheduleService) {}

  @Get('current')
  @Header('cache-control', 'public, max-age=60')
  @ApiOperation({
    summary: 'Bieżący cennik POK',
    description:
      'Opłata stała, progi krańcowe i stawka VAT. Kwoty w groszach, stawki w punktach bazowych (700 = 7%).',
  })
  @ZodResponse({ status: 200, description: 'Cennik POK', type: FeeScheduleDto })
  async getCurrentFeeSchedule(@Query() query: CurrentFeeScheduleQuery): Promise<FeeScheduleDto> {
    const schedule = await this.feeSchedules.current(query.currency);
    if (schedule === undefined) {
      throw new DomainError({ code: 'NOT_FOUND', detail: 'Brak cennika POK dla tej waluty.' });
    }
    return {
      id: schedule.id,
      currency: schedule.currency,
      fixedFee: schedule.fixedFee,
      tiers: schedule.tiers.map((tier) => ({ upTo: tier.upTo, bp: tier.bp })),
      vatRateBp: schedule.vatRateBp,
      validFrom: schedule.validFrom.toISOString(),
      validTo: schedule.validTo?.toISOString() ?? null,
    };
  }
}
