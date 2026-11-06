/**
 * Publiczne API modułu `ledger` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: księga podwójnego zapisu (F-22), uzgodnienia z operatorem (F-33).
 * - LedgerService.post(tx, posting): księgowanie zdarzenia według szablonu z §7.7 w transakcji
 *   wywołującego; reverse: storno; balance, heldForOrder, sellerBalances: salda;
 *   sellerHistory: historia salda sprzedającego, dormantSellerBalances: salda uśpione (F-27).
 * - LedgerIntegrity.verify(): salda odtworzone z wpisów i bilans transakcji.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export {
  LEDGER_ACCOUNT_CODES,
  type LedgerAccountCode,
  type LedgerAccountRef,
} from './domain/accounts.js';
export { LedgerError, type LedgerErrorCode } from './domain/ledger-error.js';
export {
  type CarrierClaimSettled,
  type ChargebackAbsorbed,
  type ChargebackChargedToSeller,
  type CompensationChannel,
  type DisputeCostsCharged,
  FULL_REFUND_REASONS,
  type FullRefundReason,
  type LedgerPosting,
  type NotPickedUpRefunded,
  type OrderAmounts,
  type OrderCompleted,
  type OrderPartiallyRefunded,
  type OrderRefunded,
  type ParcelCompensationPaid,
  type PaymentFeeCharged,
  type PaymentReceived,
  type PayoutCompleted,
  type PayoutFailed,
  type PayoutRequested,
  type ReceivableWrittenOff,
} from './domain/postings.js';
export {
  LEDGER_TRANSACTION_TYPES,
  type LedgerTransactionType,
} from './domain/transaction-types.js';
export {
  type LedgerBalanceMismatch,
  LedgerIntegrity,
  LedgerIntegrityError,
  type LedgerIntegrityReport,
  type UnbalancedLedgerTransaction,
} from './ledger-integrity.js';
export { LedgerModule } from './ledger.module.js';
export {
  type DormantSellerBalance,
  type PostedLedgerEntry,
  type PostedLedgerTransaction,
  type ReverseLedgerTransactionInput,
  type SellerBalanceMovement,
  type SellerBalances,
  type SellerHistoryPage,
  LedgerService,
} from './ledger.service.js';
