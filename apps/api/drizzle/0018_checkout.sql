-- Checkout (F-25, PROJECT.md §6.8, §7.2): opłacenie zamówienia (paid_at, ship_by: termin nadania
-- 5 dni roboczych), anulowanie nieopłaconego (cancelled_at) i zwroty płatności u operatora
-- (refunds: spóźniona i zdublowana płatność; kolejne powody w F-26–F-28).
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_refund_id" text,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_check" CHECK (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "refunds_reason_check" CHECK (reason in ('NOT_SHIPPED', 'LOST', 'DISPUTE', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'CHARGEBACK')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_idempotency_key_check" CHECK (length("refunds"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_refund_id" ON "refunds" USING btree ("provider","provider_refund_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_id_index" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_paid_check" CHECK (("orders"."paid_at" is null) = ("orders"."ship_by" is null));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_check" CHECK ("orders"."cancelled_at" is null or "orders"."status" like 'CANCELLED_%');