import { Module } from '@nestjs/common';

import { ContentFilterService } from './content-filter/content-filter.service.js';

/**
 * Moduł domenowy `trust-safety` (PROJECT.md §10.3): filtr słów w ofertach (F-14); zgłoszenia
 * i kolejki moderacji w F-35. Publiczne API: ./index.ts.
 */
@Module({
  providers: [ContentFilterService],
  exports: [ContentFilterService],
})
export class TrustSafetyModule {}
