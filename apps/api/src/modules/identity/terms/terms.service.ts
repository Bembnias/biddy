import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_VERSIONS } from '@biddy/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { type Database, DRIZZLE } from '../../../infra/db/index.js';
import { termsAcceptances } from '../db/identity.schema.js';

/** Akceptacje regulaminu i polityki prywatności z wersją, czasem i IP (PROJECT.md §13.3). */
@Injectable()
export class TermsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Zapisuje akceptację aktualnych wersji wszystkich dokumentów. */
  async acceptCurrent(userId: string, ip: string | undefined): Promise<void> {
    await this.db.insert(termsAcceptances).values(
      LEGAL_DOCUMENTS.map((document) => ({
        userId,
        document,
        version: LEGAL_DOCUMENT_VERSIONS[document],
        ip: ip ?? null,
      })),
    );
  }

  /** Czy użytkownik zaakceptował aktualne wersje wszystkich dokumentów. */
  async hasAcceptedCurrent(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ document: termsAcceptances.document, version: termsAcceptances.version })
      .from(termsAcceptances)
      .where(
        and(
          eq(termsAcceptances.userId, userId),
          inArray(termsAcceptances.document, [...LEGAL_DOCUMENTS]),
        ),
      );
    return LEGAL_DOCUMENTS.every((document) =>
      rows.some(
        (row) => row.document === document && row.version === LEGAL_DOCUMENT_VERSIONS[document],
      ),
    );
  }
}
