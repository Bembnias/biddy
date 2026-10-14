CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"street" text NOT NULL,
	"postal_code" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'PL' NOT NULL,
	"phone" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_sender_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_country_check" CHECK ("addresses"."country" in ('PL'))
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_id_created_at_index" ON "addresses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_default_key" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_sender_default_key" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_sender_default";