-- Cenniki POK (F-13, PROJECT.md §3.1). Wersje z okresem obowiązywania [valid_from, valid_to):
-- w danej walucie w każdej chwili obowiązuje dokładnie jeden cennik (ograniczenie wykluczające),
-- a wiersz jest niezmienny poza zamknięciem bieżącego cennika (trigger), bo zamówienia pamiętają
-- fee_schedule_id i muszą dać się przeliczyć tak samo.
-- btree_gist: równość waluty w indeksie GiST razem z zakresem czasu (rozszerzenie zaufane, PG 13+).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) NOT NULL,
	"fixed_fee" bigint NOT NULL,
	"tiers" jsonb NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_schedules_fixed_fee_check" CHECK ("fee_schedules"."fixed_fee" >= 0),
	CONSTRAINT "fee_schedules_vat_rate_bp_check" CHECK ("fee_schedules"."vat_rate_bp" between 0 and 10000),
	CONSTRAINT "fee_schedules_valid_range_check" CHECK ("fee_schedules"."valid_to" is null or "fee_schedules"."valid_to" > "fee_schedules"."valid_from"),
	CONSTRAINT "fee_schedules_tiers_check" CHECK (jsonb_typeof("fee_schedules"."tiers") = 'array' and jsonb_array_length("fee_schedules"."tiers") > 0)
);
--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_no_overlap" EXCLUDE USING gist ("currency" WITH =, tstzrange("valid_from", "valid_to") WITH &&);--> statement-breakpoint
CREATE FUNCTION "fee_schedules_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cennik POK % jest niezmienny: nie można go usunąć', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.valid_to IS NOT NULL
     OR NEW.valid_to IS NULL
     OR (NEW.id, NEW.currency, NEW.fixed_fee, NEW.tiers, NEW.vat_rate_bp, NEW.valid_from, NEW.note, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.currency, OLD.fixed_fee, OLD.tiers, OLD.vat_rate_bp, OLD.valid_from, OLD.note, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Cennik POK % jest niezmienny: wolno tylko zamknąć bieżący cennik (valid_to)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "fee_schedules_immutable" BEFORE UPDATE OR DELETE ON "fee_schedules"
  FOR EACH ROW EXECUTE FUNCTION "fee_schedules_immutable"();
