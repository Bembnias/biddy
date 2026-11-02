import { Injectable } from '@nestjs/common';

import { checkListingText, type FilterResult } from './content-filter.js';

/**
 * Filtr słów w ofertach (F-14). Serwis, żeby lista mogła później pochodzić z konfiguracji
 * moderacji (F-35) bez zmian u wywołujących.
 */
@Injectable()
export class ContentFilterService {
  /** Sprawdza pola oferty, np. `{ title, description, brand }`. */
  checkListing(fields: Readonly<Record<string, string | null | undefined>>): FilterResult {
    return checkListingText(fields);
  }
}
