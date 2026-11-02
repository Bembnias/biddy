import { auctionSlug, ITEM_CONDITIONS, PACKAGE_SIZES } from '@biddy/shared';
import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { type AuthenticatedUser, CurrentUser, RequireSession } from '../../identity/index.js';
import { type Order, ORDER_STATUSES } from '../../orders/index.js';
import { CARRIER_KINDS } from '../../shipping/index.js';
import { nextMinimumBid, reserveStatus } from '../bidding/auction-state.js';
import {
  AuctionViewService,
  type MyBidding,
  type PublicAuctionView,
} from './auction-view.service.js';
import { auctionCardDto, auctionCardSchema } from './card-dto.js';
import { MY_BIDS_FILTERS, MY_BIDS_PAGE, MyListsService } from './my-lists.service.js';

const iso = (date: Date | null) => date?.toISOString() ?? null;

/**
 * Zamówienie zwycięzcy w liście i na stronie aukcji. `total` to cena z POK bez dostawy: od F-25
 * `orders.total` po wyborze dostawy zawiera też jej cenę, a te widoki dopisują „+ dostawa”.
 */
function orderSummaryDto(order: Order) {
  return {
    id: order.id,
    publicId: order.publicId,
    status: order.status,
    currency: order.currency,
    total: order.itemsTotal + order.pokFee,
    paymentDueAt: order.paymentDueAt.toISOString(),
  };
}

export class PublicAuctionDto extends createZodDto(
  z.object({
    id: z.uuid(),
    publicId: z.string().min(1),
    slug: z.string().min(1).describe('Slug z tytułu: adres strony /a/{slug}-{publicId}'),
    status: z.enum(['ACTIVE', 'ENDED_SOLD', 'ENDED_UNSOLD', 'CANCELLED']),
    currency: z.enum(['PLN']),
    title: z.string(),
    description: z.string(),
    condition: z.enum(ITEM_CONDITIONS).nullable(),
    brand: z.string().min(1).nullable(),
    category: z
      .array(z.object({ id: z.uuid(), slug: z.string(), name: z.string() }))
      .describe('Kategorie od głównej do kategorii przedmiotu'),
    attributes: z
      .array(z.object({ key: z.string(), label: z.string(), value: z.string() }))
      .describe('Atrybuty do wyświetlenia (etykieta i wartość z jednostką)'),
    photos: z.array(
      z.object({
        id: z.uuid(),
        urls: z.object({ thumb: z.url(), medium: z.url(), large: z.url() }),
      }),
    ),
    packageSize: z.enum(PACKAGE_SIZES).nullable(),
    carriers: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(CARRIER_KINDS),
          price: z.int().min(0).describe('Cena dostawy dla kupującego w groszach (F-24)'),
        }),
      )
      .describe('Akceptowane dostawy pasujące do gabarytu, z cenami z cennika Biddy'),
    shippingFrom: z
      .int()
      .min(0)
      .nullable()
      .describe('Najtańsza dostawa („dostawa od”) w groszach; null bez opcji dostawy'),
    seller: z.object({
      id: z.uuid(),
      name: z.string(),
      avatarUrl: z.url().nullable(),
      memberSince: z.iso.datetime(),
      phoneVerified: z.boolean(),
      kind: z.enum(['PRIVATE']).describe('Osoba prywatna (w MVP tylko takie konta, §17)'),
    }),
    startPrice: z.int(),
    currentPrice: z.int().nullable().describe('Aktualna cena w groszach albo null (brak ofert)'),
    bidCount: z.int().min(0),
    leader: z
      .object({ publicName: z.string() })
      .nullable()
      .describe('Zanonimizowany lider, np. k***a'),
    minimumNextBid: z.int().nullable().describe('Najniższa kolejna oferta (null po zakończeniu)'),
    reserveStatus: z.enum(['NONE', 'NOT_MET', 'MET']),
    buyNowPrice: z.int().nullable().describe('Cena Kup teraz, tylko gdy dostępne'),
    buyNowAvailable: z.boolean(),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    version: z.int().describe('Rośnie z każdą zmianą aukcji (kolejność zdarzeń na żywo)'),
    extensionWindowSeconds: z
      .int()
      .min(0)
      .describe('Okno anti-snipingu: oferta w tym czasie przed końcem przedłuża aukcję'),
    serverTime: z.iso.datetime(),
  }),
) {}

export class MyBiddingDto extends createZodDto(
  z.object({
    auctionId: z.uuid(),
    isSeller: z.boolean().describe('Aukcja zalogowanego użytkownika'),
    watching: z.boolean().describe('Obserwujesz aukcję (F-20)'),
    hasBid: z.boolean(),
    leading: z.boolean(),
    maxAmount: z.int().nullable().describe('Twoje najwyższe maksimum (grosze) albo null'),
    outcome: z
      .enum(['NONE', 'WON', 'LOST', 'RESERVE_NOT_MET'])
      .describe('Wynik po zakończeniu; RESERVE_NOT_MET: prowadziłeś, ale bez ceny minimalnej'),
    order: z
      .object({
        id: z.uuid(),
        publicId: z.string(),
        status: z.enum(ORDER_STATUSES),
        currency: z.enum(['PLN']),
        total: z.int().describe('Do zapłaty bez dostawy (grosze)'),
        paymentDueAt: z.iso.datetime(),
      })
      .nullable()
      .describe('Zamówienie zwycięzcy'),
  }),
) {}

class AuctionIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

const orderSummary = z.object({
  id: z.uuid(),
  publicId: z.string(),
  status: z.enum(ORDER_STATUSES),
  currency: z.enum(['PLN']),
  total: z.int().describe('Do zapłaty bez dostawy (grosze)'),
  paymentDueAt: z.iso.datetime(),
});

export class MyBidsDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        auction: auctionCardSchema,
        maxAmount: z.int().describe('Twoje najwyższe maksimum (grosze)'),
        leading: z.boolean(),
        outcome: z.enum(['NONE', 'WON', 'LOST', 'RESERVE_NOT_MET']),
        order: orderSummary.nullable().describe('Zamówienie (wygrane)'),
      }),
    ),
    total: z.int().min(0),
    page: z.int().min(1),
    totalPages: z.int().min(0),
    summary: z
      .object({
        leading: z.int().min(0).describe('Aukcje, w których prowadzę'),
        outbid: z.int().min(0).describe('Aukcje, w których przebito moją ofertę'),
        endingSoon: z.int().min(0).describe('Aukcje kończące się w ciągu doby'),
      })
      .nullable()
      .describe('Podsumowanie trwających licytacji (tylko status=ACTIVE), niezależne od strony'),
  }),
) {}

class MyBidsQuery extends createZodDto(
  z.object({
    status: z.enum(MY_BIDS_FILTERS).describe('ACTIVE: trwające, WON: wygrane, LOST: przegrane'),
    page: z.coerce.number().int().min(1).max(1000).optional(),
  }),
) {}

function toPublicDto(view: PublicAuctionView): PublicAuctionDto {
  const { auction, item, seller } = view;
  const buyNowAvailable =
    auction.status === 'ACTIVE' && auction.buyNowPrice !== null && auction.bidCount === 0;
  return {
    id: auction.id,
    publicId: auction.publicId,
    slug: auctionSlug(item.title),
    status: auction.status,
    currency: auction.currency,
    title: item.title ?? '',
    description: item.description ?? '',
    condition: item.condition,
    brand: item.brand,
    category: view.category.map((crumb) => ({ ...crumb })),
    attributes: view.attributes.map((attribute) => ({ ...attribute })),
    photos: view.photos.map((photo) => ({
      id: photo.id,
      urls: {
        thumb: photo.urls['thumb'] ?? '',
        medium: photo.urls['medium'] ?? '',
        large: photo.urls['large'] ?? '',
      },
    })),
    packageSize: item.packageSize,
    carriers: view.carriers.map((option) => ({
      id: option.carrierId,
      name: option.name,
      kind: option.kind,
      price: option.price,
    })),
    shippingFrom:
      view.carriers.length === 0 ? null : Math.min(...view.carriers.map((option) => option.price)),
    seller: {
      id: seller.id,
      name: seller.name,
      avatarUrl: seller.avatarUrl,
      memberSince: seller.memberSince.toISOString(),
      phoneVerified: seller.phoneVerified,
      kind: 'PRIVATE',
    },
    startPrice: auction.startPrice ?? 0,
    currentPrice: auction.currentPrice,
    bidCount: auction.bidCount,
    leader: view.leaderName === null ? null : { publicName: view.leaderName },
    minimumNextBid: nextMinimumBid(auction),
    reserveStatus: reserveStatus(auction),
    buyNowPrice: buyNowAvailable ? auction.buyNowPrice : null,
    buyNowAvailable,
    startsAt: iso(auction.startsAt),
    endsAt: iso(auction.endsAt),
    version: auction.version,
    extensionWindowSeconds: view.extensionWindowSeconds,
    serverTime: new Date().toISOString(),
  };
}

function toMyBiddingDto(bidding: MyBidding): MyBiddingDto {
  const { order } = bidding;
  return {
    auctionId: bidding.auction.id,
    isSeller: bidding.isSeller,
    watching: bidding.watching,
    hasBid: bidding.hasBid,
    leading: bidding.leading,
    maxAmount: bidding.maxAmount,
    outcome: bidding.outcome,
    order: order === undefined ? null : orderSummaryDto(order),
  };
}

/** Strona aukcji (F-18): publiczny widok aukcji. */
@ApiTags('auctions')
@Controller('auctions')
export class PublicAuctionsController {
  constructor(private readonly views: AuctionViewService) {}

  @Get(':id')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Aukcja (widok publiczny)',
    description:
      'Identyfikator: UUID albo publicId. Aukcje aktywne, zakończone i anulowane; szkic i aukcja w moderacji: 404.',
  })
  @ZodResponse({ status: 200, description: 'Aukcja', type: PublicAuctionDto })
  async getAuction(@Param() params: AuctionIdParams): Promise<PublicAuctionDto> {
    return toPublicDto(await this.views.view(params.id));
  }
}

/** Stan licytacji zalogowanego użytkownika na stronie aukcji (F-18). */
@ApiTags('me')
@Controller('me')
@RequireSession()
export class MyBidsController {
  constructor(
    private readonly views: AuctionViewService,
    private readonly lists: MyListsService,
  ) {}

  @Get('bids')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Moje licytacje (Moje Biddy)',
    description: 'Aukcje z moimi ważnymi ofertami: trwające, wygrane albo przegrane; po 24.',
  })
  @ZodResponse({ status: 200, description: 'Licytacje', type: MyBidsDto })
  async getMyBids(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyBidsQuery,
  ): Promise<MyBidsDto> {
    const page = query.page ?? 1;
    const { items, total, summary } = await this.lists.bids(user.id, query.status, page);
    return {
      items: items.map((entry) => ({
        auction: auctionCardDto(entry.card),
        maxAmount: entry.maxAmount,
        leading: entry.leading,
        outcome: entry.outcome,
        order: entry.order === undefined ? null : orderSummaryDto(entry.order),
      })),
      total,
      page,
      totalPages: Math.ceil(total / MY_BIDS_PAGE),
      summary,
    };
  }

  @Get('bids/:id')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Mój stan w aukcji',
    description:
      'Czy prowadzisz, Twoje maksimum, wynik po zakończeniu i zamówienie zwycięzcy. Identyfikator: UUID albo publicId.',
  })
  @ZodResponse({ status: 200, description: 'Stan licytacji', type: MyBiddingDto })
  async getMyBidding(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
  ): Promise<MyBiddingDto> {
    return toMyBiddingDto(await this.views.myBidding(user.id, params.id));
  }
}
