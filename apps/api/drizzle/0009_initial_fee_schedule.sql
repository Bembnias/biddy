-- Startowy cennik POK (F-13, PROJECT.md §3.1, decyzja nr 2 w §22): 2,99 zł opłaty stałej,
-- 7% kwoty do 1000 zł i 4% nadwyżki, VAT 23%. Migracja danych, więc cennik jest w każdym
-- środowisku. Zmiana stawek to nowy cennik (FeeScheduleService.publish), nie edycja tego wiersza.
INSERT INTO "fee_schedules" ("id", "currency", "fixed_fee", "tiers", "vat_rate_bp", "valid_from", "valid_to", "note") VALUES
  ('019b76da-a800-7473-8d63-395c20bf8898', 'PLN', 299, '[{"upTo":100000,"bp":700},{"upTo":null,"bp":400}]'::jsonb, 2300, '2026-01-01T00:00:00Z', NULL, 'Startowy cennik (PROJECT.md §3.1)');
