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

// Konwencja: tabele modułu leżą w src/modules/<moduł>/db/*.schema.ts, tabele infra (np. outbox)
// w src/infra/<nazwa>/db/*.schema.ts (patrz src/infra/db/schema.ts).
const SCHEMA_PATTERNS = ['src/modules/*/db/*.schema.ts', 'src/infra/*/db/*.schema.ts'];
// drizzle-kit kończy się błędem, gdy wzorzec nie pasuje do żadnego pliku, więc podajemy tylko
// wzorce, które coś znajdują (moduły mogą jeszcze nie mieć tabel).
const schema = SCHEMA_PATTERNS.filter((pattern) => globSync(pattern).length > 0).map(
  (pattern) => `./${pattern}`,
);

export default defineConfig({
  dialect: 'postgresql',
  schema,
  out: './drizzle',
  casing: 'snake_case',
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  strict: true,
  verbose: true,
});
