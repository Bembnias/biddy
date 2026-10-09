// Konfiguracja drizzle-kit: generowanie migracji SQL z definicji tabel modułów.
//   pnpm --filter @biddy/api db:generate                         migracja ze zmian w tabelach
//   pnpm --filter @biddy/api exec drizzle-kit generate --custom --name <nazwa>   własny SQL
// Migracje stosuje `db:migrate` (src/infra/db/migrate.ts), lokalnie także `pnpm db:reset`.
// Ścieżki są względne wobec apps/api (stąd uruchamiają drizzle-kit skrypty pakietu).
import { existsSync, globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

// DATABASE_URL (potrzebny do `drizzle-kit migrate` i `studio`, nie do `generate`) czytamy z .env
// w katalogu głównym repozytorium. Zmienne ustawione w powłoce mają pierwszeństwo.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}
const databaseUrl = process.env['DATABASE_URL']?.trim();

// Konwencja: tabele modułu leżą w src/modules/<moduł>/db/*.schema.ts (patrz src/infra/db/schema.ts).
const MODULE_SCHEMAS = 'src/modules/*/db/*.schema.ts';
// drizzle-kit kończy się błędem, gdy wzorzec nie pasuje do żadnego pliku. Dopóki żaden moduł nie
// ma tabel, wskazujemy pusty plik agregujący, żeby `generate` działało (np. migracje --custom).
const schema = globSync(MODULE_SCHEMAS).length > 0 ? MODULE_SCHEMAS : 'src/infra/db/schema.ts';

export default defineConfig({
  dialect: 'postgresql',
  schema: `./${schema}`,
  out: './drizzle',
  casing: 'snake_case',
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  strict: true,
  verbose: true,
});
