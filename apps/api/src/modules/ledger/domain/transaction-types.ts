// Typy transakcji księgowych: szablony księgowań z PROJECT.md §7.7 i §7.9 oraz storno.
//
// Plik nie zależy od NestJS ani od kodu w czasie działania: importuje go plik tabel
// (ledger.schema.ts), który czyta drizzle-kit.
export const LEDGER_TRANSACTION_TYPES = [
  'PAYMENT_RECEIVED',
  'ORDER_COMPLETED',
  'ORDER_REFUNDED',
  'NOT_PICKED_UP_REFUNDED',
  'ORDER_PARTIALLY_REFUNDED',
  'PAYOUT_REQUESTED',
  'PAYOUT_COMPLETED',
  'PAYOUT_FAILED',
  'PAYMENT_FEE_CHARGED',
  'DISPUTE_COSTS_CHARGED',
  'CHARGEBACK_ABSORBED',
  'CHARGEBACK_CHARGED_TO_SELLER',
  'PARCEL_COMPENSATION_PAID',
  'CARRIER_CLAIM_SETTLED',
  'RECEIVABLE_WRITTEN_OFF',
  'REVERSAL',
] as const;
export type LedgerTransactionType = (typeof LEDGER_TRANSACTION_TYPES)[number];
