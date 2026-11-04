// Schemat Drizzle całej aplikacji: zbiór tabel wszystkich modułów przekazywany do
// `drizzle(pool, { schema })` (zapytania relacyjne `db.query.*`).
//
// Konwencja: każdy moduł trzyma swoje tabele w `src/modules/<moduł>/db/*.schema.ts`, a warstwa
// infra w `src/infra/<nazwa>/db/*.schema.ts` (z tych plików drizzle-kit generuje migracje,
// patrz drizzle.config.ts). Nowy plik tabel dopisz tutaj:
//
//   export * from '../../modules/<moduł>/db/<nazwa>.schema.js';
//
// To jedyny plik infra, który może importować pliki modułów, i tylko pliki *.schema.ts
// (reguła granic modułów w eslint.config.js). Tabele innego modułu nie są jego publicznym API.
export * from '../outbox/db/outbox.schema.js';
export * from '../../modules/identity/db/identity.schema.js';
export * from '../../modules/identity/db/standing.schema.js';
export * from '../../modules/catalog/db/catalog.schema.js';
export * from '../../modules/media/db/media.schema.js';
export * from '../../modules/payments/db/payments.schema.js';
export * from '../../modules/payments/db/fake-gateway.schema.js';
export * from '../../modules/ledger/db/ledger.schema.js';
export * from '../../modules/shipping/db/shipping.schema.js';
export * from '../../modules/shipping/db/fake-shipping.schema.js';
export * from '../../modules/auctions/db/auctions.schema.js';
export * from '../../modules/orders/db/orders.schema.js';
export * from '../../modules/disputes/db/disputes.schema.js';
export * from '../../modules/messaging/db/messaging.schema.js';
export * from '../../modules/trust-safety/db/trust-safety.schema.js';
export * from '../../modules/notifications/db/notifications.schema.js';
