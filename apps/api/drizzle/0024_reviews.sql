-- Oceny (F-30, PROJECT.md §5, §13.3): ocena 1–5 z komentarzem każdej strony zamówienia
-- zakończonego sprzedażą albo zwrotem po sporze, raz na stronę (order_id, author_id). Ocena jest
-- publiczna od visible_at (po obu ocenach albo po 7 dniach); published_at oznacza event dla
-- powiadomień (job reviews.publish). Zamówienia i konta bez FK (osobne moduły).
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_public_id" text NOT NULL,
	"title" text NOT NULL,
	"author_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"role" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visible_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_role_check" CHECK (role in ('BUYER', 'SELLER')),
	CONSTRAINT "reviews_parties_check" CHECK ("reviews"."author_id" <> "reviews"."target_id"),
	CONSTRAINT "reviews_visible_at_check" CHECK ("reviews"."visible_at" >= "reviews"."created_at"),
	CONSTRAINT "reviews_comment_check" CHECK (comment is null or char_length(comment) between 1 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_id_author_id_key" ON "reviews" USING btree ("order_id","author_id");--> statement-breakpoint
CREATE INDEX "reviews_target_id_created_at_idx" ON "reviews" USING btree ("target_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_unpublished_idx" ON "reviews" USING btree ("visible_at") WHERE "reviews"."published_at" is null;