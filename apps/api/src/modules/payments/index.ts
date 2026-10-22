/**
 * Publiczne API modułu `payments` (PROJECT.md §10.3, §7.8).
 *
 * Odpowiedzialność: cenniki POK (F-13), port płatności i adaptery operatorów, płatności
 * zamówień, konta sprzedawców u operatora, webhooki i polling zapasowy (F-23); zwroty,
 * chargebacki i wypłaty w kolejnych feature'ach.
 * - PaymentService.createPayment: płatność zamówienia u operatora domyślnego (checkout, F-25).
 * - SellerAccountService.register / find: konto sprzedawcy u operatora (rejestracja: F-32).
 * - GatewayRegistry: adapter dla operatora z rekordu i operator domyślny.
 * - PaymentEventProcessor, PendingPaymentsPoller: tor zdarzeń operatora (webhook, polling).
 * - Eventy: PaymentSucceeded, PaymentFailed, SellerKycStatusChanged.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { FAKE_BLIK_CODES } from './adapters/fake/fake-scenarios.js';
export { GatewayRegistry, UnknownPaymentProviderError } from './application/gateway-registry.js';
export {
  PaymentEventProcessor,
  UnknownWebhookSubjectError,
  type WebhookReceipt,
} from './application/payment-event-processor.js';
export { PaymentAmountMismatchError } from './application/payment-transitions.js';
export {
  type CreatePaymentCommand,
  PaymentService,
  type PaymentView,
} from './application/payment.service.js';
export {
  POLL_PENDING_AFTER_MINUTES,
  PendingPaymentsPoller,
  type PollReport,
} from './application/pending-payments-poller.js';
export {
  type RegisterSellerCommand,
  type SellerAccount,
  SellerAccountService,
} from './application/seller-account.service.js';
export {
  PAYMENT_FAILURE_REASONS,
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  SELLER_ACCOUNT_TYPES,
  SELLER_STATUSES,
  type PaymentFailureReason,
  type PaymentMethodType,
  type PaymentProvider,
  type PaymentStatus,
  type SellerAccountType,
  type SellerStatus,
} from './domain/payment-values.js';
export {
  type FeeQuote,
  FeeScheduleService,
  type FeeScheduleVersion,
  type PublishFeeScheduleInput,
} from './fees/fee-schedule.service.js';
export { PaymentsModule } from './payments.module.js';
export { PaymentFailed, PaymentSucceeded, SellerKycStatusChanged } from './payments.events.js';
export {
  type GatewayCapabilities,
  type NormalizedPaymentEvent,
  type PaymentGateway,
  PaymentGatewayError,
  type PaymentGatewayErrorCode,
  type PaymentMethod,
} from './ports/payment-gateway.port.js';
