import { Module } from '@nestjs/common';

import { LedgerIntegrity } from './ledger-integrity.js';
import { LedgerService } from './ledger.service.js';

/**
 * Moduł domenowy `ledger` (PROJECT.md §10.3, §7.7): księga podwójnego zapisu (F-22); uzgodnienia
 * z operatorem w F-33. Publiczne API: ./index.ts.
 */
@Module({
  providers: [LedgerService, LedgerIntegrity],
  exports: [LedgerService, LedgerIntegrity],
})
export class LedgerModule {}
