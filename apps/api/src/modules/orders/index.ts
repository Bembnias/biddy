/**
 * Publiczne API modułu `orders` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: checkout, maszyna stanów zamówienia, terminy, oferty drugiej szansy.
 * - OrderService: zamówienia sprzedanych aukcji, odczyty dla Moje Biddy i strony aukcji.
 * - OrderLifecycle: przejścia po opłaceniu, „Wszystko OK”, zaginięcie i joby terminów (F-26).
 * - SecondChanceService: oferty drugiej szansy (F-26).
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export {
  CHARGEBACK_STATUSES,
  ORDER_STATUSES,
  SECOND_CHANCE_STATUSES,
  type ChargebackStatus,
  type Order,
  type OrderStatus,
  type RunnerUp,
  type SecondChanceStatus,
} from './db/orders.schema.js';
export {
  CHECKOUT_PAYMENT_METHODS,
  PENDING_PAYMENT_GRACE_MS,
  type CheckoutPaymentMethod,
} from './checkout/checkout-rules.js';
export { type ExpireReport, OrderPaymentLifecycle } from './checkout/order-payment-lifecycle.js';
export {
  canTransition,
  FINAL_ORDER_STATUSES,
  IllegalOrderTransitionError,
  ORDER_TRANSITIONS,
} from './domain/order-state-machine.js';
export {
  COMPENSATION_DUE_MS,
  INSPECTION_WINDOW_MS,
  PAYMENT_REMINDERS_AFTER_MS,
  SHIP_REMINDER_BEFORE_MS,
} from './domain/lifecycle-rules.js';
export { type DeadlineReport, OrderLifecycle } from './lifecycle/order-lifecycle.js';
export {
  OrderCancelled,
  OrderCompleted,
  OrderCreated,
  OrderDelivered,
  OrderLost,
  OrderNotPickedUp,
  OrderPaid,
  OrderRefunded,
  OrderShipped,
  SecondChanceOffered,
  SecondChanceOfferResolved,
} from './orders.events.js';
export { OrdersModule } from './orders.module.js';
export type { OrderItemSnapshot } from './orders/order-snapshot.js';
export {
  type AuctionSale,
  type OrderRole,
  OrderService,
  PAYMENT_WINDOW_MS,
  type ParticipantOrder,
  type SecondChanceSale,
} from './orders/order.service.js';
export { SecondChanceService } from './second-chance/second-chance.service.js';
