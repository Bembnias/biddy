-- Zamówienia (F-16): tworzone w transakcji zakończenia aukcji; najwyżej jedno aktywne zamówienie
-- na aukcję (unikalny indeks częściowy order_items_active_auction_key).
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"auction_id" uuid NOT NULL,
	"hammer_price" bigint NOT NULL,
	"item_snapshot" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" text DEFAULT 'AWAITING_PAYMENT' NOT NULL,
	"currency" char(3) NOT NULL,
	"items_total" bigint NOT NULL,
	"pok_fee" bigint NOT NULL,
	"pok_vat" bigint NOT NULL,
	"shipping_fee" bigint,
	"total" bigint NOT NULL,
	"fee_schedule_id" uuid NOT NULL,
	"payment_due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK (status in ('AWAITING_PAYMENT', 'PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'DISPUTED', 'NOT_PICKED_UP', 'LOST', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED_UNPAID', 'CANCELLED_NOT_SHIPPED')),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."items_total" >= 0 and "orders"."pok_fee" >= 0 and "orders"."pok_vat" >= 0 and "orders"."total" >= "orders"."items_total" + "orders"."pok_fee")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_id_index" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_active_auction_key" ON "order_items" USING btree ("auction_id") WHERE "order_items"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "orders_public_id_key" ON "orders" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "orders_buyer_id_created_at_index" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_id_created_at_index" ON "orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_payment_due_at_index" ON "orders" USING btree ("status","payment_due_at");