-- Wiadomości (F-29, PROJECT.md §10.3, §16.2): rozmowy o aukcji (para aukcja i druga strona,
-- zamówienie liczone przy odczycie), wiadomości z odbiorcą, odczytem, powiadomieniem i flagami
-- danych kontaktowych, blokady między użytkownikami, zdjęcia w wiadomościach jako prywatne
-- przeznaczenie mediów (MESSAGE_PHOTO) i zgłoszenia DSA (reports, moduł trust-safety; kolejka
-- i decyzje w F-35).
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auction_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_parties_check" CHECK ("conversations"."seller_id" <> "conversations"."buyer_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"contact_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"read_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_parties_check" CHECK ("messages"."sender_id" <> "messages"."recipient_id"),
	CONSTRAINT "messages_content_check" CHECK (char_length(body) <= 2000 and cardinality(media_ids) <= 5 and (char_length(body) > 0 or cardinality(media_ids) > 0)),
	CONSTRAINT "messages_contact_flags_check" CHECK (contact_flags <@ array['PHONE', 'EMAIL', 'IBAN']::text[])
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_parties_check" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"context" jsonb NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_target_type_check" CHECK (target_type in ('MESSAGE', 'USER')),
	CONSTRAINT "reports_reason_check" CHECK (reason in ('OFF_PLATFORM', 'SCAM', 'ABUSE', 'SPAM', 'OTHER')),
	CONSTRAINT "reports_status_check" CHECK (status in ('OPEN'))
);
--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_purpose_check";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_auction_id_buyer_id_key" ON "conversations" USING btree ("auction_id","buyer_id");--> statement-breakpoint
CREATE INDEX "conversations_seller_id_last_message_at_index" ON "conversations" USING btree ("seller_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_buyer_id_last_message_at_index" ON "conversations" USING btree ("buyer_id","last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_id_index" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "messages_sender_id_created_at_index" ON "messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("recipient_id","conversation_id") WHERE "messages"."read_at" is null;--> statement-breakpoint
CREATE INDEX "messages_unnotified_idx" ON "messages" USING btree ("created_at") WHERE "messages"."read_at" is null and "messages"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "messages_flagged_sender_idx" ON "messages" USING btree ("sender_id") WHERE "messages"."contact_flags" <> '{}'::text[];--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_id_index" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_reporter_target_key" ON "reports" USING btree ("reporter_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_status_created_at_index" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('ITEM_PHOTO', 'AVATAR', 'DISPUTE_EVIDENCE', 'MESSAGE_PHOTO'));