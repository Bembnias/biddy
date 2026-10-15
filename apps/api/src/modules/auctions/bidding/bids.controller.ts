import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequireStaff,
  RequireVerifiedPhone,
} from '../../identity/index.js';
import { type Auction, AUCTION_STATUSES } from '../db/auctions.schema.js';
import { type BidOutcome, BiddingService, nextMinimumBid, reserveMet } from './bidding.service.js';

function reserveStatus(auction: Auction): 'NONE' | 'NOT_MET' | 'MET' {
  const met = reserveMet(auction);
  return met === null ? 'NONE' : met ? 'MET' : 'NOT_MET';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,100}$/u;

const amount = () => z.int().min(1).max(100_000_000_000).describe('Kwota w groszach');

export class PlaceBidDto extends createZodDto(
  z
    .object({
      maxAmount: amount().describe(
        'Maksimum licytacji automatycznej w groszach (tajne: system licytuje za Ciebie do tej kwoty)',
      ),
    })
    .strict(),
) {}

export class CancelBidDto extends createZodDto(
  z
    .object({
      reason: z.enum(['TYPO', 'FRAUD']).describe('Literówka zgłoszona do supportu albo oszustwo'),
      note: z.string().trim().min(5).max(500).describe('Uzasadnienie (do logów i audytu)'),
    })
    .strict(),
) {}

const auctionBidding = {
  id: z.uuid(),
  status: z.enum(AUCTION_STATUSES),
  currency: z.enum(['PLN']),
  currentPrice: z.int().nullable().describe('Aktualna cena w groszach albo null (brak ofert)'),
  bidCount: z.int().min(0),
  endsAt: z.iso.datetime().nullable(),
  reserveStatus: z
    .enum(['NONE', 'NOT_MET', 'MET'])
    .describe('Cena minimalna: brak, nieosiągnięta albo osiągnięta (kwota jest tajna)'),
  minimumNextBid: z.int().nullable().describe('Najniższa kolejna oferta (null po zakończeniu)'),
  buyNowAvailable: z.boolean(),
};

export class AuctionBiddingDto extends createZodDto(z.object(auctionBidding)) {}

export class BidResultDto extends createZodDto(
  z.object({
    bid: z.object({
      id: z.uuid(),
      amount: z.int(),
      maxAmount: z.int().describe('Twoje maksimum (widoczne tylko dla Ciebie)'),
      kind: z.enum(['MANUAL', 'AUTO', 'BUY_NOW']),
      createdAt: z.iso.datetime(),
    }),
    leading: z.boolean().describe('Czy prowadzisz w aukcji'),
    auction: z.object(auctionBidding),
  }),
) {}

export class BidHistoryDto extends createZodDto(
  z.object({
    currency: z.enum(['PLN']),
    items: z.array(
      z.object({
        id: z.uuid(),
        amount: z.int(),
        kind: z.enum(['MANUAL', 'AUTO', 'BUY_NOW']),
        createdAt: z.iso.datetime(),
        bidder: z.string().min(1).describe('Zanonimizowany licytujący, np. k***a'),
      }),
    ),
    nextBefore: z.int().nullable().describe('Kursor kolejnej strony (parametr before) albo null'),
  }),
) {}

export class AdminAuctionStateDto extends createZodDto(
  z.object({
    ...auctionBidding,
    leaderId: z.uuid().nullable(),
    leaderMaxAmount: z.int().nullable(),
  }),
) {}

class AuctionIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

class HistoryQuery extends createZodDto(
  z.object({
    before: z.coerce.number().int().min(1).optional().describe('Oferty starsze niż ten kursor'),
  }),
) {}

function idOf(params: AuctionIdParams, detail: string): string {
  if (!UUID.test(params.id)) {
    throw new DomainError({ code: 'NOT_FOUND', detail });
  }
  return params.id;
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

export function auctionBiddingDto(auction: Auction): AuctionBiddingDto {
  return {
    id: auction.id,
    status: auction.status,
    currency: auction.currency,
    currentPrice: auction.currentPrice,
    bidCount: auction.bidCount,
    endsAt: auction.endsAt?.toISOString() ?? null,
    reserveStatus: reserveStatus(auction),
    minimumNextBid: nextMinimumBid(auction),
    buyNowAvailable:
      auction.status === 'ACTIVE' && auction.buyNowPrice !== null && auction.bidCount === 0,
  };
}

function resultDto(outcome: BidOutcome, userId: string): BidResultDto {
  const { bid, auction } = outcome;
  return {
    bid: {
      id: bid.id,
      amount: bid.amount,
      maxAmount: bid.maxAmount,
      kind: bid.kind,
      createdAt: bid.createdAt.toISOString(),
    },
    leading: auction.leaderId === userId,
    auction: auctionBiddingDto(auction),
  };
}

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'Unikalny klucz żądania (np. UUID). Ponowienie z tym samym kluczem zwraca tę samą ofertę zamiast tworzyć nową.',
} as const;

/** Licytowanie (F-15): oferta z maksimum, Kup teraz i publiczna historia ofert. */
@ApiTags('auctions')
@Controller('auctions')
export class BidsController {
  constructor(private readonly bidding: BiddingService) {}

  @Post(':id/bids')
  @RequireVerifiedPhone()
  @Header('cache-control', 'no-store')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary: 'Oferta (licytacja automatyczna do maksimum)',
    description:
      'Ponowienie z tym samym Idempotency-Key zwraca tę samą ofertę i aktualny stan aukcji (nagłówek idempotent-replayed: true).',
  })
  @ZodResponse({ status: 201, description: 'Oferta przyjęta', type: BidResultDto })
  async placeBid(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PlaceBidDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BidResultDto> {
    const outcome = await this.bidding.placeBid(
      user.id,
      idOf(params, 'Nie znaleziono aukcji.'),
      body.maxAmount,
      idempotencyKeyOf(idempotencyKey),
    );
    if (outcome.replayed) {
      void reply.header('idempotent-replayed', 'true');
    }
    return resultDto(outcome, user.id);
  }

  @Post(':id/buy-now')
  @RequireVerifiedPhone()
  @Header('cache-control', 'no-store')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({
    summary: 'Kup teraz',
    description: 'Dostępne do pierwszej oferty; kończy aukcję jako sprzedaną.',
  })
  @ZodResponse({ status: 201, description: 'Zakup', type: BidResultDto })
  async buyNow(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BidResultDto> {
    const outcome = await this.bidding.buyNow(
      user.id,
      idOf(params, 'Nie znaleziono aukcji.'),
      idempotencyKeyOf(idempotencyKey),
    );
    if (outcome.replayed) {
      void reply.header('idempotent-replayed', 'true');
    }
    return resultDto(outcome, user.id);
  }

  @Get(':id/bids')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Historia ofert',
    description: 'Od najnowszej, po 50; licytujący zanonimizowani, bez maksimów.',
  })
  @ZodResponse({ status: 200, description: 'Oferty', type: BidHistoryDto })
  async getBidHistory(
    @Param() params: AuctionIdParams,
    @Query() query: HistoryQuery,
  ): Promise<BidHistoryDto> {
    const history = await this.bidding.history(
      idOf(params, 'Nie znaleziono aukcji.'),
      query.before,
    );
    return {
      currency: history.currency,
      items: history.items.map((item) => ({
        id: item.id,
        amount: item.amount,
        kind: item.kind,
        createdAt: item.createdAt.toISOString(),
        bidder: item.bidder,
      })),
      nextBefore: history.nextBefore,
    };
  }
}

/**
 * Unieważnienie oferty przez personel (§15.6). Do czasu panelu admina z osobną sesją (F-34)
 * rola personelu pochodzi ze zwykłej sesji konta.
 */
@ApiTags('admin')
@Controller('admin/bids')
@RequireStaff('support', 'moderator', 'admin')
export class AdminBidsController {
  constructor(private readonly bidding: BiddingService) {}

  @Post(':id/cancel')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Unieważnienie oferty i przeliczenie aukcji (replay)',
    description: 'Tylko aktywna aukcja. Koniec aukcji się nie zmienia.',
  })
  @ZodResponse({
    status: 200,
    description: 'Stan aukcji po przeliczeniu',
    type: AdminAuctionStateDto,
  })
  async cancelBid(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
    @Body() body: CancelBidDto,
  ): Promise<AdminAuctionStateDto> {
    const auction = await this.bidding.cancelBid(
      user.id,
      idOf(params, 'Nie znaleziono oferty.'),
      body.reason,
      body.note,
    );
    return {
      ...auctionBiddingDto(auction),
      leaderId: auction.leaderId,
      leaderMaxAmount: auction.leaderMaxAmount,
    };
  }
}
