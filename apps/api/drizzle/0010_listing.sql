-- Kreator aukcji (F-14): przedmioty ze zdjęciami (moduł catalog), aukcje (auctions),
-- przewoźnicy (shipping) oraz blokada wystawiania i potwierdzenie informacji o KYC (identity).
CREATE TABLE "auctions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"type" text DEFAULT 'TIMED' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" char(3) DEFAULT 'PLN' NOT NULL,
	"start_price" bigint,
	"reserve_price" bigint,
	"buy_now_price" bigint,
	"duration_days" integer,
	"current_price" bigint,
	"leader_id" uuid,
	"leader_max_amount" bigint,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"review_terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"original_ends_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auctions_status_check" CHECK ("auctions"."status" in ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'ENDED_SOLD', 'ENDED_UNSOLD', 'CANCELLED')),
	CONSTRAINT "auctions_prices_check" CHECK (("auctions"."start_price" is null or "auctions"."start_price" >= 0) and ("auctions"."reserve_price" is null or "auctions"."reserve_price" >= 0) and ("auctions"."buy_now_price" is null or "auctions"."buy_now_price" >= 0)),
	CONSTRAINT "auctions_published_check" CHECK ("auctions"."status" in ('DRAFT', 'PENDING_REVIEW', 'CANCELLED') or ("auctions"."starts_at" is not null and "auctions"."ends_at" is not null and "auctions"."start_price" is not null))
);
--> statement-breakpoint
CREATE TABLE "item_media" (
	"item_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "item_media_item_id_position_pk" PRIMARY KEY("item_id","position")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"category_id" uuid,
	"title" text,
	"description" text,
	"condition" text,
	"brand" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"package_size" text,
	"weight_grams" integer,
	"length_cm" integer,
	"width_cm" integer,
	"height_cm" integer,
	"allowed_carriers" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_condition_check" CHECK ("items"."condition" is null or "items"."condition" in ('NEW', 'LIKE_NEW', 'VERY_GOOD', 'GOOD', 'FAIR', 'FOR_PARTS')),
	CONSTRAINT "items_package_size_check" CHECK ("items"."package_size" is null or "items"."package_size" in ('S', 'M', 'L', 'XL'))
);
--> statement-breakpoint
CREATE TABLE "shipping_carriers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"package_sizes" text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shipping_carriers_kind_check" CHECK ("shipping_carriers"."kind" in ('LOCKER', 'PICKUP_POINT', 'COURIER')),
	CONSTRAINT "shipping_carriers_package_sizes_check" CHECK ("shipping_carriers"."package_sizes" <@ array['S', 'M', 'L', 'XL']::text[] and cardinality("shipping_carriers"."package_sizes") > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "listing_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seller_kyc_notice_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_media" ADD CONSTRAINT "item_media_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_public_id_key" ON "auctions" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_item_id_key" ON "auctions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "auctions_seller_id_status_index" ON "auctions" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "auctions_active_ends_at_index" ON "auctions" USING btree ("ends_at") WHERE "auctions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "item_media_item_id_media_id_index" ON "item_media" USING btree ("item_id","media_id");--> statement-breakpoint
CREATE INDEX "items_seller_id_index" ON "items" USING btree ("seller_id");