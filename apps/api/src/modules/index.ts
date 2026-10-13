// Rejestr modułów domenowych (bounded contexts) w kolejności z PROJECT.md §10.3, importowany przez
// AppModule. Moduły importujemy tylko przez ich publiczne API (index.ts). Moduły domenowe nie
// importują tego pliku (reguła granic modułów w eslint.config.js).
//
// Nowy moduł: katalog src/modules/<nazwa>/ z <nazwa>.module.ts i index.ts, wpis poniżej
// oraz w test/unit/domain-modules.test.ts.
import { AdminModule } from './admin/index.js';
import { AuctionsModule } from './auctions/index.js';
import { CatalogModule } from './catalog/index.js';
import { ComplianceModule } from './compliance/index.js';
import { DisputesModule } from './disputes/index.js';
import { IdentityModule } from './identity/index.js';
import { LedgerModule } from './ledger/index.js';
import { MediaModule } from './media/index.js';
import { MessagingModule } from './messaging/index.js';
import { NotificationsModule } from './notifications/index.js';
import { OrdersModule } from './orders/index.js';
import { PaymentsModule } from './payments/index.js';
import { ReviewsModule } from './reviews/index.js';
import { SearchModule } from './search/index.js';
import { ShippingModule } from './shipping/index.js';
import { TrustSafetyModule } from './trust-safety/index.js';

export const DOMAIN_MODULES = [
  IdentityModule,
  CatalogModule,
  MediaModule,
  AuctionsModule,
  OrdersModule,
  PaymentsModule,
  LedgerModule,
  ShippingModule,
  DisputesModule,
  MessagingModule,
  ReviewsModule,
  NotificationsModule,
  SearchModule,
  TrustSafetyModule,
  ComplianceModule,
  AdminModule,
] as const;
