// Wystawianie aukcji (F-14): szkic, autozapis, publikacja, edycja przed pierwszą ofertą,
// anulowanie i ponowne wystawienie. Każda zmiana blokuje wiersz aukcji (FOR UPDATE) i woła
// publiczne API innych modułów w tej samej transakcji, więc nie przeplecie się z pierwszą
// ofertą (F-15 blokuje ten sam wiersz). Reguły kompletności i cen: `validateListing` z @biddy/shared.
import { type ListingInput, type ListingIssue, validateListing } from '@biddy/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { type Database, DRIZZLE, newPublicId, type Transaction } from '../../../infra/db/index.js';
import { DomainError } from '../../../infra/http/index.js';
import { Outbox } from '../../../infra/outbox/index.js';
import {
  CategoryService,
  type CategorySchema,
  type ItemDetails,
  type ItemPatch,
  ItemService,
} from '../../catalog/index.js';
import { type SellerStanding, SellerStandingService } from '../../identity/index.js';
import { type MediaDescription, MediaService } from '../../media/index.js';
import { CarrierService } from '../../shipping/index.js';
import { ContentFilterService } from '../../trust-safety/index.js';
import {
  AuctionCancelled,
  AuctionPublished,
  AuctionSubmittedForReview,
  AuctionUpdated,
} from '../auctions.events.js';
import {
  type Auction,
  type AuctionStatus,
  type ReviewReason,
  auctions,
} from '../db/auctions.schema.js';

/** Limit szkiców na konto (ochrona przed zaśmiecaniem bazy). */
export const MAX_DRAFTS = 50;
/** Aukcji z ofertami nie można anulować w ostatnich 12 h (§6.6). */
const CANCEL_LOCK_MS = 12 * 60 * 60 * 1_000;
/** Statusy liczone do limitu aktywnych aukcji. */
const ACTIVE_STATUSES: AuctionStatus[] = ['ACTIVE', 'PENDING_REVIEW'];
const ENDED_STATUSES: AuctionStatus[] = ['ENDED_SOLD', 'ENDED_UNSOLD', 'CANCELLED'];

export interface ListingView {
  readonly auction: Auction;
  readonly item: ItemDetails;
  /** Zdjęcia w kolejności, z adresami wariantów. */
  readonly photos: readonly MediaDescription[];
}

export interface ListingSummary {
  readonly auction: Auction;
  readonly title: string | null;
  /** Miniatura zdjęcia głównego albo null. */
  readonly coverUrl: string | null;
}

/** Zmiana szkicu albo aukcji: pola przedmiotu i parametry aukcji (null czyści pole). */
export interface ListingPatch extends ItemPatch {
  startPrice?: number | null;
  reservePrice?: number | null;
  buyNowPrice?: number | null;
  durationDays?: number | null;
}

export interface SellingLimits {
  readonly standing: SellerStanding;
  readonly activeAuctions: number;
}

/** Szkic albo aukcja bez ofert (aktywna lub w moderacji) da się zmienić. */
export function isEditable(auction: Pick<Auction, 'status' | 'bidCount'>): boolean {
  return (
    auction.status === 'DRAFT' ||
    (ACTIVE_STATUSES.includes(auction.status) && auction.bidCount === 0)
  );
}

function conflict(detail: string): DomainError {
  return new DomainError({ code: 'CONFLICT', detail });
}

function notFound(): DomainError {
  return new DomainError({ code: 'NOT_FOUND', detail: 'Nie znaleziono aukcji.' });
}

function invalid(issues: readonly ListingIssue[], detail = 'Uzupełnij albo popraw ofertę.') {
  return new DomainError({
    code: 'VALIDATION_FAILED',
    detail,
    errors: issues.map((issue) => ({ path: issue.path, code: 'custom', message: issue.message })),
  });
}

/** Słowo z listy filtra do pokazania użytkownikowi (bez gwiazdki odmiany). */
const shownTerm = (term: string) => term.replace(/\*/gu, '');

interface ListingCheck {
  readonly issues: ListingIssue[];
  readonly category: CategorySchema | undefined;
  readonly reviewReasons: ReviewReason[];
  /** Słowa z werdyktem REVIEW według pól. */
  readonly reviewMatches: readonly { readonly field: string; readonly term: string }[];
}

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(CarrierService) private readonly carriers: CarrierService,
    @Inject(SellerStandingService) private readonly standing: SellerStandingService,
    @Inject(ContentFilterService) private readonly filter: ContentFilterService,
    private readonly outbox: Outbox,
  ) {}

  /** Nowy pusty szkic. */
  async createDraft(sellerId: string): Promise<ListingView> {
    return this.db.transaction(async (tx) => {
      await this.lockSeller(tx, sellerId);
      await this.assertDraftRoom(tx, sellerId);
      const item = await this.items.create(sellerId, tx);
      const auction = await this.insertAuction(tx, { sellerId, itemId: item.id });
      return { auction, item, photos: [] };
    });
  }

  /** Szkic albo aukcja sprzedającego; cudza albo nieistniejąca: 404. */
  async view(sellerId: string, auctionId: string): Promise<ListingView> {
    const [auction] = await this.db
      .select()
      .from(auctions)
      .where(and(eq(auctions.id, auctionId), eq(auctions.sellerId, sellerId)));
    if (auction === undefined) {
      throw notFound();
    }
    return this.toView(auction);
  }

  /** Aukcje sprzedającego, najnowsze zmiany najpierw (maks. 100). */
  async list(sellerId: string, statuses?: readonly AuctionStatus[]): Promise<ListingSummary[]> {
    const rows = await this.db
      .select()
      .from(auctions)
      .where(
        and(
          eq(auctions.sellerId, sellerId),
          statuses === undefined || statuses.length === 0
            ? undefined
            : inArray(auctions.status, [...statuses]),
        ),
      )
      .orderBy(desc(auctions.updatedAt), desc(auctions.id))
      .limit(100);
    const itemsById = new Map(
      (await this.items.getMany(rows.map((row) => row.itemId))).map((item) => [item.id, item]),
    );
    const covers = rows.flatMap((row) => itemsById.get(row.itemId)?.mediaIds[0] ?? []);
    const coverUrls = new Map(
      (await this.media.describe(sellerId, covers)).map((photo) => [
        photo.id,
        photo.urls?.['thumb'],
      ]),
    );
    return rows.map((auction) => {
      const item = itemsById.get(auction.itemId);
      const cover = item?.mediaIds[0];
      return {
        auction,
        title: item?.title ?? null,
        coverUrl: (cover === undefined ? undefined : coverUrls.get(cover)) ?? null,
      };
    });
  }

  /**
   * Autozapis szkicu (tylko format pól) albo zmiana aukcji bez ofert (pełna walidacja jak przy
   * publikacji). Z ofertami: 409 AUCTION_HAS_BIDS.
   */
  async update(sellerId: string, auctionId: string, patch: ListingPatch): Promise<ListingView> {
    return this.db.transaction(async (tx) => {
      const auction = await this.lock(tx, sellerId, auctionId);
      if (ENDED_STATUSES.includes(auction.status)) {
        throw conflict('Zakończonej albo anulowanej aukcji nie można zmienić.');
      }
      const published = auction.status !== 'DRAFT';
      if (published && auction.bidCount > 0) {
        throw new DomainError({ code: 'AUCTION_HAS_BIDS' });
      }
      if (
        published &&
        patch.durationDays !== undefined &&
        patch.durationDays !== auction.durationDays
      ) {
        throw invalid([
          { path: 'durationDays', message: 'Czasu trwania nie można zmienić po publikacji.' },
        ]);
      }
      if (patch.categoryId !== undefined && patch.categoryId !== null) {
        const category = await this.categories.schema(patch.categoryId);
        if (category === undefined) {
          throw invalid([
            {
              path: 'categoryId',
              message: 'Ta kategoria nie istnieje albo nie jest już dostępna.',
            },
          ]);
        }
      }

      const { startPrice, reservePrice, buyNowPrice, durationDays, ...itemPatch } = patch;
      const { item, addedMediaIds, releasedMediaIds } = await this.items.update(
        auction.itemId,
        itemPatch,
        tx,
      );
      await this.media.attach(sellerId, addedMediaIds, 'ITEM_PHOTO', tx);
      await this.media.detach(sellerId, releasedMediaIds, tx);

      const [updated] = await tx
        .update(auctions)
        .set({
          ...(startPrice === undefined ? {} : { startPrice }),
          ...(reservePrice === undefined ? {} : { reservePrice }),
          ...(buyNowPrice === undefined ? {} : { buyNowPrice }),
          ...(durationDays === undefined ? {} : { durationDays }),
          version: sql`${auctions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (updated === undefined) {
        throw notFound();
      }

      if (published) {
        const standing = await this.standing.get(sellerId, tx);
        const check = await this.check(tx, sellerId, updated, item, standing);
        const issues = [...check.issues];
        if (updated.status === 'ACTIVE') {
          // Zmiana, która wymaga moderacji, nie może trafić do aukcji widocznej dla kupujących.
          for (const match of check.reviewMatches) {
            issues.push({
              path: match.field,
              message: `„${shownTerm(match.term)}” wymaga sprawdzenia przez moderatora. Zmień opis albo anuluj aukcję i wystaw ją ponownie.`,
            });
          }
          if (check.reviewReasons.includes('RESTRICTED_CATEGORY')) {
            issues.push({
              path: 'categoryId',
              message:
                'Oferty w tej kategorii sprawdza moderator. Anuluj aukcję i wystaw ją ponownie w tej kategorii.',
            });
          }
        }
        if (issues.length > 0) {
          throw invalid(issues, 'Popraw aukcję: zmiany nie zostały zapisane.');
        }
        if (updated.status === 'ACTIVE') {
          await this.outbox.add(
            tx,
            AuctionUpdated.create({
              aggregateId: updated.id,
              payload: { sellerId, version: updated.version },
            }),
          );
        }
      }
      return this.toView(updated, tx);
    });
  }

  /** Usuwa szkic; zdjęcia, których nie używa inny przedmiot, wracają do sprzątania. */
  async remove(sellerId: string, auctionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const auction = await this.lock(tx, sellerId, auctionId);
      if (auction.status !== 'DRAFT') {
        throw conflict('Usunąć można tylko szkic. Opublikowaną aukcję anuluj.');
      }
      await tx.delete(auctions).where(eq(auctions.id, auction.id));
      const released = await this.items.remove(auction.itemId, tx);
      await this.media.detach(sellerId, released, tx);
    });
  }

  /**
   * Publikacja szkicu: blokada wystawiania, limit aktywnych aukcji, komplet pól, limity wartości,
   * informacja o KYC i filtr słów. Wynik: ACTIVE (`ends_at` = teraz + czas trwania) albo
   * PENDING_REVIEW (kategoria z ograniczeniami, słowa do sprawdzenia).
   */
  async publish(
    sellerId: string,
    auctionId: string,
    input: { readonly kycNoticeAccepted?: boolean | undefined },
  ): Promise<ListingView> {
    return this.db.transaction(async (tx) => {
      const auction = await this.lock(tx, sellerId, auctionId);
      if (auction.status !== 'DRAFT') {
        throw conflict('Ta aukcja jest już opublikowana.');
      }
      // Jedna publikacja naraz na sprzedającego: limit aktywnych aukcji liczony bez wyścigu.
      await this.lockSeller(tx, sellerId);
      const standing = await this.standing.get(sellerId, tx);
      if (standing.listingBlockedUntil !== null && standing.listingBlockedUntil > new Date()) {
        throw new DomainError({
          code: 'LISTING_BLOCKED',
          detail: `Masz blokadę wystawiania aukcji do ${standing.listingBlockedUntil.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long', timeStyle: 'short' })}.`,
          extensions: { blockedUntil: standing.listingBlockedUntil.toISOString() },
        });
      }
      const active = await this.countByStatus(tx, sellerId, ACTIVE_STATUSES);
      if (active >= standing.limits.maxActiveAuctions) {
        throw new DomainError({
          code: 'LISTING_LIMIT_REACHED',
          detail: `Możesz mieć najwyżej ${String(standing.limits.maxActiveAuctions)} aktywnych aukcji. Poczekaj, aż któraś się zakończy, albo anuluj aukcję bez ofert.`,
          extensions: { limit: standing.limits.maxActiveAuctions },
        });
      }

      const item = await this.items.get(auction.itemId, tx);
      if (item === undefined) {
        throw new Error(`Aukcja ${auction.id} bez przedmiotu ${auction.itemId}`);
      }
      const check = await this.check(tx, sellerId, auction, item, standing);
      const issues = [...check.issues];
      if (standing.kycNoticeAcceptedAt === null && input.kycNoticeAccepted !== true) {
        issues.push({
          path: 'kycNoticeAccepted',
          message: 'Potwierdź, że znasz zasady weryfikacji tożsamości przed wypłatą środków.',
        });
      }
      if (issues.length > 0) {
        throw invalid(issues);
      }
      if (standing.kycNoticeAcceptedAt === null) {
        await this.standing.acceptKycNotice(sellerId, tx);
      }

      if (check.reviewReasons.length > 0) {
        const terms = [...new Set(check.reviewMatches.map((match) => shownTerm(match.term)))];
        const [submitted] = await tx
          .update(auctions)
          .set({
            status: 'PENDING_REVIEW',
            reviewReasons: check.reviewReasons,
            reviewTerms: terms,
            publishedAt: sql`now()`,
            version: sql`${auctions.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(auctions.id, auction.id))
          .returning();
        if (submitted === undefined) {
          throw notFound();
        }
        await this.outbox.add(
          tx,
          AuctionSubmittedForReview.create({
            aggregateId: submitted.id,
            payload: { sellerId, itemId: item.id, reasons: check.reviewReasons, terms },
          }),
        );
        return this.toView(submitted, tx);
      }

      const [activated] = await tx
        .update(auctions)
        .set({
          status: 'ACTIVE',
          startsAt: sql`now()`,
          endsAt: sql`now() + make_interval(days => ${auctions.durationDays})`,
          originalEndsAt: sql`now() + make_interval(days => ${auctions.durationDays})`,
          publishedAt: sql`now()`,
          version: sql`${auctions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (
        activated === undefined ||
        activated.startsAt === null ||
        activated.endsAt === null ||
        activated.startPrice === null ||
        item.categoryId === null
      ) {
        throw new Error(`Publikacja aukcji ${auction.id} nie zwróciła kompletnego wiersza`);
      }
      await this.outbox.add(
        tx,
        AuctionPublished.create({
          aggregateId: activated.id,
          payload: {
            sellerId,
            itemId: item.id,
            categoryId: item.categoryId,
            startPrice: { amount: activated.startPrice, currency: activated.currency },
            buyNowPrice:
              activated.buyNowPrice === null
                ? null
                : { amount: activated.buyNowPrice, currency: activated.currency },
            startsAt: activated.startsAt.toISOString(),
            endsAt: activated.endsAt.toISOString(),
          },
        }),
      );
      return this.toView(activated, tx);
    });
  }

  /** Anulowanie aktywnej aukcji albo czekającej na moderatora (§6.6). */
  async cancel(sellerId: string, auctionId: string): Promise<ListingView> {
    return this.db.transaction(async (tx) => {
      const auction = await this.lock(tx, sellerId, auctionId);
      if (auction.status !== 'ACTIVE' && auction.status !== 'PENDING_REVIEW') {
        throw conflict(
          auction.status === 'DRAFT'
            ? 'Szkicu nie trzeba anulować: możesz go usunąć.'
            : 'Ta aukcja jest już zakończona albo anulowana.',
        );
      }
      if (
        auction.bidCount > 0 &&
        auction.endsAt !== null &&
        auction.endsAt.getTime() - Date.now() < CANCEL_LOCK_MS
      ) {
        throw new DomainError({ code: 'AUCTION_CANCEL_TOO_LATE' });
      }
      const [cancelled] = await tx
        .update(auctions)
        .set({
          status: 'CANCELLED',
          cancelledAt: sql`now()`,
          version: sql`${auctions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (cancelled === undefined) {
        throw notFound();
      }
      await this.outbox.add(
        tx,
        AuctionCancelled.create({
          aggregateId: cancelled.id,
          payload: {
            sellerId,
            bidCount: auction.bidCount,
            previousStatus: auction.status,
            cancelledBy: 'SELLER',
          },
        }),
      );
      return this.toView(cancelled, tx);
    });
  }

  /**
   * Anulowanie przez moderację (F-16): aukcja aktywna albo w moderacji, także z ofertami i w
   * ostatnich 12 h. Uzasadnienie trafia do eventu (statement of reasons, F-35).
   */
  async cancelByModerator(staffId: string, auctionId: string, note: string): Promise<Auction> {
    return this.db.transaction(async (tx) => {
      const [auction] = await tx
        .select()
        .from(auctions)
        .where(eq(auctions.id, auctionId))
        .for('update');
      if (auction === undefined) {
        throw notFound();
      }
      if (auction.status !== 'ACTIVE' && auction.status !== 'PENDING_REVIEW') {
        throw conflict('Anulować można aukcję aktywną albo czekającą na moderatora.');
      }
      const [cancelled] = await tx
        .update(auctions)
        .set({
          status: 'CANCELLED',
          cancelledAt: sql`now()`,
          version: sql`${auctions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(auctions.id, auction.id))
        .returning();
      if (cancelled === undefined) {
        throw notFound();
      }
      await this.outbox.add(
        tx,
        AuctionCancelled.create({
          aggregateId: cancelled.id,
          payload: {
            sellerId: cancelled.sellerId,
            bidCount: auction.bidCount,
            previousStatus: auction.status,
            cancelledBy: 'MODERATOR',
            reason: note,
          },
        }),
      );
      this.logger.warn(
        { auctionId: cancelled.id, staffId, bidCount: auction.bidCount, note },
        'Moderator anulował aukcję',
      );
      return cancelled;
    });
  }

  /** Kopia zakończonej albo anulowanej aukcji jako nowy szkic (te same zdjęcia). */
  async relist(sellerId: string, auctionId: string): Promise<ListingView> {
    return this.db.transaction(async (tx) => {
      const source = await this.lock(tx, sellerId, auctionId);
      if (!ENDED_STATUSES.includes(source.status)) {
        throw conflict('Ponownie wystawić można zakończoną albo anulowaną aukcję.');
      }
      await this.lockSeller(tx, sellerId);
      await this.assertDraftRoom(tx, sellerId);
      const item = await this.items.copy(source.itemId, tx);
      const auction = await this.insertAuction(tx, {
        sellerId,
        itemId: item.id,
        currency: source.currency,
        startPrice: source.startPrice,
        reservePrice: source.reservePrice,
        buyNowPrice: source.buyNowPrice,
        durationDays: source.durationDays,
      });
      return this.toView(auction, tx);
    });
  }

  /** Limity sprzedawcy z liczbą aktywnych aukcji (kreator i Moje aukcje). */
  async sellingLimits(sellerId: string): Promise<SellingLimits> {
    const [standing, activeAuctions] = await Promise.all([
      this.standing.get(sellerId),
      this.countByStatus(this.db, sellerId, ACTIVE_STATUSES),
    ]);
    return { standing, activeAuctions };
  }

  // --- Wewnętrzne ---

  /** Wszystko, co blokuje publikację (błędy pól), i powody moderacji. */
  private async check(
    tx: Transaction,
    sellerId: string,
    auction: Auction,
    item: ItemDetails,
    standing: SellerStanding,
  ): Promise<ListingCheck> {
    const category =
      item.categoryId === null ? undefined : await this.categories.schema(item.categoryId);
    const input: ListingInput = {
      photoCount: item.mediaIds.length,
      categoryId: item.categoryId,
      attributes: item.attributes,
      title: item.title,
      description: item.description,
      condition: item.condition,
      brand: item.brand,
      packageSize: item.packageSize,
      weightGrams: item.weightGrams,
      lengthCm: item.lengthCm,
      widthCm: item.widthCm,
      heightCm: item.heightCm,
      allowedCarriers: item.allowedCarriers,
      startPrice: auction.startPrice,
      reservePrice: auction.reservePrice,
      buyNowPrice: auction.buyNowPrice,
      durationDays: auction.durationDays,
    };
    const issues = validateListing(input, {
      category,
      carriers: await this.carriers.list(),
      limits: {
        maxAuctionValue: standing.limits.maxAuctionValue,
        kycVerified: standing.kycVerified,
      },
    });

    const photos = await this.media.describe(sellerId, item.mediaIds, tx);
    if (
      photos.length !== item.mediaIds.length ||
      photos.some((photo) => photo.status !== 'READY')
    ) {
      issues.push({
        path: 'mediaIds',
        message: 'Część zdjęć nie jest gotowa albo czeka na moderatora. Usuń je przed publikacją.',
      });
    }

    const filtered = this.filter.checkListing({
      title: item.title,
      description: item.description,
      brand: item.brand,
    });
    const blocked = new Map<string, string[]>();
    for (const match of filtered.matches) {
      if (match.verdict === 'BLOCK') {
        blocked.set(match.field, [...(blocked.get(match.field) ?? []), shownTerm(match.term)]);
      }
    }
    for (const [field, terms] of blocked) {
      issues.push({
        path: field,
        message: `Takich przedmiotów nie można sprzedawać na Biddy (${terms.map((term) => `„${term}”`).join(', ')}). Sprawdź listę zakazanych przedmiotów.`,
      });
    }

    const reviewMatches = filtered.matches.filter((match) => match.verdict === 'REVIEW');
    const reviewReasons: ReviewReason[] = [];
    if (category?.isRestricted === true) {
      reviewReasons.push('RESTRICTED_CATEGORY');
    }
    if (reviewMatches.length > 0) {
      reviewReasons.push('WORD_FILTER');
    }
    return { issues, category, reviewReasons, reviewMatches };
  }

  private async lock(tx: Transaction, sellerId: string, auctionId: string): Promise<Auction> {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(and(eq(auctions.id, auctionId), eq(auctions.sellerId, sellerId)))
      .for('update');
    if (auction === undefined) {
      throw notFound();
    }
    return auction;
  }

  /** Blokada doradcza na sprzedającego do końca transakcji (limity liczone bez wyścigu). */
  private async lockSeller(tx: Transaction, sellerId: string): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`listing:${sellerId}`}, 0))`,
    );
  }

  private async countByStatus(
    db: Database | Transaction,
    sellerId: string,
    statuses: readonly AuctionStatus[],
  ): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(auctions)
      .where(and(eq(auctions.sellerId, sellerId), inArray(auctions.status, [...statuses])));
    return row?.value ?? 0;
  }

  private async assertDraftRoom(tx: Transaction, sellerId: string): Promise<void> {
    if ((await this.countByStatus(tx, sellerId, ['DRAFT'])) >= MAX_DRAFTS) {
      throw conflict(
        `Masz już ${String(MAX_DRAFTS)} szkiców. Opublikuj albo usuń któryś, zanim zaczniesz kolejny.`,
      );
    }
  }

  private async insertAuction(
    tx: Transaction,
    values: Pick<Auction, 'sellerId' | 'itemId'> &
      Partial<
        Pick<Auction, 'currency' | 'startPrice' | 'reservePrice' | 'buyNowPrice' | 'durationDays'>
      >,
  ): Promise<Auction> {
    // Kolizja 8-znakowego identyfikatora jest skrajnie mało prawdopodobna; ponawiamy kilka razy.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [auction] = await tx
        .insert(auctions)
        .values({ ...values, publicId: newPublicId() })
        .onConflictDoNothing({ target: auctions.publicId })
        .returning();
      if (auction !== undefined) {
        return auction;
      }
    }
    throw new Error('Nie udało się nadać unikalnego publicId aukcji');
  }

  private async toView(auction: Auction, tx?: Transaction): Promise<ListingView> {
    const item = await this.items.get(auction.itemId, tx);
    if (item === undefined) {
      throw new Error(`Aukcja ${auction.id} bez przedmiotu ${auction.itemId}`);
    }
    const photos = await this.media.describe(auction.sellerId, item.mediaIds, tx);
    return { auction, item, photos };
  }
}
