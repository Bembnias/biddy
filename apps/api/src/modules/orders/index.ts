/**
 * Publiczne API modułu `orders` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: checkout, maszyna stanów zamówienia, terminy, oferty drugiej szansy.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { ORDER_STATUSES, type Order, type OrderStatus } from './db/orders.schema.js';
export { OrderCreated } from './orders.events.js';
export { OrdersModule } from './orders.module.js';
export type { OrderItemSnapshot } from './orders/order-snapshot.js';
export { type AuctionSale, OrderService, PAYMENT_WINDOW_MS } from './orders/order.service.js';
