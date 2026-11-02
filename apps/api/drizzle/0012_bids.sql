-- Silnik licytacji (F-15): oferty z numerem kolejnym w aukcji (replay §15.6), kluczem
-- idempotencji per licytujący i blokada licytowania (F-61).
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auction_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"amount" bigint NOT NULL,
	"max_amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'VALID' NOT NULL,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_kind_check" CHECK ("bids"."kind" in ('MANUAL', 'AUTO', 'BUY_NOW')),
	CONSTRAINT "bids_status_check" CHECK ("bids"."status" in ('VALID', 'CANCELLED')),
	CONSTRAINT "bids_cancel_check" CHECK (("bids"."status" = 'CANCELLED') = ("bids"."cancel_reason" is not null)),
	CONSTRAINT "bids_amount_check" CHECK ("bids"."amount" >= 0 and "bids"."amount" <= "bids"."max_amount")
);
--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "bid_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bidding_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bids_auction_id_sequence_key" ON "bids" USING btree ("auction_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_bidder_id_idempotency_key_key" ON "bids" USING btree ("bidder_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bids_bidder_id_status_index" ON "bids" USING btree ("bidder_id","status");