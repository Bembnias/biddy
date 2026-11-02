-- Cykl życia zamówienia (F-26, PROJECT.md §6.8, §7.3, §7.4, §7.9): kolumny etapów i terminów
-- w orders, płatność, która opłaciła zamówienie (orders.payment_id, z backfillem), flaga
-- chargebacku, kandydaci do drugiej szansy (order_items.runner_ups, z backfillem z bids), oferty
-- drugiej szansy, zwolnienia środków u operatora (fund_releases) i zwrot nieodebranej paczki
-- (refunds.order_amounts). Trigger orders_status_transition dopuszcza tylko przejścia z §7.3
-- (ta sama lista co ORDER_TRANSITIONS w modules/orders/domain/order-state-machine.ts).
CREATE TABLE "second_chance_offers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auction_id" uuid NOT NULL,
	"source_order_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "second_chance_offers_status_check" CHECK (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
	CONSTRAINT "second_chance_offers_amount_check" CHECK ("second_chance_offers"."amount" > 0),
	CONSTRAINT "second_chance_offers_order_check" CHECK (("second_chance_offers"."status" = 'ACCEPTED') = ("second_chance_offers"."order_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "fund_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_transfer_id" text,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fund_releases_status_check" CHECK (status in ('PENDING', 'SUCCEEDED', 'NOT_REQUIRED')),
	CONSTRAINT "fund_releases_amount_check" CHECK ("fund_releases"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_cancelled_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_check";--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "runner_ups" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "inspection_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "not_picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "seller_compensated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "chargeback_status" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "second_chance_offer_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "order_amounts" jsonb;--> statement-breakpoint
ALTER TABLE "second_chance_offers" ADD CONSTRAINT "second_chance_offers_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_chance_offers" ADD CONSTRAINT "second_chance_offers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_releases" ADD CONSTRAINT "fund_releases_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "second_chance_offers_auction_bidder_key" ON "second_chance_offers" USING btree ("auction_id","bidder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "second_chance_offers_pending_auction_key" ON "second_chance_offers" USING btree ("auction_id") WHERE "second_chance_offers"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "second_chance_offers_status_expires_at_index" ON "second_chance_offers" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "second_chance_offers_source_order_id_index" ON "second_chance_offers" USING btree ("source_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_releases_order_id_key" ON "fund_releases" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fund_releases_payment_id_index" ON "fund_releases" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "orders_ship_by_paid_idx" ON "orders" USING btree ("ship_by") WHERE "orders"."status" = 'PAID';--> statement-breakpoint
CREATE INDEX "orders_inspection_ends_at_delivered_idx" ON "orders" USING btree ("inspection_ends_at") WHERE "orders"."status" = 'DELIVERED';--> statement-breakpoint
CREATE INDEX "orders_lost_at_uncompensated_idx" ON "orders" USING btree ("lost_at") WHERE "orders"."lost_at" is not null and "orders"."seller_compensated_at" is null;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_chargeback_status_check" CHECK (chargeback_status is null or chargeback_status in ('OPEN', 'WON', 'LOST'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivered_check" CHECK (("orders"."delivered_at" is null) = ("orders"."inspection_ends_at" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_check" CHECK ("orders"."cancelled_at" is null or "orders"."status" like 'CANCELLED_%' or "orders"."status" = 'REFUNDED');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_amounts_check" CHECK (("refunds"."reason" = 'NOT_PICKED_UP') = ("refunds"."order_amounts" is not null));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_check" CHECK (reason in ('NOT_SHIPPED', 'LOST', 'DISPUTE', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'CHARGEBACK', 'NOT_PICKED_UP'));--> statement-breakpoint
-- Płatność, która opłaciła zamówienie: pierwsza udana (późniejsze to duplikaty zwracane w F-25).
UPDATE "orders" SET "payment_id" = (
  SELECT "p"."id" FROM "payments" "p"
  WHERE "p"."order_id" = "orders"."id" AND "p"."status" = 'SUCCEEDED'
  ORDER BY "p"."succeeded_at", "p"."created_at" LIMIT 1
) WHERE "paid_at" IS NOT NULL;--> statement-breakpoint
-- Kandydaci do drugiej szansy: do 5 licytujących z najwyższą ważną ofertą maksymalną, bez kupującego.
UPDATE "order_items" SET "runner_ups" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('bidderId', "r"."bidder_id", 'maxAmount', "r"."max_amount")
    ORDER BY "r"."max_amount" DESC, "r"."first_sequence")
  FROM (
    SELECT "b"."bidder_id", max("b"."max_amount") AS "max_amount", min("b"."sequence") AS "first_sequence"
    FROM "bids" "b"
    WHERE "b"."auction_id" = "order_items"."auction_id" AND "b"."status" = 'VALID'
      AND "b"."bidder_id" <> (SELECT "o"."buyer_id" FROM "orders" "o" WHERE "o"."id" = "order_items"."order_id")
    GROUP BY "b"."bidder_id"
    ORDER BY 2 DESC, 3
    LIMIT 5
  ) "r"
), '[]'::jsonb);--> statement-breakpoint
CREATE FUNCTION "orders_status_transition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('AWAITING_PAYMENT', 'PAID'),
      ('AWAITING_PAYMENT', 'CANCELLED_UNPAID'),
      ('PAID', 'SHIPPED'),
      ('PAID', 'CANCELLED_NOT_SHIPPED'),
      ('SHIPPED', 'DELIVERED'),
      ('SHIPPED', 'NOT_PICKED_UP'),
      ('SHIPPED', 'LOST'),
      ('DELIVERED', 'COMPLETED'),
      ('DELIVERED', 'DISPUTED'),
      ('DISPUTED', 'COMPLETED'),
      ('DISPUTED', 'REFUNDED'),
      ('DISPUTED', 'PARTIALLY_REFUNDED'),
      ('CANCELLED_NOT_SHIPPED', 'REFUNDED'),
      ('LOST', 'REFUNDED'),
      ('NOT_PICKED_UP', 'REFUNDED'),
      ('NOT_PICKED_UP', 'LOST')
    ) AS "allowed"("from_status", "to_status")
    WHERE "from_status" = OLD.status AND "to_status" = NEW.status
  ) THEN
    RAISE EXCEPTION 'Niedozwolone przejście zamówienia %: % → %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "orders_status_transition" BEFORE UPDATE OF "status" ON "orders"
  FOR EACH ROW EXECUTE FUNCTION "orders_status_transition"();
