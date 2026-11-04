import { Module } from '@nestjs/common';

import { ContentFilterService } from './content-filter/content-filter.service.js';
import { ReportService } from './reports/report.service.js';

/**
 * Moduł domenowy `trust-safety` (PROJECT.md §10.3): filtr słów w ofertach (F-14), zapis zgłoszeń
 * z rozmów (F-29); kolejki moderacji i decyzje w F-35. Publiczne API: ./index.ts.
 */
@Module({
  providers: [ContentFilterService, ReportService],
  exports: [ContentFilterService, ReportService],
})
export class TrustSafetyModule {}
