import { ITEM_CONDITIONS, LISTING_RULES, PACKAGE_SIZES, SELLER_LEVELS } from '@biddy/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse, createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { DomainError } from '../../../infra/http/index.js';
import {
  type AuthenticatedUser,
  CurrentUser,
  RequireSession,
  RequireVerifiedPhone,
} from '../../identity/index.js';
import { ORDER_STATUSES } from '../../orders/index.js';
import { AUCTION_STATUSES, REVIEW_REASONS } from '../db/auctions.schema.js';
import {
  isEditable,
  type ListingSummary,
  type ListingView,
  ListingService,
} from './listing.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Kwota w groszach. */
const amount = () => z.int().min(0).max(100_000_000_000).describe('Kwota w groszach');
const centimeters = () => z.int().min(0).max(10_000).describe('Centymetry');

/** Szkic przyjmuje teksty dłuższe niż limit publikacji, żeby autozapis nie gubił pisanego tekstu. */
const DRAFT_TITLE_MAX = 200;
const DRAFT_DESCRIPTION_MAX = 10_000;

const attributeValue = z.union([z.string().max(1000), z.number(), z.boolean()]);

export class ListingPatchDto extends createZodDto(
  z
    .object({
      categoryId: z.uuid().nullable(),
      attributes: z
        .record(z.string().min(1).max(40), attributeValue)
        .refine((values) => Object.keys(values).length <= 50, 'najwyżej 50 atrybutów'),
      title: z.string().max(DRAFT_TITLE_MAX).nullable(),
      description: z.string().max(DRAFT_DESCRIPTION_MAX).nullable(),
      condition: z.enum(ITEM_CONDITIONS).nullable(),
      brand: z.string().max(200).nullable(),
      packageSize: z.enum(PACKAGE_SIZES).nullable(),
      weightGrams: z.int().min(0).max(1_000_000).nullable().describe('Waga paczki w gramach'),
      lengthCm: centimeters().nullable(),
      widthCm: centimeters().nullable(),
      heightCm: centimeters().nullable(),
      allowedCarriers: z.array(z.string().min(1).max(60)).max(20),
      mediaIds: z
        .array(z.uuid())
        .max(LISTING_RULES.photosMax)
        .refine((ids) => new Set(ids).size === ids.length, 'zdjęcia nie mogą się powtarzać')
        .describe('Zdjęcia w kolejności (pierwsze = główne); tylko gotowe (READY)'),
      startPrice: amount().nullable(),
      reservePrice: amount().nullable(),
      buyNowPrice: amount().nullable(),
      durationDays: z.int().min(1).max(30).nullable().describe('1, 3, 5, 7 albo 10 dni'),
    })
    .partial()
    .strict(),
) {}

export class PublishListingDto extends createZodDto(
  z
    .object({
      kycNoticeAccepted: z
        .boolean()
        .optional()
        .describe(
          'Potwierdzenie informacji o weryfikacji tożsamości (wymagane przy pierwszej publikacji)',
        ),
    })
    .strict(),
) {}

const photo = z.object({
  id: z.uuid(),
  status: z.enum(['PENDING_UPLOAD', 'PROCESSING', 'READY', 'FLAGGED', 'REJECTED']),
  urls: z
    .object({ thumb: z.url(), medium: z.url(), large: z.url() })
    .nullable()
    .describe('Adresy wariantów WebP (tylko READY)'),
});

export class ListingDto extends createZodDto(
  z.object({
    id: z.uuid(),
    publicId: z.string().min(1),
    status: z.enum(AUCTION_STATUSES),
    editable: z.boolean().describe('Szkic albo aukcja bez ofert: można zmieniać'),
    bidCount: z.int().min(0),
    currency: z.enum(['PLN']),
    categoryId: z.uuid().nullable(),
    attributes: z.record(z.string(), attributeValue),
    title: z.string().min(1).nullable(),
    description: z.string().min(1).nullable(),
    condition: z.enum(ITEM_CONDITIONS).nullable(),
    brand: z.string().min(1).nullable(),
    packageSize: z.enum(PACKAGE_SIZES).nullable(),
    weightGrams: z.int().nullable(),
    lengthCm: z.int().nullable(),
    widthCm: z.int().nullable(),
    heightCm: z.int().nullable(),
    allowedCarriers: z.array(z.string()),
    photos: z.array(photo),
    startPrice: z.int().nullable(),
    reservePrice: z.int().nullable().describe('Cena minimalna (widoczna tylko dla sprzedającego)'),
    buyNowPrice: z.int().nullable(),
    durationDays: z.int().nullable(),
    reviewReasons: z.array(z.enum(REVIEW_REASONS)),
    startsAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
) {}

export class AuctionSummaryDto extends createZodDto(
  z.object({
    id: z.uuid(),
    publicId: z.string().min(1),
    status: z.enum(AUCTION_STATUSES),
    editable: z.boolean(),
    title: z.string().min(1).nullable(),
    coverUrl: z.url().nullable().describe('Miniatura zdjęcia głównego'),
    currency: z.enum(['PLN']),
    startPrice: z.int().nullable(),
    currentPrice: z.int().nullable(),
    bidCount: z.int().min(0),
    endsAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    order: z
      .object({
        id: z.uuid(),
        publicId: z.string(),
        status: z.enum(ORDER_STATUSES),
        paymentDueAt: z.iso.datetime(),
      })
      .nullable()
      .describe('Zamówienie sprzedanej aukcji (F-21)'),
  }),
) {}

export class SellingLimitsDto extends createZodDto(
  z.object({
    level: z.enum(SELLER_LEVELS).describe('Poziom sprzedawcy (§4.1)'),
    maxActiveAuctions: z.int().min(0),
    activeAuctions: z.int().min(0).describe('Aktywne i czekające na moderatora'),
    maxAuctionValue: z.int().nullable().describe('Maks. wartość aukcji w groszach albo null'),
    kycVerified: z.boolean(),
    kycRequiredAbove: z.int().describe('Wartość aukcji (grosze), powyżej której wymagane jest KYC'),
    listingBlockedUntil: z.iso.datetime().nullable(),
    kycNoticeAccepted: z.boolean().describe('Czy sprzedawca potwierdził informację o KYC'),
  }),
) {}

class AuctionIdParams extends createZodDto(z.object({ id: z.string().max(64) })) {}

class MyAuctionsQuery extends createZodDto(
  z.object({
    status: z
      .preprocess(
        // ?status=DRAFT (jedna wartość) przychodzi jako tekst, ?status=A&status=B jako tablica.
        (value) => (typeof value === 'string' ? [value] : value),
        z.array(z.enum(AUCTION_STATUSES)).max(AUCTION_STATUSES.length),
      )
      .optional()
      .describe('Filtr statusów (parametr można powtórzyć)'),
  }),
) {}

function auctionId(params: AuctionIdParams): string {
  if (!UUID.test(params.id)) {
    throw new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
  }
  return params.id;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

function toDto({ auction, item, photos }: ListingView): ListingDto {
  return {
    id: auction.id,
    publicId: auction.publicId,
    status: auction.status,
    editable: isEditable(auction),
    bidCount: auction.bidCount,
    currency: auction.currency,
    categoryId: item.categoryId,
    attributes: { ...item.attributes },
    title: item.title,
    description: item.description,
    condition: item.condition,
    brand: item.brand,
    packageSize: item.packageSize,
    weightGrams: item.weightGrams,
    lengthCm: item.lengthCm,
    widthCm: item.widthCm,
    heightCm: item.heightCm,
    allowedCarriers: [...item.allowedCarriers],
    photos: photos.map((entry) => ({
      id: entry.id,
      status: entry.status,
      urls:
        entry.urls === null
          ? null
          : {
              thumb: entry.urls['thumb'] ?? '',
              medium: entry.urls['medium'] ?? '',
              large: entry.urls['large'] ?? '',
            },
    })),
    startPrice: auction.startPrice,
    reservePrice: auction.reservePrice,
    buyNowPrice: auction.buyNowPrice,
    durationDays: auction.durationDays,
    reviewReasons: [...auction.reviewReasons],
    startsAt: iso(auction.startsAt),
    endsAt: iso(auction.endsAt),
    publishedAt: iso(auction.publishedAt),
    cancelledAt: iso(auction.cancelledAt),
    createdAt: auction.createdAt.toISOString(),
    updatedAt: auction.updatedAt.toISOString(),
  };
}

function toSummaryDto({ auction, title, coverUrl, order }: ListingSummary): AuctionSummaryDto {
  return {
    id: auction.id,
    publicId: auction.publicId,
    status: auction.status,
    editable: isEditable(auction),
    title,
    coverUrl,
    currency: auction.currency,
    startPrice: auction.startPrice,
    currentPrice: auction.currentPrice,
    bidCount: auction.bidCount,
    endsAt: iso(auction.endsAt),
    updatedAt: auction.updatedAt.toISOString(),
    order:
      order === undefined
        ? null
        : {
            id: order.id,
            publicId: order.publicId,
            status: order.status,
            paymentDueAt: order.paymentDueAt.toISOString(),
          },
  };
}

/** Wystawianie aukcji (F-14): szkic, zmiany, publikacja, anulowanie, ponowne wystawienie. */
@ApiTags('auctions')
@Controller('auctions')
export class AuctionsController {
  constructor(private readonly listings: ListingService) {}

  @Post()
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Nowy szkic aukcji' })
  @ZodResponse({ status: 201, description: 'Pusty szkic', type: ListingDto })
  async createAuctionDraft(@CurrentUser() user: AuthenticatedUser): Promise<ListingDto> {
    return toDto(await this.listings.createDraft(user.id));
  }

  @Patch(':id')
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Zmiana szkicu albo aukcji bez ofert',
    description:
      'Szkic: autozapis częściowych danych (sprawdzany tylko format pól). Aukcja aktywna bez ofert: pełna walidacja jak przy publikacji. Pominięte pole bez zmian, null czyści pole.',
  })
  @ZodResponse({ status: 200, description: 'Aukcja po zmianie', type: ListingDto })
  async updateAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
    @Body() body: ListingPatchDto,
  ): Promise<ListingDto> {
    return toDto(await this.listings.update(user.id, auctionId(params), body));
  }

  @Delete(':id')
  @RequireSession()
  @HttpCode(204)
  @ApiOperation({ summary: 'Usunięcie szkicu' })
  @ApiNoContentResponse({ description: 'Szkic usunięty' })
  async deleteAuctionDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
  ): Promise<void> {
    await this.listings.remove(user.id, auctionId(params));
  }

  @Post(':id/publish')
  @RequireVerifiedPhone()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Publikacja szkicu',
    description:
      'Wynik: ACTIVE albo PENDING_REVIEW (moderacja). Braki jako błędy pól (400 VALIDATION_FAILED).',
  })
  @ZodResponse({ status: 200, description: 'Opublikowana aukcja', type: ListingDto })
  async publishAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
    @Body() body: PublishListingDto,
  ): Promise<ListingDto> {
    return toDto(await this.listings.publish(user.id, auctionId(params), body));
  }

  @Post(':id/cancel')
  @RequireSession()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Anulowanie aukcji (§6.6)' })
  @ZodResponse({ status: 200, description: 'Aukcja anulowana', type: ListingDto })
  async cancelAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
  ): Promise<ListingDto> {
    return toDto(await this.listings.cancel(user.id, auctionId(params)));
  }

  @Post(':id/relist')
  @RequireSession()
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Ponowne wystawienie: kopia zakończonej aukcji jako szkic' })
  @ZodResponse({ status: 201, description: 'Nowy szkic', type: ListingDto })
  async relistAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
  ): Promise<ListingDto> {
    return toDto(await this.listings.relist(user.id, auctionId(params)));
  }
}

/** Aukcje sprzedającego: lista, szczegóły (z ceną minimalną) i limity (F-14). */
@ApiTags('me')
@Controller('me')
@RequireSession()
export class MyAuctionsController {
  constructor(private readonly listings: ListingService) {}

  @Get('auctions')
  @Header('cache-control', 'no-store')
  @ApiOperation({
    summary: 'Moje aukcje i szkice',
    description: 'Najnowsze zmiany najpierw, maks. 100.',
  })
  @ZodResponse({ status: 200, description: 'Aukcje', type: [AuctionSummaryDto] })
  async getMyAuctions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyAuctionsQuery,
  ): Promise<AuctionSummaryDto[]> {
    return (await this.listings.list(user.id, query.status)).map(toSummaryDto);
  }

  @Get('auctions/:id')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Moja aukcja albo szkic' })
  @ZodResponse({ status: 200, description: 'Aukcja', type: ListingDto })
  async getMyAuction(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AuctionIdParams,
  ): Promise<ListingDto> {
    return toDto(await this.listings.view(user.id, auctionId(params)));
  }

  @Get('selling-limits')
  @Header('cache-control', 'no-store')
  @ApiOperation({ summary: 'Limity sprzedawcy (§4.1)' })
  @ZodResponse({ status: 200, description: 'Limity', type: SellingLimitsDto })
  async getSellingLimits(@CurrentUser() user: AuthenticatedUser): Promise<SellingLimitsDto> {
    const { standing, activeAuctions } = await this.listings.sellingLimits(user.id);
    return {
      level: standing.level,
      maxActiveAuctions: standing.limits.maxActiveAuctions,
      activeAuctions,
      maxAuctionValue: standing.limits.maxAuctionValue,
      kycVerified: standing.kycVerified,
      kycRequiredAbove: standing.kycRequiredAbove,
      listingBlockedUntil: iso(standing.listingBlockedUntil),
      kycNoticeAccepted: standing.kycNoticeAcceptedAt !== null,
    };
  }
}
