-- Drzewo kategorii (F-11): ścieżki ltree (etykiety ze slugów; myślnik w etykiecie od PostgreSQL 16).
CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"path" "ltree" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_restricted" boolean DEFAULT false NOT NULL,
	"is_brand_sensitive" boolean DEFAULT false NOT NULL,
	"listing_notice" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_path_key" ON "categories" USING btree ("path");--> statement-breakpoint
CREATE INDEX "categories_path_gist" ON "categories" USING gist ("path");--> statement-breakpoint
CREATE INDEX "categories_parent_id_position_index" ON "categories" USING btree ("parent_id","position");