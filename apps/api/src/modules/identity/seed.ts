// Konta testowe dla `pnpm db:reset` (zadanie db:seed, src/seed.ts): kupujący, sprzedający i admin
// z potwierdzonym e-mailem, zaakceptowanym regulaminem (z 18+) i zweryfikowanym telefonem, więc
// mogą od razu licytować i wystawiać. SMS-y na te numery nie są wysyłane. Tylko lokalnie i w testach: src/seed.ts
// odmawia przy NODE_ENV=production. Ponowne uruchomienie niczego nie dubluje.
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_VERSIONS } from '@biddy/shared';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';

import type { Database } from '../../infra/db/index.js';
import { accounts, type StaffRole, termsAcceptances, users } from './db/identity.schema.js';

/** Hasło wszystkich kont testowych (opisane w README). */
export const TEST_USER_PASSWORD = 'Biddy-test-2026';

export const TEST_USERS: readonly {
  readonly email: string;
  readonly name: string;
  readonly staffRole: StaffRole | null;
  readonly phoneNumber: string;
}[] = [
  {
    email: 'kupujacy@biddy.local',
    name: 'Kasia Kupująca',
    staffRole: null,
    phoneNumber: '+48500000001',
  },
  {
    email: 'sprzedajacy@biddy.local',
    name: 'Staszek Sprzedający',
    staffRole: null,
    phoneNumber: '+48500000002',
  },
  {
    email: 'admin@biddy.local',
    name: 'Ada Admin',
    staffRole: 'admin',
    phoneNumber: '+48500000003',
  },
];

/** Tworzy brakujące konta testowe; zwraca adresy kont dodanych w tym uruchomieniu. */
export async function seedTestUsers(db: Database): Promise<string[]> {
  const created: string[] = [];
  const password = await hashPassword(TEST_USER_PASSWORD);
  for (const user of TEST_USERS) {
    await db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .insert(users)
        .values({
          name: user.name,
          email: user.email,
          emailVerified: true,
          isAdultDeclaredAt: now,
          phoneNumber: user.phoneNumber,
          phoneNumberVerifiedAt: now,
          staffRole: user.staffRole,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (row === undefined) {
        return;
      }
      await tx.insert(accounts).values({
        userId: row.id,
        providerId: 'credential',
        accountId: row.id,
        password,
      });
      await tx.insert(termsAcceptances).values(
        LEGAL_DOCUMENTS.map((document) => ({
          userId: row.id,
          document,
          version: LEGAL_DOCUMENT_VERSIONS[document],
        })),
      );
      created.push(user.email);
    });
  }
  return created;
}

/** Czy konto testowe istnieje (testy seeda). */
export async function testUserExists(db: Database, email: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row !== undefined;
}
