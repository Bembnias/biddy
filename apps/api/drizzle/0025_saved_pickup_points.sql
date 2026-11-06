-- Zapisane punkty odbioru (F-64, PROJECT.md §8.1): do 10 na konto, jeden domyślny na konto,
-- dostawcę i usługę (indeks częściowy). Kopia nazwy i adresu punktu jest tylko do wyświetlania;
-- punkt sprawdzamy u dostawcy przy wyborze dostawy. Nowa tabela, więc migracja jest wstecznie
-- kompatybilna.
CREATE TABLE "saved_pickup_points" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"carrier_id" text NOT NULL,
	"point_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"opening_hours" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_pickup_points_point_id_check" CHECK (length("saved_pickup_points"."point_id") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "saved_pickup_points" ADD CONSTRAINT "saved_pickup_points_carrier_id_shipping_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."shipping_carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_pickup_points_point_key" ON "saved_pickup_points" USING btree ("user_id","provider","carrier_id","point_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_pickup_points_default_key" ON "saved_pickup_points" USING btree ("user_id","provider","carrier_id") WHERE "saved_pickup_points"."is_default";--> statement-breakpoint
CREATE INDEX "saved_pickup_points_user_idx" ON "saved_pickup_points" USING btree ("user_id","created_at");