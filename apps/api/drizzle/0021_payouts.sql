-- Saldo i wypłaty (F-27, PROJECT.md §7.6, §16.1, §17): dane do wypłat sprzedającego niezależne
-- od operatora (dane DAC7 i rachunek zaszyfrowane AES-256-GCM w aplikacji, maska rachunku,
-- blokada 48 h po zmianie rachunku, wypłata tygodniowa) i wypłaty z salda (zlecenie razem
-- z księgowaniem PAYOUT_REQUESTED, wynik z webhooka operatora).
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payout_id" text,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"bank_account_masked" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"paid_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_amount_check" CHECK ("payouts"."amount" > 0),
	CONSTRAINT "payouts_trigger_check" CHECK (trigger in ('MANUAL', 'WEEKLY', 'DORMANT_BALANCE', 'ACCOUNT_CLOSURE')),
	CONSTRAINT "payouts_status_check" CHECK (status in ('PENDING', 'PAID', 'FAILED')),
	CONSTRAINT "payouts_failure_reason_check" CHECK ((status = 'FAILED') = (failure_reason is not null) and (failure_reason is null or failure_reason in ('REJECTED', 'SELLER_NOT_VERIFIED', 'INSUFFICIENT_BALANCE', 'INVALID_REQUEST'))),
	CONSTRAINT "payouts_paid_at_check" CHECK (("payouts"."status" = 'PAID') = ("payouts"."paid_at" is not null)),
	CONSTRAINT "payouts_failed_at_check" CHECK (("payouts"."status" = 'FAILED') = ("payouts"."failed_at" is not null)),
	CONSTRAINT "payouts_idempotency_key_check" CHECK (length("payouts"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "seller_payout_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"personal_data" "bytea",
	"personal_data_updated_at" timestamp with time zone,
	"bank_account" "bytea",
	"bank_account_masked" text,
	"bank_account_changed_at" timestamp with time zone,
	"payouts_blocked_until" timestamp with time zone,
	"weekly_payouts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_payout_profiles_personal_data_check" CHECK (("seller_payout_profiles"."personal_data" is null) = ("seller_payout_profiles"."personal_data_updated_at" is null)),
	CONSTRAINT "seller_payout_profiles_bank_account_check" CHECK (("seller_payout_profiles"."bank_account" is null) = ("seller_payout_profiles"."bank_account_masked" is null) and ("seller_payout_profiles"."bank_account" is null) = ("seller_payout_profiles"."bank_account_changed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_idempotency_key" ON "payouts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_provider_payout_id" ON "payouts" USING btree ("provider","provider_payout_id");--> statement-breakpoint
CREATE INDEX "payouts_seller_id_created_at_index" ON "payouts" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "seller_payout_profiles_weekly" ON "seller_payout_profiles" USING btree ("user_id") WHERE "seller_payout_profiles"."weekly_payouts";