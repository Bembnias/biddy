/**
 * Publiczne API modułu `trust-safety` (PROJECT.md §10.3).
 *
 * Odpowiedzialność: zgłoszenia (DSA), reguły antyfraudowe, kolejki moderacji.
 *
 * Inne moduły korzystają z tego modułu wyłącznie przez ten plik albo przez eventy domenowe,
 * nigdy przez jego wewnętrzne pliki ani tabele (reguła granic modułów w eslint.config.js).
 */
export { type FilterMatch, type FilterResult } from './content-filter/content-filter.js';
export { ContentFilterService } from './content-filter/content-filter.service.js';
export type { FilterVerdict } from './content-filter/listing-terms.js';
export {
  REPORT_TARGET_TYPES,
  type ReportContext,
  type ReportedMessage,
  type ReportRow,
  type ReportTargetType,
} from './db/trust-safety.schema.js';
export { type CreateReportInput, ReportService } from './reports/report.service.js';
export { ReportCreated } from './trust-safety.events.js';
export { TrustSafetyModule } from './trust-safety.module.js';
