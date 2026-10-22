-- Płatności (F-23, PROJECT.md §7.8): płatności zamówień u operatora (payments), konta
-- sprzedawców u operatora (seller_accounts) i idempotencja webhooków (processed_webhooks).
-- Tabele fake_gateway_* to stan adaptera testowego FakeGateway (symulowany operator); na
-- produkcji FakeGateway jest zablokowany, więc zostają puste.
CREATE TABLE "fake_gateway_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"object_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fake_gateway_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_ref" uuid NOT NULL,
	"seller_id" text NOT NULL,
	"method" text NOT NULL,
	"scenario" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"seller_amount" bigint NOT NULL,
	"platform_amount" bigint NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"refunded_amount" bigint DEFAULT 0 NOT NULL,
	"return_url" text NOT NULL,
	"chargeback_id" text,
	"chargeback_status" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_gateway_payments_status_check" CHECK (status in ('PENDING', 'SUCCEEDED', 'FAILED') and (failure_reason is null or failure_reason in ('DECLINED', 'INVALID_BLIK_CODE', 'EXPIRED', 'CANCELLED', 'SELLER_NOT_VERIFIED', 'PROVIDER_ERROR'))),
	CONSTRAINT "fake_gateway_payments_amounts_check" CHECK ("fake_gateway_payments"."amount" > 0 and "fake_gateway_payments"."seller_amount" + "fake_gateway_payments"."platform_amount" = "fake_gateway_payments"."amount" and "fake_gateway_payments"."refunded_amount" between 0 and "fake_gateway_payments"."amount")
);
--> statement-breakpoint
CREATE TABLE "fake_gateway_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_gateway_payouts_amount_check" CHECK ("fake_gateway_payouts"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fake_gateway_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_gateway_refunds_amount_check" CHECK ("fake_gateway_refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fake_gateway_sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_ref" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"currency" char(3) NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fake_gateway_sellers_status_check" CHECK (status in ('PENDING', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"method" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" bigint NOT NULL,
	"seller_amount" bigint NOT NULL,
	"platform_amount" bigint NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"redirect_url" text,
	"idempotency_key" text NOT NULL,
	"raw" jsonb,
	"polled_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_check" CHECK (status in ('PENDING', 'SUCCEEDED', 'FAILED')),
	CONSTRAINT "payments_method_check" CHECK (method in ('BLIK', 'CARD', 'PAY_BY_LINK', 'APPLE_PAY', 'GOOGLE_PAY')),
	CONSTRAINT "payments_failure_reason_check" CHECK ((status = 'FAILED') = (failure_reason is not null) and (failure_reason is null or failure_reason in ('DECLINED', 'INVALID_BLIK_CODE', 'EXPIRED', 'CANCELLED', 'SELLER_NOT_VERIFIED', 'PROVIDER_ERROR'))),
	CONSTRAINT "payments_amounts_check" CHECK ("payments"."amount" > 0 and "payments"."seller_amount" >= 0 and "payments"."platform_amount" >= 0 and "payments"."seller_amount" + "payments"."platform_amount" = "payments"."amount"),
	CONSTRAINT "payments_idempotency_key_check" CHECK (length("payments"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "processed_webhooks" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhooks_provider_event_id_pk" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "processed_webhooks_outcome_check" CHECK (outcome in ('HANDLED', 'IGNORED'))
);
--> statement-breakpoint
CREATE TABLE "seller_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"type" text NOT NULL,
	"kyc_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_accounts_type_check" CHECK (type in ('PRIVATE', 'BUSINESS')),
	CONSTRAINT "seller_accounts_kyc_status_check" CHECK (kyc_status in ('PENDING', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "fake_gateway_payments" ADD CONSTRAINT "fake_gateway_payments_seller_id_fake_gateway_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."fake_gateway_sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fake_gateway_payouts" ADD CONSTRAINT "fake_gateway_payouts_seller_id_fake_gateway_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."fake_gateway_sellers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fake_gateway_refunds" ADD CONSTRAINT "fake_gateway_refunds_payment_id_fake_gateway_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fake_gateway_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fake_gateway_events_object_id_index" ON "fake_gateway_events" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "fake_gateway_events_created_at_index" ON "fake_gateway_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fake_gateway_payments_idempotency_key" ON "fake_gateway_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "fake_gateway_payments_created_at_index" ON "fake_gateway_payments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fake_gateway_payouts_idempotency_key" ON "fake_gateway_payouts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fake_gateway_refunds_idempotency_key" ON "fake_gateway_refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "fake_gateway_refunds_payment_id_index" ON "fake_gateway_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fake_gateway_sellers_idempotency_key" ON "fake_gateway_sellers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_id" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_status_created_at_index" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payments_order_id_index" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_accounts_user_provider" ON "seller_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_accounts_provider_account" ON "seller_accounts" USING btree ("provider","provider_account_id");