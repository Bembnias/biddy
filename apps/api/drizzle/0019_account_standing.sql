-- Limity kont i strike'i (F-61, PROJECT.md §4.1): historia zamówień do poziomów (trade_records),
-- strike'i, blokady kont (bezterminowa: ends_at null) i wersje polityki kont. Nadpisania limitów
-- w users.limits; dawne kolumny blokad w users zastępuje account_blocks (nic ich nie ustawiało).
CREATE TABLE "account_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cause" text NOT NULL,
	"strike_ids" uuid[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"statement" text NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lift_note" text,
	"appeal_status" text DEFAULT 'NONE' NOT NULL,
	"appeal_message" text,
	"appealed_at" timestamp with time zone,
	"appeal_resolved_at" timestamp with time zone,
	"appeal_resolved_by" uuid,
	"appeal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_blocks_kind_check" CHECK (kind in ('BIDDING', 'LISTING', 'PAYOUTS')),
	CONSTRAINT "account_blocks_cause_check" CHECK (cause in ('STRIKES', 'COUNTERFEIT')),
	CONSTRAINT "account_blocks_appeal_status_check" CHECK (appeal_status in ('NONE', 'PENDING', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "account_blocks_period_check" CHECK ("account_blocks"."ends_at" is null or "account_blocks"."ends_at" > "account_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "account_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"reason" text NOT NULL,
	"source_key" text,
	"order_id" uuid,
	"auction_id" uuid,
	"issued_by" uuid,
	"statement" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_note" text,
	"appeal_status" text DEFAULT 'NONE' NOT NULL,
	"appeal_message" text,
	"appealed_at" timestamp with time zone,
	"appeal_resolved_at" timestamp with time zone,
	"appeal_resolved_by" uuid,
	"appeal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strikes_role_check" CHECK (role in ('BUYER', 'SELLER')),
	CONSTRAINT "strikes_reason_check" CHECK (reason in ('UNPAID', 'NOT_COLLECTED', 'NOT_SHIPPED', 'AUCTION_CANCELLED_WITH_BIDS', 'DISPUTE_LOST', 'COUNTERFEIT', 'OTHER')),
	CONSTRAINT "strikes_appeal_status_check" CHECK (appeal_status in ('NONE', 'PENDING', 'ACCEPTED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "trade_records" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"seller_dispute_lost_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limits" jsonb;--> statement-breakpoint
ALTER TABLE "account_blocks" ADD CONSTRAINT "account_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_records" ADD CONSTRAINT "trade_records_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_records" ADD CONSTRAINT "trade_records_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_blocks_user_id_kind_starts_at_index" ON "account_blocks" USING btree ("user_id","kind","starts_at");--> statement-breakpoint
CREATE INDEX "account_blocks_pending_appeals" ON "account_blocks" USING btree ("appealed_at") WHERE "account_blocks"."appeal_status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "account_policies_created_at_index" ON "account_policies" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strikes_source_key" ON "strikes" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "strikes_user_id_role_created_at_index" ON "strikes" USING btree ("user_id","role","created_at");--> statement-breakpoint
CREATE INDEX "strikes_pending_appeals" ON "strikes" USING btree ("appealed_at") WHERE "strikes"."appeal_status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "trade_records_buyer_id_index" ON "trade_records" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "trade_records_seller_id_index" ON "trade_records" USING btree ("seller_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "bidding_blocked_until";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "listing_blocked_until";--> statement-breakpoint
-- Poziomy kupujących od razu z dotychczasowych opłaconych zamówień (jednorazowo; dalej zapisuje
-- je konsument OrderPaid w module orders).
INSERT INTO "trade_records" ("order_id", "buyer_id", "seller_id", "paid_at")
SELECT "id", "buyer_id", "seller_id", "paid_at" FROM "orders" WHERE "paid_at" IS NOT NULL
ON CONFLICT ("order_id") DO NOTHING;
