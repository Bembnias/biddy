-- Ledger (F-22, PROJECT.md §7.7): księga podwójnego zapisu. Konta planu kont (ledger_accounts)
-- z saldem = suma wpisów, transakcje księgowe (ledger_transactions) i wpisy (ledger_entries)
-- z kwotą ze znakiem (+ Winien, − Ma). Gwarancje w bazie (triggery na końcu pliku):
-- - saldo konta zmienia wyłącznie trigger przy wstawieniu wpisu, więc zawsze da się je odtworzyć
--   z samych wpisów, a CHECK nie pozwala kontom użytkowników i zamówień przejść na złą stronę,
-- - transakcja ma co najmniej dwa wpisy, które sumują się do zera (odroczone sprawdzenie przy
--   zatwierdzeniu, bo transakcję i wpisy wstawiamy osobnymi poleceniami),
-- - wpisy, transakcje i konta są niemodyfikowalne (korekta to nowa transakcja, np. storno).
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"subject" text,
	"currency" char(3) NOT NULL,
	"seller_id" uuid,
	"seller_amount" bigint,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_key" UNIQUE NULLS NOT DISTINCT("code","subject","currency"),
	CONSTRAINT "ledger_accounts_code_check" CHECK (code in ('provider_cash', 'seller_receivable', 'carrier_claims_receivable', 'buyer_funds_held', 'seller_balance_available', 'payouts_in_transit', 'vat_payable', 'platform_revenue_pok', 'platform_shipping', 'payment_fees_expense', 'platform_losses', 'platform_external')),
	CONSTRAINT "ledger_accounts_subject_check" CHECK ((code in ('provider_cash', 'seller_receivable', 'buyer_funds_held', 'seller_balance_available', 'payouts_in_transit')) = (subject is not null)),
	CONSTRAINT "ledger_accounts_seller_check" CHECK ((code in ('seller_receivable', 'buyer_funds_held', 'seller_balance_available', 'payouts_in_transit')) = (seller_id is not null) and (code not in ('seller_receivable', 'seller_balance_available') or subject = seller_id::text)),
	CONSTRAINT "ledger_accounts_seller_amount_check" CHECK (("ledger_accounts"."code" = 'buyer_funds_held') = ("ledger_accounts"."seller_amount" is not null) and ("ledger_accounts"."seller_amount" is null or "ledger_accounts"."seller_amount" >= 0)),
	CONSTRAINT "ledger_accounts_balance_side_check" CHECK ((code not in ('buyer_funds_held', 'seller_balance_available', 'payouts_in_transit') or balance <= 0) and (code not in ('seller_receivable', 'carrier_claims_receivable') or balance >= 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "ledger_entries_amount_check" CHECK ("ledger_entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"currency" char(3) NOT NULL,
	"order_id" uuid,
	"payout_id" uuid,
	"reverses_transaction_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_type_check" CHECK (type in ('PAYMENT_RECEIVED', 'ORDER_COMPLETED', 'ORDER_REFUNDED', 'NOT_PICKED_UP_REFUNDED', 'ORDER_PARTIALLY_REFUNDED', 'PAYOUT_REQUESTED', 'PAYOUT_COMPLETED', 'PAYOUT_FAILED', 'PAYMENT_FEE_CHARGED', 'DISPUTE_COSTS_CHARGED', 'CHARGEBACK_ABSORBED', 'CHARGEBACK_CHARGED_TO_SELLER', 'PARCEL_COMPENSATION_PAID', 'CARRIER_CLAIM_SETTLED', 'RECEIVABLE_WRITTEN_OFF', 'REVERSAL')),
	CONSTRAINT "ledger_transactions_reversal_check" CHECK (("ledger_transactions"."type" = 'REVERSAL') = ("ledger_transactions"."reverses_transaction_id" is not null)),
	CONSTRAINT "ledger_transactions_idempotency_key_check" CHECK (length("ledger_transactions"."idempotency_key") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_accounts_seller_id_code_index" ON "ledger_accounts" USING btree ("seller_id","code");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_id_id_index" ON "ledger_entries" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_id_index" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_reverses_key" ON "ledger_transactions" USING btree ("reverses_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_order_id_index" ON "ledger_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_payout_id_index" ON "ledger_transactions" USING btree ("payout_id");--> statement-breakpoint
CREATE FUNCTION "ledger_entries_apply"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_currency char(3);
  transaction_currency char(3);
BEGIN
  SELECT currency INTO transaction_currency FROM ledger_transactions WHERE id = NEW.transaction_id;
  UPDATE ledger_accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id
    RETURNING currency INTO account_currency;
  IF account_currency IS DISTINCT FROM transaction_currency THEN
    RAISE EXCEPTION 'Wpis % jest w walucie konta (%) innej niż waluta transakcji (%)',
      NEW.id, account_currency, transaction_currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_apply" AFTER INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_apply"();--> statement-breakpoint
CREATE FUNCTION "ledger_assert_balanced"(target uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  total numeric;
  entry_count integer;
BEGIN
  SELECT coalesce(sum(amount), 0), count(*) INTO total, entry_count
    FROM ledger_entries WHERE transaction_id = target;
  IF entry_count < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'Transakcja księgowa % nie bilansuje się: % wpisów, suma %',
      target, entry_count, total
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;--> statement-breakpoint
CREATE FUNCTION "ledger_entries_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.transaction_id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_entries_balanced" AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_entries_balanced"();--> statement-breakpoint
CREATE FUNCTION "ledger_transactions_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_balanced(NEW.id);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ledger_transactions_balanced" AFTER INSERT ON "ledger_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_transactions_balanced"();--> statement-breakpoint
CREATE FUNCTION "ledger_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Księga jest niemodyfikowalna: % w tabeli % jest zabronione (korekta to nowa transakcja)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_entries_immutable" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_immutable"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_immutable"();--> statement-breakpoint
CREATE TRIGGER "ledger_transactions_immutable" BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION "ledger_immutable"();--> statement-breakpoint
CREATE TRIGGER "ledger_transactions_no_truncate" BEFORE TRUNCATE ON "ledger_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_immutable"();--> statement-breakpoint
CREATE TRIGGER "ledger_accounts_no_truncate" BEFORE TRUNCATE ON "ledger_accounts"
  FOR EACH STATEMENT EXECUTE FUNCTION "ledger_immutable"();--> statement-breakpoint
-- Nowe konto ma saldo 0; UPDATE może zmienić tylko saldo i tylko z triggera wpisów
-- (ledger_entries_apply wykonuje UPDATE na głębokości 1, więc ten trigger działa na głębokości 2).
CREATE FUNCTION "ledger_accounts_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Konto księgowe % jest niemodyfikowalne: nie można go usunąć', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 THEN
      RAISE EXCEPTION 'Nowe konto księgowe musi mieć saldo 0 (saldo wynika z wpisów)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() < 2
     OR (NEW.id, NEW.code, NEW.subject, NEW.currency, NEW.seller_id, NEW.seller_amount, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.code, OLD.subject, OLD.currency, OLD.seller_id, OLD.seller_amount, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Konto księgowe % jest niemodyfikowalne: saldo zmienia tylko nowy wpis', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_accounts_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "ledger_accounts_guard"();
