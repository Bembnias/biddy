CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"code_hash" text NOT NULL,
	"ip" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_verifications_user_id_created_at_index" ON "phone_verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "phone_verifications_phone_number_created_at_index" ON "phone_verifications" USING btree ("phone_number","created_at");--> statement-breakpoint
CREATE INDEX "phone_verifications_ip_created_at_index" ON "phone_verifications" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_key" ON "users" USING btree ("phone_number");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_number_check" CHECK (("users"."phone_number" is null) = ("users"."phone_number_verified_at" is null));