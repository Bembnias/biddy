// Publiczny widok aukcji i stan licytacji użytkownika (F-18): dane strony aukcji z kilku modułów
// (przedmiot i kategoria, zdjęcia, opcje dostawy z cenami, profil sprzedawcy, zamówienie zwycięzcy) przez
// ich publiczne API. Widok publiczny nie zawiera maksimów, ceny minimalnej ani identyfikatorów
// licytujących (lider zanonimizowany).
import { anonymizeName, type DescribedAttribute, PUBLIC_ID_PATTERN } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, max } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../infra/config/index.js';
import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import {
  type CategoryCrumb,
  CategoryService,
  type ItemDetails,
  ItemService,
} from '../../catalog/index.js';
import { ProfileService, type PublicProfile } from '../../identity/index.js';
import { type MediaDescription, MediaService } from '../../media/index.js';
import { type Order, OrderService } from '../../orders/index.js';
import { type ShippingOption, ShippingQuoteService } from '../../shipping/index.js';
import {
  type Auction,
  type AuctionStatus,
  auctions,
  bids,
  watchlist,
} from '../db/auctions.schema.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Aukcje widoczne publicznie (szkic i aukcja w moderacji nie). */
const PUBLIC_STATUSES: ReadonlySet<AuctionStatus> = new Set([
  'ACTIVE',
  'ENDED_SOLD',
  'ENDED_UNSOLD',
  'CANCELLED',
]);

export type PublicAuctionStatus = 'ACTIVE' | 'ENDED_SOLD' | 'ENDED_UNSOLD' | 'CANCELLED';

export interface PublicAuctionView {
  readonly auction: Auction & { readonly status: PublicAuctionStatus };
  readonly item: ItemDetails;
  /** Zdjęcia gotowe do pokazania (READY), w kolejności. */
  readonly photos: readonly (MediaDescription & { readonly urls: Record<string, string> })[];
  readonly category: readonly CategoryCrumb[];
  readonly attributes: readonly DescribedAttribute[];
  /**
   * Opcje dostawy z cenami z cennika Biddy (F-24): akceptowani przewoźnicy, którzy pasują do
   * gabarytu i mają cenę, w kolejności wyświetlania.
   */
  readonly carriers: readonly ShippingOption[];
  readonly seller: PublicProfile;
  /** Zanonimizowany lider albo null. */
  readonly leaderName: string | null;
  /** Okno anti-snipingu (§6.5) w sekundach: „końcówka” aukcji. */
  readonly extensionWindowSeconds: number;
}

/** Wynik aukcji dla użytkownika (po zakończeniu). */
export type BiddingOutcome = 'NONE' | 'WON' | 'LOST' | 'RESERVE_NOT_MET';

export interface MyBidding {
  readonly auction: Auction;
  readonly isSeller: boolean;
  /** Obserwuje aukcję (F-20). */
  readonly watching: boolean;
  readonly hasBid: boolean;
  readonly leading: boolean;
  /** Najwyższe maksimum użytkownika (ważne oferty) albo null. */
  readonly maxAmount: number | null;
  readonly outcome: BiddingOutcome;
  /** Zamówienie zwycięzcy (tylko dla niego). */
  readonly order: Order | undefined;
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
}

function isPublic(auction: Auction): auction is Auction & { status: PublicAuctionStatus } {
  return PUBLIC_STATUSES.has(auction.status);
}

@Injectable()
export class AuctionViewService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(ShippingQuoteService) private readonly shipping: ShippingQuoteService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  /** Aukcja publiczna po UUID albo `publicId`; 404 dla niepublicznej i zablokowanego sprzedawcy. */
  async view(idOrPublicId: string): Promise<PublicAuctionView> {
    const auction = await this.find(idOrPublicId);
    const item = await this.items.get(auction.itemId);
    const seller = await this.profiles.publicProfile(auction.sellerId);
    if (item === undefined || seller === undefined) {
      throw notFound();
    }
    const [photos, category, attributes, carriers, names] = await Promise.all([
      this.media.describe(auction.sellerId, item.mediaIds),
      item.categoryId === null ? [] : this.categories.pathNodes(item.categoryId),
      item.categoryId === null
        ? []
        : this.categories.describeAttributes(item.categoryId, item.attributes),
      this.shipping.options(
        {
          packageSize: item.packageSize,
          weightGrams: item.weightGrams,
          dimensionsCm:
            item.lengthCm === null || item.widthCm === null || item.heightCm === null
              ? null
              : { length: item.lengthCm, width: item.widthCm, height: item.heightCm },
          allowedCarriers: item.allowedCarriers,
        },
        auction.currency,
      ),
      auction.leaderId === null
        ? new Map<string, string>()
        : this.profiles.displayNames([auction.leaderId]),
    ]);
    return {
      auction,
      item,
      photos: photos.flatMap((photo) =>
        photo.status === 'READY' && photo.urls !== null ? [{ ...photo, urls: photo.urls }] : [],
      ),
      category,
      attributes,
      carriers,
      seller,
      leaderName:
        auction.leaderId === null ? null : anonymizeName(names.get(auction.leaderId) ?? ''),
      extensionWindowSeconds: Math.round(this.config.auctions.antiSnipingWindowMs / 1000),
    };
  }

  /** Stan licytacji użytkownika w aukcji publicznej. */
  async myBidding(userId: string, idOrPublicId: string): Promise<MyBidding> {
    const auction = await this.find(idOrPublicId);
    const [mine] = await this.db
      .select({ bids: count(), maxAmount: max(bids.maxAmount) })
      .from(bids)
      .where(
        and(eq(bids.auctionId, auction.id), eq(bids.bidderId, userId), eq(bids.status, 'VALID')),
      );
    const [watched] = await this.db
      .select({ auctionId: watchlist.auctionId })
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.auctionId, auction.id)));
    const hasBid = (mine?.bids ?? 0) > 0;
    const leading = auction.leaderId === userId;
    const outcome = outcomeOf(auction, hasBid, leading);
    const order = outcome === 'WON' ? await this.orders.activeForAuction(auction.id) : undefined;
    return {
      auction,
      isSeller: auction.sellerId === userId,
      watching: watched !== undefined,
      hasBid,
      leading,
      maxAmount: mine?.maxAmount ?? null,
      outcome,
      order: order?.buyerId === userId ? order : undefined,
    };
  }

  private async find(idOrPublicId: string): Promise<Auction & { status: PublicAuctionStatus }> {
    let condition;
    if (UUID.test(idOrPublicId)) {
      condition = eq(auctions.id, idOrPublicId.toLowerCase());
    } else if (PUBLIC_ID_PATTERN.test(idOrPublicId)) {
      condition = eq(auctions.publicId, idOrPublicId);
    } else {
      throw notFound();
    }
    const [auction] = await this.db.select().from(auctions).where(condition);
    if (auction === undefined || !isPublic(auction)) {
      throw notFound();
    }
    return auction;
  }
}

function outcomeOf(auction: Auction, hasBid: boolean, leading: boolean): BiddingOutcome {
  if (!hasBid) {
    return 'NONE';
  }
  if (auction.status === 'ENDED_SOLD') {
    return leading ? 'WON' : 'LOST';
  }
  if (auction.status === 'ENDED_UNSOLD') {
    // Prowadził, ale cena minimalna nie została osiągnięta.
    return leading ? 'RESERVE_NOT_MET' : 'LOST';
  }
  return 'NONE';
}
