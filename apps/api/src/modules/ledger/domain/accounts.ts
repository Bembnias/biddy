// Plan kont ledgera (PROJECT.md §7.7): kody kont, ich typ, parametr i strona normalna salda.
// Kwoty wpisów są ze znakiem: + = Winien (debet), − = Ma (kredyt). Saldo konta to suma wpisów.
//
// Plik nie zależy od NestJS: importuje go plik tabel (ledger.schema.ts), który czyta drizzle-kit.
import type { CurrencyCode } from '@biddy/shared';

export const LEDGER_ACCOUNT_CODES = [
  'provider_cash',
  'seller_receivable',
  'carrier_claims_receivable',
  'buyer_funds_held',
  'seller_balance_available',
  'payouts_in_transit',
  'vat_payable',
  'platform_revenue_pok',
  'platform_shipping',
  'payment_fees_expense',
  'platform_losses',
  'platform_external',
] as const;
export type LedgerAccountCode = (typeof LEDGER_ACCOUNT_CODES)[number];

/** Typ konta; aktywa, koszty i konto rozliczeniowe mają saldo normalne po stronie Winien. */
export type LedgerAccountKind = 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE' | 'CLEARING';

/** Czym jest parametr konta (`subject`): operator płatności, ID albo brak (konto platformy). */
export type LedgerAccountSubject = 'NONE' | 'PROVIDER' | 'SELLER' | 'ORDER' | 'PAYOUT';

export interface LedgerAccountDefinition {
  readonly kind: LedgerAccountKind;
  readonly subject: LedgerAccountSubject;
  /** Konto dotyczy sprzedającego (`seller_id`): jego salda i środki jego zamówień i wypłat. */
  readonly seller: boolean;
  /** Saldo nie może przejść na stronę przeciwną do normalnej (CHECK w bazie). */
  readonly nonNegative: boolean;
}

export const LEDGER_ACCOUNTS: Readonly<Record<LedgerAccountCode, LedgerAccountDefinition>> = {
  provider_cash: { kind: 'ASSET', subject: 'PROVIDER', seller: false, nonNegative: false },
  seller_receivable: { kind: 'ASSET', subject: 'SELLER', seller: true, nonNegative: true },
  carrier_claims_receivable: { kind: 'ASSET', subject: 'NONE', seller: false, nonNegative: true },
  buyer_funds_held: { kind: 'LIABILITY', subject: 'ORDER', seller: true, nonNegative: true },
  seller_balance_available: {
    kind: 'LIABILITY',
    subject: 'SELLER',
    seller: true,
    nonNegative: true,
  },
  payouts_in_transit: { kind: 'LIABILITY', subject: 'PAYOUT', seller: true, nonNegative: true },
  vat_payable: { kind: 'LIABILITY', subject: 'NONE', seller: false, nonNegative: false },
  platform_revenue_pok: { kind: 'REVENUE', subject: 'NONE', seller: false, nonNegative: false },
  platform_shipping: { kind: 'REVENUE', subject: 'NONE', seller: false, nonNegative: false },
  payment_fees_expense: { kind: 'EXPENSE', subject: 'NONE', seller: false, nonNegative: false },
  platform_losses: { kind: 'EXPENSE', subject: 'NONE', seller: false, nonNegative: false },
  platform_external: { kind: 'CLEARING', subject: 'NONE', seller: false, nonNegative: false },
};

/** Konta danej właściwości, np. do ograniczeń CHECK w migracji. */
export function accountCodes(
  predicate: (definition: LedgerAccountDefinition, code: LedgerAccountCode) => boolean,
): LedgerAccountCode[] {
  return LEDGER_ACCOUNT_CODES.filter((code) => predicate(LEDGER_ACCOUNTS[code], code));
}

/** +1 dla kont z saldem normalnym po stronie Winien, −1 dla kont po stronie Ma. */
export function normalSign(code: LedgerAccountCode): 1 | -1 {
  const { kind } = LEDGER_ACCOUNTS[code];
  return kind === 'LIABILITY' || kind === 'REVENUE' ? -1 : 1;
}

/** Saldo po stronie normalnej konta, np. saldo dostępne sprzedającego jako kwota dodatnia. */
export function normalBalance(code: LedgerAccountCode, signedBalance: number): number {
  const balance = signedBalance * normalSign(code);
  return balance === 0 ? 0 : balance;
}

/** Konto planu kont w jednej walucie. */
export interface LedgerAccountRef {
  readonly code: LedgerAccountCode;
  /** Operator płatności, ID sprzedającego, zamówienia albo wypłaty; null dla kont platformy. */
  readonly subject: string | null;
  readonly currency: CurrencyCode;
}

/** Nazwa konta jak w §7.7, np. `provider_cash:fake` albo `vat_payable`. */
export function accountLabel(account: Pick<LedgerAccountRef, 'code' | 'subject'>): string {
  return account.subject === null ? account.code : `${account.code}:${account.subject}`;
}

/** Klucz konta w mapach (konta w różnych walutach są różnymi kontami). */
export function accountKey(account: LedgerAccountRef): string {
  return `${accountLabel(account)}@${account.currency}`;
}

/**
 * Stała kolejność kont (kod, potem parametr; porównanie punktów kodowych jak `COLLATE "C"`
 * w Postgresie). W tej kolejności ledger blokuje konta, więc dwa księgowania tych samych kont
 * się nie zakleszczą.
 */
export function compareAccounts(a: LedgerAccountRef, b: LedgerAccountRef): number {
  return (
    compareCodePoints(a.code, b.code) ||
    compareCodePoints(a.subject ?? '', b.subject ?? '') ||
    compareCodePoints(a.currency, b.currency)
  );
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
