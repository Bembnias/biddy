// Saldo sprzedającego (F-27): salda z ledgera, stan wypłat, zamówienia w trakcie i historia
// ruchów salda. Wypłaty i dane do wypłat są w module payments (/v1/me/payouts,
// /v1/me/payout-profile).
import { CURRENCIES, type CurrencyCode, PAYOUT_MINIMUM } from '@biddy/shared';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { LEDGER_TRANSACTION_TYPES } from '../../ledger/index.js';
import { type PayoutBlocker, PayoutDto, payoutDto } from '../../payments/index.js';
import { ORDER_STATUSES } from '../db/orders.schema.js';
import {
  type BalanceHistory,
  type SellerBalance,
  SellerBalanceService,
} from './seller-balance.service.js';

const currency = z.enum(Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]]);
const grosze = z.int().nonnegative();

const PAYOUT_BLOCKERS = [
  'PAYOUTS_BLOCKED',
  'PAYOUT_PROFILE_INCOMPLETE',
  'PAYOUTS_ON_HOLD',
  'RECEIVABLE_OUTSTANDING',
  'SELLER_NOT_VERIFIED',
  'INSUFFICIENT_BALANCE',
  'PAYOUT_BELOW_MINIMUM',
] as const satisfies readonly PayoutBlocker['code'][];

const orderRef = z.object({
  publicId: z.string().min(1),
  title: z.string(),
  photoUrl: z.string().min(1).nullable(),
});

export class SellerBalanceDto extends createZodDto(
  z.object({
    currency,
    available: grosze.describe('Do wypłaty (seller_balance_available)'),
    inProgress: grosze.describe('Ceny opłaconych, wysłanych i odebranych zamówień'),
    receivable: grosze.describe('Należność wobec Biddy (seller_receivable)'),
    payoutsInTransit: grosze.describe('Wypłaty zlecone, jeszcze niepotwierdzone'),
    minimumPayout: grosze,
    payout: z.object({
      blocker: z
        .object({
          code: z.enum(PAYOUT_BLOCKERS),
          until: z.iso.datetime().nullable().describe('Koniec blokady (null = bez terminu)'),
          amount: grosze
            .nullable()
            .describe('Należność, saldo dostępne albo minimum (zależnie od kodu)'),
        })
        .nullable()
        .describe('Dlaczego nie da się teraz wypłacić całego salda; null = można'),
      profileComplete: z.boolean(),
      bankAccountMasked: z.string().min(1).nullable(),
      weeklyPayouts: z.boolean(),
    }),
    inProgressOrders: z.array(orderRef.extend({ status: z.enum(ORDER_STATUSES), amount: grosze })),
  }),
) {}

export class BalanceHistoryDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        id: z.uuid().describe('ID transakcji księgowej'),
        type: z.enum(LEDGER_TRANSACTION_TYPES),
        occurredAt: z.iso.datetime(),
        available: z.int().describe('Zmiana salda do wypłaty w groszach (+ uznanie, − obciążenie)'),
        receivable: z.int().describe('Zmiana należności w groszach'),
        order: orderRef.nullable(),
        payout: PayoutDto.schema.nullable(),
      }),
    ),
    nextCursor: z.uuid().nullable(),
  }),
) {}

class HistoryQuery extends createZodDto(
  z.object({ cursor: z.uuid().optional().describe('`nextCursor` z poprzedniej strony') }),
) {}

function blockerDto(blocker: PayoutBlocker | undefined): SellerBalanceDto['payout']['blocker'] {
  if (blocker === undefined) {
    return null;
  }
  switch (blocker.code) {
    case 'PAYOUTS_BLOCKED':
    case 'PAYOUTS_ON_HOLD':
      return { code: blocker.code, until: blocker.until?.toISOString() ?? null, amount: null };
    case 'RECEIVABLE_OUTSTANDING':
      return { code: blocker.code, until: null, amount: blocker.receivable };
    case 'INSUFFICIENT_BALANCE':
      return { code: blocker.code, until: null, amount: blocker.available };
    case 'PAYOUT_BELOW_MINIMUM':
      return { code: blocker.code, until: null, amount: blocker.minimum };
    case 'PAYOUT_PROFILE_INCOMPLETE':
    case 'SELLER_NOT_VERIFIED':
      return { code: blocker.code, until: null, amount: null };
  }
}

function balanceDto(balance: SellerBalance): SellerBalanceDto {
  return {
    currency: balance.balances.available.currency,
    available: balance.balances.available.amount,
    inProgress: balance.inProgressTotal.amount,
    receivable: balance.balances.receivable.amount,
    payoutsInTransit: balance.balances.payoutsInTransit.amount,
    minimumPayout: PAYOUT_MINIMUM,
    payout: {
      blocker: blockerDto(balance.blocker),
      profileComplete: balance.profileComplete,
      bankAccountMasked: balance.bankAccountMasked,
      weeklyPayouts: balance.weeklyPayouts,
    },
    inProgressOrders: balance.inProgress.map((order) => ({
      publicId: order.publicId,
      title: order.title,
      photoUrl: order.photoUrl,
      status: order.status,
      amount: order.amount.amount,
    })),
  };
}

function historyDto(history: BalanceHistory): BalanceHistoryDto {
  return {
    items: history.items.map((item) => ({
      id: item.transactionId,
      type: item.type,
      occurredAt: item.createdAt.toISOString(),
      available: item.available.amount,
      receivable: item.receivable.amount,
      order: item.order,
      payout: item.payout === null ? null : payoutDto(item.payout),
    })),
    nextCursor: history.nextCursor ?? null,
  };
}

@ApiTags('me')
@Controller('me/balance')
@RequireSession()
export class SellerBalanceController {
  constructor(private readonly balances: SellerBalanceService) {}

  @Get()
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Saldo sprzedającego: do wypłaty, w trakcie, należność, wypłaty w drodze',
    description: 'Salda z ledgera, powód blokady wypłaty i zamówienia w trakcie.',
  })
  @ZodResponse({ status: 200, description: 'Saldo', type: SellerBalanceDto })
  async getMyBalance(@CurrentUser() user: AuthenticatedUser): Promise<SellerBalanceDto> {
    return balanceDto(await this.balances.overview(user.id));
  }

  @Get('history')
  @Header('cache-control', 'private, no-store')
  @ApiOperation({
    summary: 'Historia salda: sprzedaże, wypłaty, korekty (20 na stronę)',
    description: 'Od najnowszej; kolejna strona z `cursor` = `nextCursor`.',
  })
  @ZodResponse({ status: 200, description: 'Historia salda', type: BalanceHistoryDto })
  async getMyBalanceHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: HistoryQuery,
  ): Promise<BalanceHistoryDto> {
    return historyDto(await this.balances.history(user.id, query.cursor));
  }
}
