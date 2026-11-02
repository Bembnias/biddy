// `pnpm --filter @biddy/api db:seed` (uruchamia go też `pnpm db:reset` po migracjach): dane
// testowe na lokalnej bazie spod DATABASE_URL. Na razie konta użytkowników (F-07); kolejne
// moduły dopiszą tu swoje dane (kategorie F-11, aukcje F-14). Odmawia przy NODE_ENV=production.
import { drizzle } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import { envSchema } from './infra/config/index.js';
import { createPool } from './infra/db/database.js';
import { TEST_USERS, TEST_USER_PASSWORD, seedTestUsers } from './modules/identity/index.js';

const PREFIX = '[db:seed]';

const parsed = z
  .object({ DATABASE_URL: envSchema.shape.DATABASE_URL })
  .safeParse({ DATABASE_URL: process.env['DATABASE_URL']?.trim() || undefined });
if (!parsed.success) {
  console.error(`${PREFIX} Brak lub niepoprawny DATABASE_URL (szablon: .env.example).`);
  process.exit(1);
}
if (process.env['NODE_ENV'] === 'production') {
  console.error(`${PREFIX} Odmowa: seed z kontami testowymi nie działa przy NODE_ENV=production.`);
  process.exit(1);
}

const pool = createPool({ url: parsed.data.DATABASE_URL, poolMax: 2 });
try {
  // Bez schematu relacyjnego: seed modułu korzysta z budowniczego zapytań na własnych tabelach.
  const created = await seedTestUsers(drizzle(pool, { casing: 'snake_case' }));
  console.log(
    `${PREFIX} Konta testowe (hasło ${TEST_USER_PASSWORD}): ${TEST_USERS.map((user) => user.email).join(', ')}` +
      (created.length === 0 ? ' (już istniały)' : ` (utworzono ${created.length})`),
  );
} finally {
  await pool.end();
}
