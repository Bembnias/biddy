CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"rejection_reason" text,
	"moderation_labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"attached_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_purpose_check" CHECK ("media"."purpose" in ('ITEM_PHOTO', 'AVATAR')),
	CONSTRAINT "media_status_check" CHECK ("media"."status" in ('PENDING_UPLOAD', 'PROCESSING', 'READY', 'FLAGGED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
CREATE INDEX "media_owner_id_created_at_index" ON "media" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "media_unattached_created_at_index" ON "media" USING btree ("created_at") WHERE "media"."attached_at" is null;