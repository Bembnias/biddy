-- Spory i zwroty (F-28, PROJECT.md §7.5, §7.9): spór o zamówienie z historią (oś czasu stron
-- i personelu), moment zgłoszenia w zamówieniu (orders.disputed_at), zdjęcia ze sporu jako prywatne
-- przeznaczenie mediów (DISPUTE_EVIDENCE) i zwrot części ceny w sporze (refunds.reason
-- DISPUTE_PARTIAL z kwotami zamówienia). Trigger disputes_status_transition dopuszcza tylko
-- przejścia z §7.5 (ta sama lista co DISPUTE_TRANSITIONS w
-- modules/disputes/domain/dispute-state-machine.ts).
CREATE TABLE "dispute_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dispute_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"actor_id" uuid,
	"note" text,
	"amount" bigint,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_events_type_check" CHECK (type in ('OPENED', 'SELLER_ACCEPTED', 'PARTIAL_OFFERED', 'PARTIAL_ACCEPTED', 'PARTIAL_REJECTED', 'SELLER_REJECTED', 'ESCALATED', 'COMMENT', 'DECISION', 'RETURN_SHIPPED', 'RETURN_DELIVERED', 'RETURN_ACCEPTED', 'RETURN_CONTESTED', 'RESOLVED')),
	CONSTRAINT "dispute_events_actor_check" CHECK (actor in ('BUYER', 'SELLER', 'STAFF', 'SYSTEM')),
	CONSTRAINT "dispute_events_actor_id_check" CHECK (("dispute_events"."actor" = 'SYSTEM') = ("dispute_events"."actor_id" is null))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_public_id" text NOT NULL,
	"title" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"items_total" bigint NOT NULL,
	"shipping_fee" bigint NOT NULL,
	"order_total" bigint NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'AWAITING_SELLER' NOT NULL,
	"response_due_at" timestamp with time zone,
	"partial_offer_amount" bigint,
	"escalated_at" timestamp with time zone,
	"decision_due_at" timestamp with time zone,
	"outcome" text,
	"fault" text,
	"refund_amount" bigint,
	"return_required" boolean DEFAULT false NOT NULL,
	"decided_by" text,
	"decided_by_staff_id" uuid,
	"statement" text,
	"decided_at" timestamp with time zone,
	"return_shipment_id" uuid,
	"return_ship_by" timestamp with time zone,
	"return_shipped_at" timestamp with time zone,
	"return_delivered_at" timestamp with time zone,
	"return_inspection_ends_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_status_check" CHECK (status in ('AWAITING_SELLER', 'PARTIAL_OFFERED', 'ESCALATED', 'AWAITING_RETURN', 'RETURN_IN_TRANSIT', 'RETURN_DELIVERED', 'RESOLVED')),
	CONSTRAINT "disputes_reason_check" CHECK (reason in ('NOT_AS_DESCRIBED', 'DAMAGED', 'INCOMPLETE', 'COUNTERFEIT', 'NOT_RECEIVED', 'OTHER')),
	CONSTRAINT "disputes_outcome_check" CHECK (outcome is null or outcome in ('SELLER_FAVOR', 'FULL_REFUND', 'PARTIAL_REFUND')),
	CONSTRAINT "disputes_fault_check" CHECK ((fault is null or fault in ('SELLER', 'CARRIER')) and ((fault is not null) = (outcome = 'FULL_REFUND'))),
	CONSTRAINT "disputes_decided_by_check" CHECK (decided_by is null or decided_by in ('PARTIES', 'STAFF', 'SYSTEM')),
	CONSTRAINT "disputes_decision_check" CHECK (("disputes"."outcome" is null) = ("disputes"."decided_by" is null) and ("disputes"."outcome" is null) = ("disputes"."statement" is null) and ("disputes"."outcome" is null) = ("disputes"."decided_at" is null)),
	CONSTRAINT "disputes_refund_amount_check" CHECK (("disputes"."refund_amount" is not null) = ("disputes"."outcome" = 'PARTIAL_REFUND') and ("disputes"."refund_amount" is null or ("disputes"."refund_amount" > 0 and "disputes"."refund_amount" <= "disputes"."items_total"))),
	CONSTRAINT "disputes_partial_offer_check" CHECK ("disputes"."partial_offer_amount" is null or ("disputes"."partial_offer_amount" > 0 and "disputes"."partial_offer_amount" <= "disputes"."items_total")),
	CONSTRAINT "disputes_resolved_check" CHECK (("disputes"."status" = 'RESOLVED') = ("disputes"."resolved_at" is not null) and ("disputes"."status" <> 'RESOLVED' or "disputes"."outcome" is not null)),
	CONSTRAINT "disputes_amounts_check" CHECK ("disputes"."items_total" > 0 and "disputes"."shipping_fee" >= 0 and "disputes"."order_total" >= "disputes"."items_total")
);
--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_purpose_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_reason_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_order_amounts_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dispute_events" ADD CONSTRAINT "dispute_events_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispute_events_dispute_id_created_at_index" ON "dispute_events" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disputes_order_id_key" ON "disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "disputes_buyer_id_created_at_index" ON "disputes" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_seller_id_created_at_index" ON "disputes" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_response_due_at_idx" ON "disputes" USING btree ("response_due_at") WHERE "disputes"."status" in ('AWAITING_SELLER', 'PARTIAL_OFFERED');--> statement-breakpoint
CREATE INDEX "disputes_return_ship_by_idx" ON "disputes" USING btree ("return_ship_by") WHERE "disputes"."status" = 'AWAITING_RETURN';--> statement-breakpoint
CREATE INDEX "disputes_return_inspection_ends_at_idx" ON "disputes" USING btree ("return_inspection_ends_at") WHERE "disputes"."status" = 'RETURN_DELIVERED';--> statement-breakpoint
CREATE INDEX "disputes_escalated_at_idx" ON "disputes" USING btree ("escalated_at") WHERE "disputes"."status" = 'ESCALATED';--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('ITEM_PHOTO', 'AVATAR', 'DISPUTE_EVIDENCE'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_check" CHECK (reason in ('NOT_SHIPPED', 'LOST', 'DISPUTE', 'LATE_PAYMENT', 'DUPLICATE_PAYMENT', 'CHARGEBACK', 'NOT_PICKED_UP', 'DISPUTE_PARTIAL'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_amounts_check" CHECK (("refunds"."reason" in ('NOT_PICKED_UP', 'DISPUTE_PARTIAL')) = ("refunds"."order_amounts" is not null));--> statement-breakpoint
CREATE FUNCTION "disputes_status_transition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('AWAITING_SELLER', 'RESOLVED'),
      ('AWAITING_SELLER', 'AWAITING_RETURN'),
      ('AWAITING_SELLER', 'PARTIAL_OFFERED'),
      ('AWAITING_SELLER', 'ESCALATED'),
      ('PARTIAL_OFFERED', 'RESOLVED'),
      ('PARTIAL_OFFERED', 'ESCALATED'),
      ('ESCALATED', 'AWAITING_RETURN'),
      ('ESCALATED', 'RESOLVED'),
      ('AWAITING_RETURN', 'RETURN_IN_TRANSIT'),
      ('AWAITING_RETURN', 'RESOLVED'),
      ('AWAITING_RETURN', 'ESCALATED'),
      ('RETURN_IN_TRANSIT', 'RETURN_DELIVERED'),
      ('RETURN_IN_TRANSIT', 'ESCALATED'),
      ('RETURN_DELIVERED', 'RESOLVED'),
      ('RETURN_DELIVERED', 'ESCALATED')
    ) AS "allowed"("from_status", "to_status")
    WHERE "from_status" = OLD.status AND "to_status" = NEW.status
  ) THEN
    RAISE EXCEPTION 'Niedozwolone przejście sporu %: % → %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "disputes_status_transition" BEFORE UPDATE OF "status" ON "disputes"
  FOR EACH ROW EXECUTE FUNCTION "disputes_status_transition"();
