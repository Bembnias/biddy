-- Obserwowane i powiadomienia (F-20): obserwowane aukcje (auctions), obserwowani sprzedawcy
-- (identity), powiadomienia z deduplikacją po (user_id, dedupe_key) i preferencje per typ i kanał.
CREATE TABLE "watchlist" (
	"user_id" uuid NOT NULL,
	"auction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_user_id_auction_id_pk" PRIMARY KEY("user_id","auction_id")
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"follower_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_id_seller_id_pk" PRIMARY KEY("follower_id","seller_id"),
	CONSTRAINT "user_follows_not_self_check" CHECK ("user_follows"."follower_id" <> "user_follows"."seller_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_channel_pk" PRIMARY KEY("user_id","type","channel"),
	CONSTRAINT "notification_preferences_channel_check" CHECK ("notification_preferences"."channel" in ('IN_APP', 'EMAIL'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"auction_id" uuid,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_auction_id_index" ON "watchlist" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "user_follows_seller_id_index" ON "user_follows" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_index" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_index" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_index" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_id_type_auction_id_emailed_at_index" ON "notifications" USING btree ("user_id","type","auction_id","emailed_at");