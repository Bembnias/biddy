-- Dostawy (F-24, PROJECT.md §8): cennik dostaw Biddy (shipping_rates), przesyłki z historią
-- trackingu (shipments, shipment_events), reklamacje u przewoźników (carrier_claims) i tokeny
-- OAuth Furgonetki (furgonetka_tokens, zaszyfrowane). Przewoźnicy dostają sposoby nadania,
-- limity gabarytu XL i kody usług u dostawców. Tabele fake_shipping_* to stan adaptera testowego
-- FakeShipping; na produkcji jest zablokowany, więc zostają puste.
CREATE TABLE "fake_shipping_parcels" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"carrier_id" text NOT NULL,
	"tracking_number" text NOT NULL,
	"dropoff_code" text,
	"pickup_point_id" text,
	"scenario" text NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"currency" char(3) NOT NULL,
	"cost" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_shipping_parcels_status_check" CHECK (status in ('confirmed', 'posted', 'in_transit', 'out_for_delivery', 'awaiting_pickup', 'delivered', 'exception', 'return_expired', 'returning', 'returned', 'cancelled')),
	CONSTRAINT "fake_shipping_parcels_scenario_check" CHECK (scenario in ('DELIVERED', 'NOT_PICKED_UP', 'LOST', 'MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "fake_shipping_tracking" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parcel_id" text NOT NULL,
	"status" text NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fake_shipping_tracking_status_check" CHECK (status in ('confirmed', 'posted', 'in_transit', 'out_for_delivery', 'awaiting_pickup', 'delivered', 'exception', 'return_expired', 'returning', 'returned', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "fake_shipping_webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"parcel_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"currency" char(3) NOT NULL,
	"claimed_amount" bigint NOT NULL,
	"recovered_amount" bigint,
	"provider_claim_ref" text,
	"note" text,
	"submitted_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_claims_type_check" CHECK (type in ('LOST', 'DAMAGED')),
	CONSTRAINT "carrier_claims_status_check" CHECK (status in ('OPEN', 'SUBMITTED', 'ACCEPTED', 'REJECTED')),
	CONSTRAINT "carrier_claims_amounts_check" CHECK ("carrier_claims"."claimed_amount" > 0 and ("carrier_claims"."recovered_amount" is null or "carrier_claims"."recovered_amount" between 0 and "carrier_claims"."claimed_amount")),
	CONSTRAINT "carrier_claims_resolution_check" CHECK (("carrier_claims"."status" in ('ACCEPTED', 'REJECTED')) = ("carrier_claims"."resolved_at" is not null and "carrier_claims"."recovered_amount" is not null))
);
--> statement-breakpoint
CREATE TABLE "furgonetka_tokens" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"access_token" "bytea" NOT NULL,
	"refresh_token" "bytea",
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "furgonetka_tokens_single_row_check" CHECK ("furgonetka_tokens"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shipment_id" uuid NOT NULL,
	"raw_status" text NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_events_status_check" CHECK (status in ('PENDING', 'REQUESTED', 'CREATED', 'DROPPED_OFF', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'EXCEPTION', 'RETURNING', 'RETURNED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"carrier_id" text NOT NULL,
	"package_size" text NOT NULL,
	"parcel" jsonb NOT NULL,
	"pickup_point" jsonb,
	"recipient" jsonb NOT NULL,
	"sender" jsonb,
	"dispatch_method" text,
	"declared_value" bigint,
	"reference" text,
	"currency" char(3) NOT NULL,
	"price" bigint NOT NULL,
	"cost" bigint,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_shipment_id" text,
	"tracking_number" text,
	"dropoff_code" text,
	"label_key" text,
	"dispatch_attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"requested_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"polled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_status_check" CHECK (status in ('PENDING', 'REQUESTED', 'CREATED', 'DROPPED_OFF', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'EXCEPTION', 'RETURNING', 'RETURNED', 'CANCELLED')),
	CONSTRAINT "shipments_direction_check" CHECK (direction in ('OUTBOUND', 'RETURN')),
	CONSTRAINT "shipments_dispatch_method_check" CHECK (dispatch_method is null or dispatch_method in ('DROP_OFF', 'COURIER_PICKUP')),
	CONSTRAINT "shipments_order_check" CHECK ("shipments"."order_id" is not null or "shipments"."provider" = 'fake'),
	CONSTRAINT "shipments_amounts_check" CHECK ("shipments"."price" >= 0 and ("shipments"."cost" is null or "shipments"."cost" >= 0))
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"carrier_id" text NOT NULL,
	"package_size" text NOT NULL,
	"currency" char(3) NOT NULL,
	"price" bigint NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_price_check" CHECK ("shipping_rates"."price" > 0),
	CONSTRAINT "shipping_rates_package_size_check" CHECK ("shipping_rates"."package_size" in ('S', 'M', 'L', 'XL')),
	CONSTRAINT "shipping_rates_valid_range_check" CHECK ("shipping_rates"."valid_to" is null or "shipping_rates"."valid_to" > "shipping_rates"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD COLUMN "dispatch_methods" text[] DEFAULT '{DROP_OFF}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD COLUMN "max_weight_grams" integer;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD COLUMN "max_length_cm" integer;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD COLUMN "max_girth_cm" integer;--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD COLUMN "provider_codes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fake_shipping_tracking" ADD CONSTRAINT "fake_shipping_tracking_parcel_id_fake_shipping_parcels_id_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."fake_shipping_parcels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fake_shipping_webhooks" ADD CONSTRAINT "fake_shipping_webhooks_parcel_id_fake_shipping_parcels_id_fk" FOREIGN KEY ("parcel_id") REFERENCES "public"."fake_shipping_parcels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_claims" ADD CONSTRAINT "carrier_claims_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_shipping_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."shipping_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_carrier_id_shipping_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."shipping_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fake_shipping_parcels_idempotency_key" ON "fake_shipping_parcels" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fake_shipping_parcels_tracking_number_key" ON "fake_shipping_parcels" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "fake_shipping_parcels_created_at_index" ON "fake_shipping_parcels" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fake_shipping_tracking_parcel_id_occurred_at_index" ON "fake_shipping_tracking" USING btree ("parcel_id","occurred_at");--> statement-breakpoint
CREATE INDEX "fake_shipping_webhooks_parcel_id_index" ON "fake_shipping_webhooks" USING btree ("parcel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_claims_shipment_id_key" ON "carrier_claims" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_events_dedupe_key" ON "shipment_events" USING btree ("shipment_id","raw_status","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_provider_shipment_id_key" ON "shipments" USING btree ("provider","provider_shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_active_order_direction_key" ON "shipments" USING btree ("order_id","direction") WHERE "shipments"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE INDEX "shipments_status_polled_at_index" ON "shipments" USING btree ("status","polled_at");--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD CONSTRAINT "shipping_carriers_dispatch_methods_check" CHECK (dispatch_methods <@ array['DROP_OFF', 'COURIER_PICKUP']::text[] and cardinality(dispatch_methods) > 0);--> statement-breakpoint
ALTER TABLE "shipping_carriers" ADD CONSTRAINT "shipping_carriers_limits_check" CHECK (coalesce("shipping_carriers"."max_weight_grams", 1) > 0 and coalesce("shipping_carriers"."max_length_cm", 1) > 0 and coalesce("shipping_carriers"."max_girth_cm", 1) > 0);--> statement-breakpoint
-- W danej chwili najwyżej jedna cena dla usługi, gabarytu i waluty (btree_gist z 0008).
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_no_overlap" EXCLUDE USING gist ("carrier_id" WITH =, "package_size" WITH =, "currency" WITH =, tstzrange("valid_from", "valid_to") WITH &&);--> statement-breakpoint
-- Konfiguracja startowych usług (§8.1–§8.2). Limity XL i kody Furgonetki to wartości robocze do
-- potwierdzenia stawkami i umową (§8.5); zmiana do czasu panelu admina to nowa migracja.
UPDATE "shipping_carriers" SET "dispatch_methods" = '{DROP_OFF}', "provider_codes" = '{"furgonetka": "inpost"}' WHERE "id" = 'inpost-paczkomat';--> statement-breakpoint
UPDATE "shipping_carriers" SET "dispatch_methods" = '{DROP_OFF,COURIER_PICKUP}', "provider_codes" = '{"furgonetka": "inpostkurier"}', "max_weight_grams" = 30000, "max_length_cm" = 120, "max_girth_cm" = 220 WHERE "id" = 'inpost-kurier';--> statement-breakpoint
UPDATE "shipping_carriers" SET "dispatch_methods" = '{DROP_OFF}', "provider_codes" = '{"furgonetka": "orlen"}' WHERE "id" = 'orlen-paczka';--> statement-breakpoint
UPDATE "shipping_carriers" SET "dispatch_methods" = '{DROP_OFF}', "provider_codes" = '{"furgonetka": "dpd"}' WHERE "id" = 'dpd-pickup';--> statement-breakpoint
UPDATE "shipping_carriers" SET "dispatch_methods" = '{DROP_OFF,COURIER_PICKUP}', "provider_codes" = '{"furgonetka": "dpd"}', "max_weight_grams" = 31500, "max_length_cm" = 175, "max_girth_cm" = 300 WHERE "id" = 'dpd-kurier';--> statement-breakpoint
-- Startowy cennik dostaw Biddy (ceny brutto dla kupującego). Zmiana cen to zamknięcie wiersza
-- (valid_to) i nowy wiersz, a przesyłki pamiętają cenę z chwili wyboru.
INSERT INTO "shipping_rates" ("id", "carrier_id", "package_size", "currency", "price", "valid_from") VALUES
  ('019b76da-a800-758d-ba6e-c38a282c7a6d', 'inpost-paczkomat', 'S', 'PLN', 1299, '2026-01-01T00:00:00Z'),
  ('019b76da-a801-7558-86f4-2adc637434a5', 'inpost-paczkomat', 'M', 'PLN', 1399, '2026-01-01T00:00:00Z'),
  ('019b76da-a802-702f-81c0-e329c5f213c6', 'inpost-paczkomat', 'L', 'PLN', 1599, '2026-01-01T00:00:00Z'),
  ('019b76da-a803-725c-9a18-dbd6a65ac5d8', 'inpost-kurier', 'S', 'PLN', 1699, '2026-01-01T00:00:00Z'),
  ('019b76da-a804-762c-b400-c92936723167', 'inpost-kurier', 'M', 'PLN', 1799, '2026-01-01T00:00:00Z'),
  ('019b76da-a805-76a0-8239-839a9e819f9f', 'inpost-kurier', 'L', 'PLN', 1999, '2026-01-01T00:00:00Z'),
  ('019b76da-a806-7667-86b9-0961a41324f8', 'inpost-kurier', 'XL', 'PLN', 3999, '2026-01-01T00:00:00Z'),
  ('019b76da-a807-7558-b74f-d03b28937f19', 'orlen-paczka', 'S', 'PLN', 999, '2026-01-01T00:00:00Z'),
  ('019b76da-a808-77a3-b42b-e5ecc568886f', 'orlen-paczka', 'M', 'PLN', 1099, '2026-01-01T00:00:00Z'),
  ('019b76da-a809-7779-b764-bae0ad8e3294', 'orlen-paczka', 'L', 'PLN', 1299, '2026-01-01T00:00:00Z'),
  ('019b76da-a80a-75e4-8a23-6337e8ae931d', 'dpd-pickup', 'S', 'PLN', 1199, '2026-01-01T00:00:00Z'),
  ('019b76da-a80b-7088-b203-84bf5807cdfa', 'dpd-pickup', 'M', 'PLN', 1299, '2026-01-01T00:00:00Z'),
  ('019b76da-a80c-7439-8192-d5c88abd9534', 'dpd-pickup', 'L', 'PLN', 1499, '2026-01-01T00:00:00Z'),
  ('019b76da-a80d-73c6-bcda-494830a1eb35', 'dpd-kurier', 'S', 'PLN', 1799, '2026-01-01T00:00:00Z'),
  ('019b76da-a80e-7348-9c2f-31b159d5262c', 'dpd-kurier', 'M', 'PLN', 1899, '2026-01-01T00:00:00Z'),
  ('019b76da-a80f-7287-91d1-3e461f9c84e8', 'dpd-kurier', 'L', 'PLN', 2199, '2026-01-01T00:00:00Z'),
  ('019b76da-a810-7720-b275-8b57b5a11f9b', 'dpd-kurier', 'XL', 'PLN', 4499, '2026-01-01T00:00:00Z');
